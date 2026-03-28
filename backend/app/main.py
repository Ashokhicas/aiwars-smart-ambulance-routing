import json
import math
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from contextlib import asynccontextmanager

from app.database import engine, Base, get_db
from app.models import Incident, IncidentEvent, Ambulance, Hospital
from app.core.config import settings
import google.generativeai as genai

# ---------------------------------------------------------------------------
# Gemini setup
# ---------------------------------------------------------------------------
genai.configure(api_key=settings.GEMINI_API_KEY)
try:
    gemini_model = genai.GenerativeModel('gemini-2.0-flash')
except Exception:
    gemini_model = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ts(minutes_ago: float = 0) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat()


def _route_waypoints(slat: float, slng: float, elat: float, elng: float, n: int = 18) -> list:
    """Linear-interpolated route waypoints between two GPS coordinates."""
    return [
        {
            "lat": round(slat + (elat - slat) * i / (n - 1), 6),
            "lng": round(slng + (elng - slng) * i / (n - 1), 6),
        }
        for i in range(n)
    ]


def _add_event(db, incident_id, event_type, actor_type, actor_name, narrative,
               lat=None, lng=None, actor_id=None):
    ev = IncidentEvent(
        id=str(uuid.uuid4()),
        incident_id=incident_id,
        event_type=event_type,
        actor_type=actor_type,
        actor_id=actor_id,
        actor_name=actor_name,
        narrative=narrative,
        timestamp=_ts(),
        lat=lat,
        lng=lng,
    )
    db.add(ev)
    return ev


def _event_to_dict(e: IncidentEvent) -> dict:
    return {
        "id": e.id,
        "event_type": e.event_type,
        "actor_type": e.actor_type,
        "actor_id": e.actor_id,
        "actor_name": e.actor_name,
        "narrative": e.narrative,
        "timestamp": e.timestamp,
        "lat": e.lat,
        "lng": e.lng,
    }


def _incident_to_active_dict(inc: Incident, amb: Ambulance, hosp: Hospital, events: list, waypoints: list) -> dict:
    return {
        "incident_id": inc.id,
        "incident_number": inc.incident_number,
        "status": inc.status,
        "extracted": {
            "incident_title": inc.incident_title,
            "incident_type": inc.incident_type,
            "severity": inc.severity,
            "location_raw": inc.location_raw,
            "location_confidence": inc.location_confidence,
            "lat": inc.lat,
            "lng": inc.lng,
            "patient_count": inc.patient_count,
            "transcription": inc.transcription or "",
            "visual_description": inc.visual_description or "",
            "special_notes": inc.special_notes,
            "nearest_police_station": None,
        },
        "assigned_ambulance": {
            "id": amb.id, "unit_code": amb.unit_code, "unit_type": amb.unit_type,
            "lat": amb.lat, "lng": amb.lng,
        } if amb else None,
        "assigned_hospital": {
            "id": hosp.id, "name": hosp.name, "trauma_level": hosp.trauma_level,
            "lat": hosp.lat, "lng": hosp.lng,
        } if hosp else None,
        "journey": [_event_to_dict(e) for e in events],
        "route_waypoints": waypoints,
    }


def _dispatch_narrative(incident: Incident, amb: Ambulance, hosp: Hospital) -> str:
    """Ask Gemini to write a professional CAD dispatch narrative, or fall back."""
    if not gemini_model:
        return (f"{amb.unit_code} dispatched to {incident.location_raw}. "
                f"Destination: {hosp.name}. ETA estimated.")
    prompt = (
        f"Write a professional 2-sentence Computer Aided Dispatch (CAD) narrative.\n"
        f"Incident: {incident.incident_title or incident.incident_type} at {incident.location_raw}\n"
        f"Severity: {incident.severity}\n"
        f"Unit: {amb.unit_code} ({amb.unit_type}), fuel {amb.fuel_pct}%, crew {amb.crew_hours}h on shift\n"
        f"Receiving hospital: {hosp.name} (Level {hosp.trauma_level} Trauma, {hosp.available_beds} beds)\n"
        f"Write only the narrative — no JSON, no labels."
    )
    try:
        return gemini_model.generate_content([prompt]).text.strip()
    except Exception:
        return (f"{amb.unit_code} dispatched to {incident.location_raw}. "
                f"Destination: {hosp.name}.")


