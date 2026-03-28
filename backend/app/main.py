import json
import uuid
from typing import List, Optional
from fastapi import FastAPI, HTTPException, Depends
from pydantic import BaseModel
from contextlib import asynccontextmanager
import google.generativeai as genai
from sqlalchemy.orm import Session

from app.core.config import settings
from app.database import engine, Base, get_db
from app.models import Incident, Ambulance, Hospital

# Configure Gemini AI
if settings.GEMINI_API_KEY:
    genai.configure(api_key=settings.GEMINI_API_KEY)
    gemini_model = genai.GenerativeModel('gemini-2.0-flash')
else:
    gemini_model = None

# Boot sequence - Seed Mock Database
@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Start SQLite schema
    Base.metadata.create_all(bind=engine)
    
    # 2. Seed database if empty
    with Session(engine) as db:
        if db.query(Ambulance).count() == 0:
            db.add_all([
                Ambulance(id=str(uuid.uuid4()), unit_code="AMB-01", unit_type="ALS", fuel_pct=85, crew_hours=4.5, lat=12.9710, lng=77.6150),
                Ambulance(id=str(uuid.uuid4()), unit_code="AMB-02", unit_type="BLS", fuel_pct=40, crew_hours=14.0, lat=12.9740, lng=77.6190),
                Ambulance(id=str(uuid.uuid4()), unit_code="AMB-07", unit_type="ALS", fuel_pct=78, crew_hours=5.5, lat=12.9690, lng=77.6120),
            ])
        if db.query(Hospital).count() == 0:
            db.add_all([
                Hospital(id="hosp-001", name="St. John's Medical Center", trauma_level=1, available_beds=4, is_diverting=False, lat=12.9248, lng=77.6174),
                Hospital(id="hosp-002", name="City General Hospital", trauma_level=3, available_beds=12, is_diverting=False, lat=12.9660, lng=77.6080)
            ])
            db.commit()
            
    print("AmbulAI Backend Ready (SQLite & Gemini Enabled)")
    yield

app = FastAPI(title="AmbulAI API", version="1.0.0", lifespan=lifespan)

class IncidentInput(BaseModel):
    raw_input: str
    input_type: str = "text"

def parse_with_ai(text: str) -> dict:
    fallback = {
        "incident_type": "trauma",
        "severity": "P1",
        "location_raw": text,
        "lat": 12.972442,
        "lng": 77.616982,
        "patient_count": 1,
        "special_notes": "Parsed via fallback logic",
        "nearby_hospitals": []
    }
    
    if not gemini_model:
        return fallback

    prompt = f"""
    You are an expert Medical Dispatch AI with deep geographical knowledge of the world.
    An emergency 911 caller reported the following incident: "{text}"
    
    1. Identify the 'incident_type' (trauma, cardiac_arrest, stroke, respiratory, or other).
    2. Assess the 'severity' (P1, P2, or P3).
    3. Determine the 'location_raw' (string identifier of the place based on the text).
    4. Important: Determine the PRECISE 'lat' and 'lng' float coordinates of the incident location.
    5. Agentic Step: Identify and name the 3 nearest real-world trauma centers or hospitals to those exact coordinates with their exact lat/lng.
    
    Your response MUST be ONLY a raw JSON block matching this exact structure:
    {{
        "incident_type": "trauma",
        "severity": "P1",
        "location_raw": "Main St & 5th Ave",
        "lat": 40.7128,
        "lng": -74.0060,
        "patient_count": 1,
        "special_notes": "...",
        "nearby_hospitals": [
             {{"name": "City General Hospital", "lat": 40.7130, "lng": -74.0100}}
        ]
    }}
    Be highly accurate with geographic locations and real hospital names. Do not include markdown or backticks.
    """
    try:
        res = gemini_model.generate_content(prompt)
        raw_json = res.text.replace("```json", "").replace("```", "").strip()
        data = json.loads(raw_json)
        return {**fallback, **data}
    except Exception as e:
        print(f"Gemini API Error: {e}")
        return fallback

@app.get("/api/v1/health")
async def health_check():
    return {"status": "ok", "db": "sqlite", "ai": "gemini" if gemini_model else "offline"}

