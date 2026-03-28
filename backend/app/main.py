from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup logic
    print("AmbulAI Backend Starting...")
    yield
    # Shutdown logic
    print("AmbulAI Backend Shutting down...")

app = FastAPI(title="AmbulAI API", version="1.0.0", lifespan=lifespan)

class IncidentInput(BaseModel):
    raw_input: str
    input_type: str = "text"

@app.get("/api/v1/health")
async def health_check():
    return {"status": "ok", "service": "ambulai-backend"}

@app.post("/api/v1/incidents")
async def create_incident(incident: IncidentInput):
    if len(incident.raw_input) < 10:
        raise HTTPException(status_code=400, detail="Input too short")
    
    # Mock AI Processing for MVP
    return {
        "incident_id": "mock-uuid-1234",
        "incident_number": "INC-2026-0001",
        "extracted": {
            "incident_type": "trauma",
            "severity": "P1",
            "location_raw": incident.raw_input,
            "patient_count": 1,
            "special_notes": "Extracted via MVP stub"
        },
        "status": "new"
    }

@app.post("/api/v1/dispatch/recommend")
async def recommend_dispatch(incident_id: str):
    # Mock Recommendation mapping Agent Output
    return {
        "incident_id": incident_id,
        "recommendations": [
            {
                "rank": 1,
                "unit_id": "amb-001",
                "unit_code": "AMB-01",
                "unit_type": "ALS",
                "eta_minutes": 3.5,
                "score": 0.95,
                "rationale": "Closest ALS unit with optimal fuel and crew hours."
            }
        ],
        "recommended_hospital": {
            "hospital_id": "hosp-001",
            "name": "General Hospital",
            "trauma_level": 1,
            "eta_from_scene_minutes": 7,
            "is_diverting": False
        }
    }