# ---------------------------------------------------------------------------
# Demo seeder
# ---------------------------------------------------------------------------

def _seed_demo_incident(db: Session):
    """Seed one complete demo incident with a full journey timeline."""
    if db.query(Incident).filter(Incident.id == "demo-inc-001").first():
        return

    amb = db.query(Ambulance).filter(Ambulance.unit_type == "ALS").first()
    hosp = db.query(Hospital).filter(Hospital.id == "hosp-001").first()
    if not amb or not hosp:
        return

    demo = Incident(
        id="demo-inc-001",
        incident_number="INC-2026-0001",
        raw_input="Adult male collapsed unresponsive at Koramangala 5th Block. Bystander performing CPR.",
        incident_title="Cardiac Arrest — Koramangala 5th Block",
        incident_type="cardiac_arrest",
        severity="P1",
        location_raw="Koramangala 5th Block, Bangalore",
        location_confidence="high",
        lat=12.9362,
        lng=77.6243,
        patient_count=1,
        transcription="There's a man on the ground not breathing, we're doing CPR, please hurry, he's turning blue!",
        visual_description="",
        special_notes=(
            "Adult male, approx. 52 years, collapsed unresponsive at a busy intersection. "
            "Bystander confirmed performing CPR per pre-arrival instructions. "
            "No AED on scene. High-traffic corner, expect congestion from Outer Ring Road side."
        ),
        assigned_ambulance_id=amb.id,
        assigned_hospital_id=hosp.id,
        status="en_route",
    )
    db.add(demo)
    db.flush()

    seed_events = [
        ("reported",          "reporter",   "Emergency Caller",    amb.lat, amb.lng, None,
         "Emergency call received. Caller reports adult male, ~52 yrs, collapsed unresponsive "
         "at Koramangala 5th Block. Caller is panicked, CPR being performed by bystander. "
         "Pre-arrival CPR instructions given over line.", 18),

        ("ai_parsed",         "ai_system",  "Gemini AI Agent",     12.9362, 77.6243, None,
         "Gemini 2.0 classified incident as P1 Cardiac Arrest. Location confirmed: Koramangala "
         "5th Block, Bangalore (lat 12.9362, lng 77.6243, confidence: HIGH). Audio transcription "
         "analysed — caller confirmed 'not breathing, turning blue'. 3 nearby trauma centres "
         "identified. Koramangala Police Station flagged for scene support.", 16),

        ("ambulance_assigned", "ambulance", amb.unit_code,         amb.lat, amb.lng, amb.id,
         f"Gemini Dispatch Engine selected {amb.unit_code} (ALS) as primary unit. "
         f"Unit is {round(math.dist([amb.lat, amb.lng],[12.9362, 77.6243])*111, 1)} km from scene — "
         f"shortest intercept route calculated avoiding ORR congestion. "
         f"Crew at {amb.crew_hours}h shift ({100-int(amb.crew_hours/12*100)}% readiness), "
         f"{amb.fuel_pct}% fuel. ALS capability matched to cardiac emergency.", 13),

        ("hospital_selected", "hospital",  hosp.name,             hosp.lat, hosp.lng, hosp.id,
         f"{hosp.name} (Level {hosp.trauma_level} Trauma Centre) pre-alerted. "
         f"{hosp.available_beds} critical care beds confirmed available. "
         f"Cardiology crash team on standby. Estimated scene-to-hospital ETA: 8.2 minutes. "
         f"HL7 pre-alert data transmitted.", 12),

        ("police_notified",   "police",     "Koramangala Police Station", 12.9343, 77.6245, None,
         "Koramangala Police Station Unit 7 dispatched. ETA to scene: 4 minutes. "
         "Task: secure perimeter, manage traffic congestion at 5th Block junction, "
         "assist with crowd control.", 11),

        ("en_route",          "ambulance",  amb.unit_code,         amb.lat, amb.lng, amb.id,
         f"{amb.unit_code} confirmed en route with lights and siren active. "
         f"Live GPS tracking engaged. Estimated arrival at Koramangala 5th Block: "
         f"{_ts(-7)[:16].replace('T', ' ')} UTC. "
         f"Patient handoff pre-scheduled at {hosp.name} ER Bay 2.", 10),
    ]

    for ev_type, actor_type, actor_name, lat, lng, actor_id, narrative, mins_ago in seed_events:
        db.add(IncidentEvent(
            id=str(uuid.uuid4()),
            incident_id="demo-inc-001",
            event_type=ev_type,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_name=actor_name,
            narrative=narrative,
            timestamp=_ts(mins_ago),
            lat=lat,
            lng=lng,
        ))

    db.commit()
    print("Demo incident seeded: INC-2026-0001 (Cardiac Arrest — Koramangala 5th Block)")