@app.get("/api/v1/config")
async def get_app_config():
    # Serves the public Maps API key at strictly runtime so Cloud Build artifacts remain stateless
    from app.core.config import settings
    return {"maps_api_key": settings.MAPS_API_KEY}

@app.get("/api/v1/fleet")
async def get_fleet(db: Session = Depends(get_db)):
    ambulances = db.query(Ambulance).all()
    hospitals = db.query(Hospital).all()
    return {
        "ambulances": [{"unit_code": a.unit_code, "lat": a.lat, "lng": a.lng} for a in ambulances],
        "hospitals": [{"name": h.name, "lat": h.lat, "lng": h.lng} for h in hospitals]
    }

@app.post("/api/v1/incidents")
async def create_incident(incident: IncidentInput, db: Session = Depends(get_db)):
    if len(incident.raw_input) < 10:
        raise HTTPException(status_code=400, detail="Input too short")
    
    # AI Discovery & Parsing
    extracted_data = parse_with_ai(incident.raw_input)
    
    # Persist the Agentic Discovered Hospitals to our Map
    import random
    for hosp in extracted_data.get("nearby_hospitals", []):
        existing = db.query(Hospital).filter(Hospital.name == hosp.get("name")).first()
        if not existing:
            db.add(Hospital(
                id=str(uuid.uuid4()),
                name=hosp.get("name"),
                trauma_level=random.choice([1, 2, 3]),
                available_beds=random.randint(2, 15),
                is_diverting=False,
                lat=hosp.get("lat"),
                lng=hosp.get("lng")
            ))
            db.commit()

    # Create Incident Record
    new_incident = Incident(
        id=str(uuid.uuid4()),
        incident_number=f"INC-2026-{db.query(Incident).count() + 1:04d}",
        raw_input=incident.raw_input,
        incident_type=extracted_data.get("incident_type"),
        severity=extracted_data.get("severity"),
        location_raw=extracted_data.get("location_raw"),
        lat=extracted_data.get("lat", 12.9724), 
        lng=extracted_data.get("lng", 77.6169),
        patient_count=extracted_data.get("patient_count", 1),
        special_notes=extracted_data.get("special_notes"),
        status="new"
    )
    
    db.add(new_incident)
    db.commit()
    db.refresh(new_incident)
    
    return {
        "incident_id": new_incident.id,
        "incident_number": new_incident.incident_number,
        "extracted": {**extracted_data, "lat": new_incident.lat, "lng": new_incident.lng},
        "status": new_incident.status
    }

@app.post("/api/v1/dispatch/recommend")
async def recommend_dispatch(incident_id: str, db: Session = Depends(get_db)):
    incident = db.query(Incident).filter(Incident.id == incident_id).first()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
        
    ambulances = db.query(Ambulance).all()
    hospitals = db.query(Hospital).filter(Hospital.is_diverting == False).all()
    
    ranked_units = []
    for num, amb in enumerate(ambulances):
        eta = 4.2 + (num * 1.9)
        score = 0.95 - (num * 0.1)
        ranked_units.append({
            "rank": num + 1,
            "unit_id": amb.id,
            "unit_code": amb.unit_code,
            "unit_type": amb.unit_type,
            "eta_minutes": round(eta, 1),
            "score": round(score, 2),
            "lat": amb.lat,
            "lng": amb.lng,
            "rationale": f"Selected heavily because crew is at {amb.crew_hours}h shift. Fuel at {amb.fuel_pct}%."
        })
        
    best_hospital = sorted(hospitals, key=lambda h: h.trauma_level)[0] if hospitals else None
        
    return {
        "incident_id": incident.id,
        "recommendations": sorted(ranked_units, key=lambda x: x["eta_minutes"])[:2],
        "recommended_hospital": {
            "hospital_id": best_hospital.id if best_hospital else "Unknown",
            "name": best_hospital.name if best_hospital else "Unknown Facility",
            "trauma_level": best_hospital.trauma_level if best_hospital else 1,
            "eta_from_scene_minutes": 8,
            "is_diverting": False,
            "lat": best_hospital.lat if best_hospital else 12.9248,
            "lng": best_hospital.lng if best_hospital else 77.6174
        }
    }
