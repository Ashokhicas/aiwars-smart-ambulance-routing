import json
import uuid
from typing import List, Optional
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy.orm import Session
from contextlib import asynccontextmanager

from app.database import engine, Base, get_db
from app.models import Incident, Ambulance, Hospital
from app.core.config import settings
import google.generativeai as genai

# Try setting up Gemini natively; fallback if no key
genai.configure(api_key=settings.GEMINI_API_KEY)
try:
    # Upgrade to Gemini 2.0 Flash to gracefully avoid v1beta SDK 404 mismatch on some keys
    gemini_model = genai.GenerativeModel('gemini-2.0-flash')
except:
    gemini_model = None

# Boot sequence - Seed Mock Database
@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Start SQLite schema
    Base.metadata.create_all(bind=engine)
    
    # 2. Seed realistic database if empty (Simulating live traffic and accurate geo points)
    with Session(engine) as db:
        if db.query(Ambulance).count() == 0:
            db.add_all([
                Ambulance(id=str(uuid.uuid4()), unit_code="AMB-01 (ALS)", unit_type="ALS", fuel_pct=85, crew_hours=4.5, lat=12.9710, lng=77.6150),
                Ambulance(id=str(uuid.uuid4()), unit_code="AMB-02 (BLS)", unit_type="BLS", fuel_pct=40, crew_hours=14.0, lat=12.9740, lng=77.6190),
                Ambulance(id=str(uuid.uuid4()), unit_code="AMB-07 (ALS)", unit_type="ALS", fuel_pct=78, crew_hours=5.5, lat=12.9690, lng=77.6120),
                Ambulance(id=str(uuid.uuid4()), unit_code="HELI-1 (AirMed)", unit_type="HELI", fuel_pct=100, crew_hours=1.0, lat=12.9550, lng=77.6350),
                Ambulance(id=str(uuid.uuid4()), unit_code="MOTO-3 (FirstResp)", unit_type="BLS", fuel_pct=90, crew_hours=2.0, lat=12.9720, lng=77.6160),
            ])
        if db.query(Hospital).count() == 0:
            db.add_all([
                Hospital(id="hosp-001", name="St. John's Medical Center", trauma_level=1, available_beds=4, is_diverting=False, lat=12.9248, lng=77.6174),
                Hospital(id="hosp-002", name="City General Hospital", trauma_level=3, available_beds=12, is_diverting=False, lat=12.9660, lng=77.6080)
            ])
            db.commit()
            
    print("AmbulAI Backend Ready (Multimodal SQLite & Gemini Enabled)")
    yield

app = FastAPI(title="AmbulAI API", version="2.0.0", lifespan=lifespan)

def parse_with_ai(text: str, audio_bytes: bytes = None, audio_mime: str = None, image_bytes: bytes = None, image_mime: str = None) -> dict:
    fallback = {
        "incident_type": "trauma",
        "severity": "P1",
        "location_raw": text or "Unknown Audio/Image Location",
        "lat": 12.972442,
        "lng": 77.616982,
        "patient_count": 1,
        "special_notes": "Parsed via offline fallback logic",
        "nearby_hospitals": [],
        "nearest_police_station": None
    }
    
    if not gemini_model:
        return fallback

    prompt = f"""
    You are an expert Medical & Police Dispatch AI with deep geographical knowledge and situational logic.
    An emergency 911 public caller reported an incident. You are provided their raw text input along with optional live Voice Audio or Scene Camera Photos taken by their device.
    
    Agentic Tasks:
    1. Reason deeply: analyze the text, listen to the tone/context of the audio, and parse the exact visual severity and location cues from the photo.
    2. Identify 'incident_type' (trauma, cardiac_arrest, stroke, violent_crime, fire, respiratory, or other).
    3. Assess the 'severity' (P1 critical, P2 urgent, P3 minor).
    4. Determine the 'location_raw' (string identifier of the place based on text, audio or photo landmarks).
    5. Important: Determine the PRECISE 'lat' and 'lng' float coordinates of the incident location globally.
    6. Agentic Map Task: Identify the 3 nearest real-world trauma centers or hospitals to those exact coordinates, capturing their exact true lat/lng.
    7. Agentic Map Task: Identify the 1 nearest real-world Police Station to those coordinates to dispatch law enforcement. Format as {{"name": "...", "lat": ..., "lng": ...}}.
    8. Synthesize realistic 'special_notes' detailing exactly what you observed from the caller's text, voice, and picture.
    
    Caller's Text Input: "{text or 'No text provided, user sent media only.'}"
    
    Your response MUST be ONLY a raw JSON block matching this exact structure:
    {{
        "incident_type": "trauma",
        "severity": "P1",
        "location_raw": "Main St & 5th Ave",
        "lat": 40.7128,
        "lng": -74.0060,
        "patient_count": 1,
        "special_notes": "Deep reasoning including analysis of visual/audio evidence...",
        "nearby_hospitals": [
             {{"name": "City General Hospital", "lat": 40.7130, "lng": -74.0100}}
        ],
        "nearest_police_station": {{"name": "NYPD 1st Precinct", "lat": 40.7120, "lng": -74.0050}}
    }}
    Be highly accurate with geographic locations. Do not include markdown or backticks.
    """
    
    parts = [prompt]
    if image_bytes and image_mime:
        parts.append({"mime_type": image_mime, "data": image_bytes})
    if audio_bytes and audio_mime:
        parts.append({"mime_type": audio_mime, "data": audio_bytes})

    try:
        res = gemini_model.generate_content(parts)
        raw_json = res.text.replace("```json", "").replace("```", "").strip()
        data = json.loads(raw_json)
        return {**fallback, **data}
    except Exception as e:
        print(f"Gemini API Error: {e}")
        return fallback