# ---------------------------------------------------------------------------
# App lifecycle
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)

    with Session(engine) as db:
        if db.query(Ambulance).count() == 0:
            db.add_all([
                Ambulance(id=str(uuid.uuid4()), unit_code="AMB-01 (ALS)", unit_type="ALS",
                          fuel_pct=85, crew_hours=4.5, lat=12.9710, lng=77.6150),
                Ambulance(id=str(uuid.uuid4()), unit_code="AMB-02 (BLS)", unit_type="BLS",
                          fuel_pct=40, crew_hours=14.0, lat=12.9740, lng=77.6190),
                Ambulance(id=str(uuid.uuid4()), unit_code="AMB-07 (ALS)", unit_type="ALS",
                          fuel_pct=78, crew_hours=5.5, lat=12.9690, lng=77.6120),
                Ambulance(id=str(uuid.uuid4()), unit_code="HELI-1 (AirMed)", unit_type="HELI",
                          fuel_pct=100, crew_hours=1.0, lat=12.9550, lng=77.6350),
                Ambulance(id=str(uuid.uuid4()), unit_code="MOTO-3 (FirstResp)", unit_type="BLS",
                          fuel_pct=90, crew_hours=2.0, lat=12.9720, lng=77.6160),
            ])
        if db.query(Hospital).count() == 0:
            db.add_all([
                Hospital(id="hosp-001", name="St. John's Medical Center",
                         trauma_level=1, available_beds=4, is_diverting=False,
                         lat=12.9248, lng=77.6174),
                Hospital(id="hosp-002", name="City General Hospital",
                         trauma_level=3, available_beds=12, is_diverting=False,
                         lat=12.9660, lng=77.6080),
            ])
            db.commit()

        # Seed demo incident (only if fleet already persisted)
        _seed_demo_incident(db)

    print("AmbulAI Backend Ready")
    yield


# ---------------------------------------------------------------------------
# App + middleware
# ---------------------------------------------------------------------------

