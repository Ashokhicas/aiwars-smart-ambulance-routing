"""
AmbulAI Backend Tests
Validates core API endpoints using an in-memory SQLite database.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.database import Base, get_db

# Use an isolated in-memory database for every test run
TEST_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db

# Create all tables once before tests run
Base.metadata.create_all(bind=engine)

client = TestClient(app)


# ---------------------------------------------------------------------------
# Health & Config
# ---------------------------------------------------------------------------

def test_health_check():
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "db" in data
    assert "ai" in data


def test_get_config():
    response = client.get("/api/v1/config")
    assert response.status_code == 200
    assert "maps_api_key" in response.json()


# ---------------------------------------------------------------------------
# Fleet
# ---------------------------------------------------------------------------

def test_get_fleet_returns_structure():
    response = client.get("/api/v1/fleet")
    assert response.status_code == 200
    data = response.json()
    assert "ambulances" in data
    assert "hospitals" in data
    assert isinstance(data["ambulances"], list)
    assert isinstance(data["hospitals"], list)


# ---------------------------------------------------------------------------
# Incidents
# ---------------------------------------------------------------------------

def test_create_incident_with_text():
    response = client.post(
        "/api/v1/incidents",
        data={"raw_input": "Car crash on MG Road near Trinity Circle, 2 injured"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "incident_id" in data
    assert "incident_number" in data
    assert data["status"] == "new"
    assert "extracted" in data
    # AI may be offline in CI — fallback values should still be returned
    extracted = data["extracted"]
    assert "incident_type" in extracted
    assert "severity" in extracted
    assert "lat" in extracted
    assert "lng" in extracted


def test_create_incident_no_input_returns_400():
    response = client.post("/api/v1/incidents", data={})
    assert response.status_code == 400


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

def test_dispatch_recommend_unknown_incident_returns_404():
    response = client.post("/api/v1/dispatch/recommend?incident_id=nonexistent-id")
    assert response.status_code == 404


def test_dispatch_recommend_returns_valid_structure():
    create_res = client.post(
        "/api/v1/incidents",
        data={"raw_input": "Cardiac arrest at Koramangala 5th Block"},
    )
    assert create_res.status_code == 200
    incident_id = create_res.json()["incident_id"]

    rec_res = client.post(f"/api/v1/dispatch/recommend?incident_id={incident_id}")
    assert rec_res.status_code == 200
    data = rec_res.json()
    assert "recommendations" in data
    assert "recommended_hospital" in data
    assert isinstance(data["recommendations"], list)
    assert len(data["recommendations"]) > 0
    rec = data["recommendations"][0]
    assert "unit_code" in rec
    assert "eta_minutes" in rec


# ---------------------------------------------------------------------------
# Journey & confirm-dispatch
# ---------------------------------------------------------------------------

def test_get_active_incidents():
    response = client.get("/api/v1/incidents/active")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_incident_journey_created_on_intake():
    res = client.post("/api/v1/incidents", data={"raw_input": "Fire at MG Road"})
    assert res.status_code == 200
    incident_id = res.json()["incident_id"]

    journey_res = client.get(f"/api/v1/incidents/{incident_id}/journey")
    assert journey_res.status_code == 200
    data = journey_res.json()
    assert "journey" in data
    # Two initial events should exist: reported + ai_parsed
    assert len(data["journey"]) >= 2
    event_types = [e["event_type"] for e in data["journey"]]
    assert "reported" in event_types
    assert "ai_parsed" in event_types


def test_get_journey_unknown_incident_returns_404():
    response = client.get("/api/v1/incidents/nonexistent/journey")
    assert response.status_code == 404


def test_confirm_dispatch_creates_events_and_returns_waypoints():
    # Create incident
    create_res = client.post("/api/v1/incidents", data={"raw_input": "Stroke at Indiranagar"})
    assert create_res.status_code == 200
    incident_id = create_res.json()["incident_id"]

    # Get recommend to obtain ambulance + hospital IDs
    rec_res = client.post(f"/api/v1/dispatch/recommend?incident_id={incident_id}")
    assert rec_res.status_code == 200
    rec = rec_res.json()
    ambulance_id = rec["recommendations"][0]["unit_id"]
    hospital_id = rec["recommended_hospital"]["hospital_id"]

    # Confirm dispatch
    confirm_res = client.post(
        f"/api/v1/dispatch/confirm?incident_id={incident_id}"
        f"&ambulance_id={ambulance_id}&hospital_id={hospital_id}"
    )
    assert confirm_res.status_code == 200
    data = confirm_res.json()
    assert data["status"] == "en_route"
    assert "route_waypoints" in data
    assert len(data["route_waypoints"]) > 0
    assert "journey" in data
    # Should now have: reported + ai_parsed + ambulance_assigned + hospital_selected + en_route + police_notified
    assert len(data["journey"]) >= 4