@app.get("/")
async def health_check():
    return {"status": "ok", "message": "Smart Ambulence & Incident Reporting"}


@app.get("/api/v1/health")
async def health_check():
    return {"status": "ok", "db": "sqlite", "ai": "gemini" if gemini_model else "offline"}

@app.get("/api/v1/config")
async def get_app_config():
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
async def create_incident(
    raw_input: Optional[str] = Form(None),
    audio: Optional[UploadFile] = File(None),
    image: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db)
):
    if not raw_input and not audio and not image:
        raise HTTPException(status_code=400, detail="Must provide either text, audio, or an image.")
    
    audio_bytes, audio_mime = None, None
    image_bytes, image_mime = None, None
    if audio:
        audio_bytes = await audio.read()
        audio_mime = audio.content_type
    if image:
        image_bytes = await image.read()
        image_mime = image.content_type
        
    # AI Discovery & Multimodal Parsing
    extracted_data = parse_with_ai(raw_input or "", audio_bytes, audio_mime, image_bytes, image_mime)
    
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
        raw_input=raw_input or "Voice/Image Incident",
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
    
    best_hospital = sorted(hospitals, key=lambda h: h.trauma_level)[0] if hospitals else None
    
    fallback_recommendations = []
    for num, amb in enumerate(ambulances):
        fallback_recommendations.append({
            "unit_id": amb.id,
            "unit_code": amb.unit_code,
            "unit_type": amb.unit_type,
            "eta_minutes": round(4.2 + (num * 1.9), 1),
            "score": round(0.95 - (num * 0.1), 2),
            "lat": amb.lat,
            "lng": amb.lng,
            "rationale": f"Selected heavily because crew is at {amb.crew_hours}h shift. Fuel at {amb.fuel_pct}%."
        })
        
    fallback_response = {
        "incident_id": incident.id,
        "recommendations": sorted(fallback_recommendations, key=lambda x: x["eta_minutes"])[:2],
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

    # ACTIVATE GEMINI DISPATCH INTELLIGENCE
    if gemini_model:
        prompt = f"""
        You are AmbulAI, an elite Autonomous Emergency Dispatch reasoning engine powered by Gemini.
        Your task is to analyze an incoming emergency and the LIVE GPS positions of the entire ambulance fleet and hospitals.
        You must calculate approximate ETAs based on latitude/longitude distances, factor in the severity (P1 vs P3), crew hours, and fuel, and powerfully rank the best 2 ambulances to dispatch.
        You must also select the best Hospital (P1 Trauma needs Level 1-2 Trauma Centers).

        Incident Details:
        Type: {incident.incident_type} (Severity: {incident.severity})
        Location: Lat {incident.lat}, Lng {incident.lng}
        Notes: {incident.special_notes}

        Live Fleet Telemetry:
        {json.dumps([{"id": a.id, "unit_code": a.unit_code, "type": a.unit_type, "fuel": a.fuel_pct, "crew_shift_hrs": a.crew_hours, "lat": a.lat, "lng": a.lng} for a in ambulances])}

        Live Hospital Network:
        {json.dumps([{"id": h.id, "name": h.name, "trauma_level": h.trauma_level, "beds": h.available_beds, "lat": h.lat, "lng": h.lng} for h in hospitals])}

        Output STRICTLY valid JSON with no backticks, matching this exact structure:
        {{
            "recommendations": [
                {{
                    "unit_id": "<string matching a fleet id>",
                    "unit_code": "<string matching unit_code>",
                    "unit_type": "<type>",
                    "lat": <float>,
                    "lng": <float>,
                    "eta_minutes": <float realistic estimation>,
                    "score": <float 0.0 to 1.0 confidence>,
                    "rationale": "<string vividly detailing WHY Gemini chose this unit over others referencing fuel, distance, and crew fatigue>"
                }}
            ],
            "recommended_hospital": {{
                "hospital_id": "<id>",
                "name": "<name>",
                "trauma_level": <int>,
                "eta_from_scene_minutes": <float realistic estimation to drive from incident to hospital>,
                "is_diverting": false,
                "lat": <float>,
                "lng": <float>
            }}
        }}
        """
        import time
        max_retries = 2
        for attempt in range(max_retries):
            try:
                res = gemini_model.generate_content(prompt)
                raw_json = res.text.replace("```json", "").replace("```", "").strip()
                ai_data = json.loads(raw_json)
                # Inject the incident ID exactly
                ai_data["incident_id"] = incident.id
                return ai_data
            except Exception as e:
                error_str = str(e)
                if "429" in error_str and attempt < max_retries - 1:
                    print(f"Gemini AI Free-Tier Rate Limit Hit (Waiting 15s automatically to retry Dispatch...)")
                    time.sleep(15)
                    continue
                else:
                    print(f"Gemini Dispatch Engine Error: {e}")
                    return fallback_response

    return fallback_response