app = FastAPI(title="AmbulAI API", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# AI helpers
# ---------------------------------------------------------------------------

def _clean_json(raw: str) -> dict:
    return json.loads(raw.replace("```json", "").replace("```", "").strip())


def analyze_media(audio_bytes: bytes, audio_mime: str,
                  image_bytes: bytes, image_mime: str) -> dict:
    """Stage 1 — extract raw observations from media before incident classification."""
    empty = {
        "transcription": "", "visual_description": "", "location_cues": "",
        "visible_injuries": "", "patient_count_estimate": 1, "caller_state": "unknown",
    }
    if not gemini_model:
        return empty

    parts, task_blocks = [], []

    if audio_bytes and audio_mime:
        parts.append({"mime_type": audio_mime, "data": audio_bytes})
        task_blocks.append(
            "AUDIO TASKS:\n"
            "- Transcribe every word spoken verbatim into 'transcription'.\n"
            "- Note the caller's emotional state (panicked/calm/injured/crying).\n"
            "- Identify background sounds that reveal location context.\n"
            "- Extract any street names, landmarks or business names mentioned."
        )

    if image_bytes and image_mime:
        parts.append({"mime_type": image_mime, "data": image_bytes})
        task_blocks.append(
            "IMAGE TASKS:\n"
            "- Write a detailed scene description into 'visual_description'.\n"
            "- Read ALL visible text: street signs, building names, business signs, "
            "route numbers, license plates, billboards.\n"
            "- Note architectural style, road type, and distinctive landmarks.\n"
            "- Describe visible injuries, vehicle damage, fire, or hazards.\n"
            "- Count visible people involved in the emergency."
        )

    prompt = (
        "You are an emergency dispatch AI performing media pre-analysis on a 911 submission.\n\n"
        + "\n\n".join(task_blocks)
        + "\n\nReturn ONLY raw JSON — no markdown:\n"
        '{"transcription":"","visual_description":"","location_cues":"",'
        '"visible_injuries":"","patient_count_estimate":1,"caller_state":"unknown"}'
    )
    parts.insert(0, prompt)
    try:
        res = gemini_model.generate_content(parts)
        return {**empty, **_clean_json(res.text)}
    except Exception as e:
        print(f"[Stage 1 Media Analysis Error] {e}")
        return empty


def parse_with_ai(text: str, media_analysis: dict = None) -> dict:
    """Stage 2 — classify incident from text + Stage 1 media analysis."""
    ma = media_analysis or {}
    fallback = {
        "incident_title": "Emergency Incident",
        "incident_type": "trauma",
        "severity": "P1",
        "location_raw": text or ma.get("location_cues") or "Unknown Location",
        "lat": 12.972442, "lng": 77.616982,
        "location_confidence": "low",
        "patient_count": ma.get("patient_count_estimate", 1),
        "transcription": ma.get("transcription", ""),
        "visual_description": ma.get("visual_description", ""),
        "special_notes": "Parsed via offline fallback logic.",
        "nearby_hospitals": [],
        "nearest_police_station": None,
    }
    if not gemini_model:
        return fallback

    evidence_lines = []
    if text:
        evidence_lines.append(f'Caller Text: "{text}"')
    if ma.get("transcription"):
        evidence_lines.append(f'Audio Transcription: "{ma["transcription"]}"')
        evidence_lines.append(f'Caller State: {ma.get("caller_state", "unknown")}')
    if ma.get("visual_description"):
        evidence_lines.append(f"Scene (from photo): {ma['visual_description']}")
    if ma.get("location_cues"):
        evidence_lines.append(f"Location Cues: {ma['location_cues']}")
    if ma.get("visible_injuries"):
        evidence_lines.append(f"Visible Injuries/Hazards: {ma['visible_injuries']}")
    if ma.get("patient_count_estimate"):
        evidence_lines.append(f"Estimated Patients (visual): {ma['patient_count_estimate']}")

    evidence_block = "\n".join(evidence_lines) or "No evidence provided."

    prompt = (
        "You are AmbulAI, an expert Emergency Dispatch classification agent.\n"
        "Analyze ALL evidence and produce a structured incident report.\n\n"
        f"=== EVIDENCE ===\n{evidence_block}\n\n"
        "=== TASKS ===\n"
        "1. 'incident_title': concise title with type AND location (e.g. 'Cardiac Arrest - Koramangala 5th Block').\n"
        "2. 'incident_type': trauma|cardiac_arrest|stroke|violent_crime|fire|respiratory|other.\n"
        "3. 'severity': P1 (life-threatening) | P2 (urgent) | P3 (minor).\n"
        "4. 'location_raw': best human-readable address from ALL evidence.\n"
        "5. 'lat' and 'lng': precise float coordinates.\n"
        "6. 'location_confidence': high|medium|low.\n"
        "7. 'patient_count': integer.\n"
        "8. 3 nearest REAL hospitals with exact lat/lng.\n"
        "9. 1 nearest REAL police station with exact lat/lng.\n"
        "10. 'special_notes': comprehensive dispatch summary.\n\n"
        "Return ONLY raw JSON:\n"
        '{"incident_title":"","incident_type":"trauma","severity":"P1","location_raw":"",'
        '"lat":0.0,"lng":0.0,"location_confidence":"low","patient_count":1,'
        '"special_notes":"",'
        f'"transcription":{json.dumps(ma.get("transcription",""))},'
        f'"visual_description":{json.dumps(ma.get("visual_description",""))},'
        '"nearby_hospitals":[{"name":"","lat":0.0,"lng":0.0}],'
        '"nearest_police_station":{"name":"","lat":0.0,"lng":0.0}}'
    )
    try:
        data = _clean_json(gemini_model.generate_content([prompt]).text)
        return {**fallback, **data}
    except Exception as e:
        print(f"[Stage 2 Classification Error] {e}")
        return fallback


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/")
async def root():
    return {"status": "ok", "message": "AmbulAI Smart Ambulance Routing"}


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
        "ambulances": [{"id": a.id, "unit_code": a.unit_code, "unit_type": a.unit_type,
                        "lat": a.lat, "lng": a.lng} for a in ambulances],
        "hospitals": [{"name": h.name, "lat": h.lat, "lng": h.lng} for h in hospitals],
    }


@app.get("/api/v1/incidents/active")
async def get_active_incidents(db: Session = Depends(get_db)):
    """Return all non-completed incidents with their full journey and route waypoints."""
    incidents = (
        db.query(Incident)
        .filter(Incident.status.in_(["new", "en_route", "arrived", "handoff"]))
        .order_by(Incident.incident_number.desc())
        .limit(5)
        .all()
    )
    result = []
    for inc in incidents:
        amb = (db.query(Ambulance).filter(Ambulance.id == inc.assigned_ambulance_id).first()
               if inc.assigned_ambulance_id else None)
        hosp = (db.query(Hospital).filter(Hospital.id == inc.assigned_hospital_id).first()
                if inc.assigned_hospital_id else None)
        events = (db.query(IncidentEvent)
                  .filter(IncidentEvent.incident_id == inc.id)
                  .order_by(IncidentEvent.timestamp)
                  .all())
        waypoints = (_route_waypoints(amb.lat, amb.lng, inc.lat, inc.lng)
                     if amb and inc.lat and inc.lng else [])
        result.append(_incident_to_active_dict(inc, amb, hosp, events, waypoints))
    return result


@app.get("/api/v1/incidents/{incident_id}/journey")
async def get_incident_journey(incident_id: str, db: Session = Depends(get_db)):
    """Return the full journey timeline for a single incident."""
    inc = db.query(Incident).filter(Incident.id == incident_id).first()
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found")
    amb = (db.query(Ambulance).filter(Ambulance.id == inc.assigned_ambulance_id).first()
           if inc.assigned_ambulance_id else None)
    hosp = (db.query(Hospital).filter(Hospital.id == inc.assigned_hospital_id).first()
            if inc.assigned_hospital_id else None)
    events = (db.query(IncidentEvent)
              .filter(IncidentEvent.incident_id == incident_id)
              .order_by(IncidentEvent.timestamp)
              .all())
    return {
        "incident_id": incident_id,
        "status": inc.status,
        "assigned_ambulance": {"id": amb.id, "unit_code": amb.unit_code,
                               "lat": amb.lat, "lng": amb.lng} if amb else None,
        "assigned_hospital": {"id": hosp.id, "name": hosp.name,
                              "lat": hosp.lat, "lng": hosp.lng} if hosp else None,
        "journey": [_event_to_dict(e) for e in events],
    }


@app.post("/api/v1/incidents")
async def create_incident(
    raw_input: Optional[str] = Form(None),
    audio: Optional[UploadFile] = File(None),
    image: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
):
    if not raw_input and not audio and not image:
        raise HTTPException(status_code=400, detail="Must provide text, audio, or an image.")

    audio_bytes, audio_mime = None, None
    image_bytes, image_mime = None, None
    if audio:
        audio_bytes = await audio.read()
        audio_mime = audio.content_type
    if image:
        image_bytes = await image.read()
        image_mime = image.content_type

    # Stage 1 — media analysis
    media_analysis = None
    if audio_bytes or image_bytes:
        media_analysis = analyze_media(audio_bytes, audio_mime, image_bytes, image_mime)

    # Stage 2 — incident classification
    extracted = parse_with_ai(raw_input or "", media_analysis)

    # Persist AI-discovered hospitals
    import random
    for hosp in extracted.get("nearby_hospitals", []):
        if not db.query(Hospital).filter(Hospital.name == hosp.get("name")).first():
            db.add(Hospital(
                id=str(uuid.uuid4()),
                name=hosp.get("name"),
                trauma_level=random.choice([1, 2, 3]),
                available_beds=random.randint(2, 15),
                is_diverting=False,
                lat=hosp.get("lat"),
                lng=hosp.get("lng"),
            ))
            db.commit()

    new_incident = Incident(
        id=str(uuid.uuid4()),
        incident_number=f"INC-2026-{db.query(Incident).count() + 1:04d}",
        raw_input=raw_input or "Voice/Image Incident",
        incident_title=extracted.get("incident_title"),
        incident_type=extracted.get("incident_type"),
        severity=extracted.get("severity"),
        location_raw=extracted.get("location_raw"),
        location_confidence=extracted.get("location_confidence", "low"),
        lat=extracted.get("lat", 12.9724),
        lng=extracted.get("lng", 77.6169),
        patient_count=extracted.get("patient_count", 1),
        transcription=extracted.get("transcription"),
        visual_description=extracted.get("visual_description"),
        special_notes=extracted.get("special_notes"),
        status="new",
    )
    db.add(new_incident)
    db.flush()

    # Journey — initial events
    media_note = ""
    if audio_bytes:
        media_note += " Voice audio submitted."
    if image_bytes:
        media_note += " Scene photo submitted."

    _add_event(db, new_incident.id, "reported", "reporter", "Emergency Caller",
               f"Incident reported via AmbulAI portal.{media_note} "
               f"Initial data received and queued for AI analysis.",
               new_incident.lat, new_incident.lng)

    _add_event(db, new_incident.id, "ai_parsed", "ai_system", "Gemini AI Agent",
               f"Gemini 2.0 classified: {extracted.get('incident_type')} "
               f"({extracted.get('severity')}) at {extracted.get('location_raw')}. "
               f"Location confidence: {extracted.get('location_confidence', 'low')}. "
               + (f"Audio transcribed: \"{extracted.get('transcription', '')}\" " if extracted.get('transcription') else "")
               + (f"Scene analysis: {extracted.get('visual_description', '')[:100]}..." if extracted.get('visual_description') else ""),
               new_incident.lat, new_incident.lng)

    db.commit()
    db.refresh(new_incident)

    return {
        "incident_id": new_incident.id,
        "incident_number": new_incident.incident_number,
        "extracted": {**extracted, "lat": new_incident.lat, "lng": new_incident.lng},
        "status": new_incident.status,
    }


@app.post("/api/v1/dispatch/recommend")
async def recommend_dispatch(incident_id: str, db: Session = Depends(get_db)):
    incident = db.query(Incident).filter(Incident.id == incident_id).first()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    ambulances = db.query(Ambulance).all()
    hospitals = db.query(Hospital).filter(Hospital.is_diverting == False).all()
    best_hospital = sorted(hospitals, key=lambda h: h.trauma_level)[0] if hospitals else None

    fallback_recs = [
        {
            "unit_id": a.id, "unit_code": a.unit_code, "unit_type": a.unit_type,
            "lat": a.lat, "lng": a.lng,
            "eta_minutes": round(4.2 + i * 1.9, 1),
            "score": round(0.95 - i * 0.1, 2),
            "rationale": f"Crew at {a.crew_hours}h shift. Fuel: {a.fuel_pct}%.",
        }
        for i, a in enumerate(ambulances)
    ]
    fallback = {
        "incident_id": incident.id,
        "recommendations": sorted(fallback_recs, key=lambda x: x["eta_minutes"])[:2],
        "recommended_hospital": {
            "hospital_id": best_hospital.id if best_hospital else "Unknown",
            "name": best_hospital.name if best_hospital else "Unknown Facility",
            "trauma_level": best_hospital.trauma_level if best_hospital else 1,
            "eta_from_scene_minutes": 8,
            "is_diverting": False,
            "lat": best_hospital.lat if best_hospital else 12.9248,
            "lng": best_hospital.lng if best_hospital else 77.6174,
        },
    }

    if gemini_model:
        prompt = f"""You are AmbulAI dispatch engine. Rank the best 2 ambulances for this incident.

Incident: {incident.incident_type} (Severity: {incident.severity})
Location: Lat {incident.lat}, Lng {incident.lng}
Notes: {incident.special_notes}

Fleet: {json.dumps([{"id": a.id, "unit_code": a.unit_code, "type": a.unit_type, "fuel": a.fuel_pct, "crew_shift_hrs": a.crew_hours, "lat": a.lat, "lng": a.lng} for a in ambulances])}

Hospitals: {json.dumps([{"id": h.id, "name": h.name, "trauma_level": h.trauma_level, "beds": h.available_beds, "lat": h.lat, "lng": h.lng} for h in hospitals])}

Return ONLY valid JSON:
{{"recommendations":[{{"unit_id":"","unit_code":"","unit_type":"","lat":0.0,"lng":0.0,"eta_minutes":0.0,"score":0.0,"rationale":""}}],"recommended_hospital":{{"hospital_id":"","name":"","trauma_level":1,"eta_from_scene_minutes":0.0,"is_diverting":false,"lat":0.0,"lng":0.0}}}}"""

        import time
        for attempt in range(2):
            try:
                ai_data = _clean_json(gemini_model.generate_content(prompt).text)
                ai_data["incident_id"] = incident.id
                return ai_data
            except Exception as e:
                if "429" in str(e) and attempt == 0:
                    print("Gemini rate limit — retrying in 15s")
                    time.sleep(15)
                else:
                    print(f"Gemini Dispatch Error: {e}")
                    return fallback

    return fallback


@app.post("/api/v1/dispatch/confirm")
async def confirm_dispatch(
    incident_id: str,
    ambulance_id: str,
    hospital_id: str,
    db: Session = Depends(get_db),
):
    """
    Dispatcher confirms the assignment. Records journey events, updates incident status,
    generates a Gemini CAD narrative, and returns route waypoints for map animation.
    """
    incident = db.query(Incident).filter(Incident.id == incident_id).first()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    amb = db.query(Ambulance).filter(Ambulance.id == ambulance_id).first()
    hosp = db.query(Hospital).filter(Hospital.id == hospital_id).first()
    if not amb or not hosp:
        raise HTTPException(status_code=404, detail="Ambulance or hospital not found")

    # Update incident
    incident.assigned_ambulance_id = ambulance_id
    incident.assigned_hospital_id = hospital_id
    incident.status = "en_route"

    # Get Gemini narrative for this specific dispatch
    narrative = _dispatch_narrative(incident, amb, hosp)

    # Journey events for this dispatch action
    _add_event(db, incident_id, "ambulance_assigned", "ambulance", amb.unit_code,
               f"Dispatcher confirmed {amb.unit_code} ({amb.unit_type}). "
               f"Unit at {round(math.dist([amb.lat, amb.lng], [incident.lat, incident.lng]) * 111, 1)} km from scene. "
               f"Fuel: {amb.fuel_pct}%, Crew: {amb.crew_hours}h on shift.",
               amb.lat, amb.lng, amb.id)

    _add_event(db, incident_id, "hospital_selected", "hospital", hosp.name,
               f"{hosp.name} (Level {hosp.trauma_level} Trauma) pre-alerted. "
               f"{hosp.available_beds} beds available. HL7 pre-alert data transmitted.",
               hosp.lat, hosp.lng, hosp.id)

    _add_event(db, incident_id, "en_route", "ambulance", amb.unit_code,
               narrative, amb.lat, amb.lng, amb.id)

    # Police station notification (use nearest_police_station from incident notes if available)
    _add_event(db, incident_id, "police_notified", "police", "Local Police Unit",
               f"Police unit dispatched to support {amb.unit_code} at scene. "
               f"Scene perimeter and traffic management requested.",
               incident.lat, incident.lng)

    db.commit()

    # Fetch all events
    events = (db.query(IncidentEvent)
              .filter(IncidentEvent.incident_id == incident_id)
              .order_by(IncidentEvent.timestamp)
              .all())

    waypoints = _route_waypoints(amb.lat, amb.lng, incident.lat, incident.lng)

    return {
        "incident_id": incident_id,
        "status": "en_route",
        "assigned_ambulance": {
            "id": amb.id, "unit_code": amb.unit_code, "unit_type": amb.unit_type,
            "lat": amb.lat, "lng": amb.lng,
        },
        "assigned_hospital": {
            "id": hosp.id, "name": hosp.name, "trauma_level": hosp.trauma_level,
            "lat": hosp.lat, "lng": hosp.lng,
        },
        "route_waypoints": waypoints,
        "journey": [_event_to_dict(e) for e in events],
    }
