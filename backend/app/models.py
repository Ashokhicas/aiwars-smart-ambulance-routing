from sqlalchemy import Column, String, Integer, Float, Boolean, ForeignKey
from app.database import Base

class Incident(Base):
    __tablename__ = "incidents"
    id = Column(String, primary_key=True, index=True)
    incident_number = Column(String, index=True)
    raw_input = Column(String)
    incident_title = Column(String, nullable=True)
    incident_type = Column(String)
    severity = Column(String)
    location_raw = Column(String)
    location_confidence = Column(String, nullable=True)  # high / medium / low
    lat = Column(Float, nullable=True)
    lng = Column(Float, nullable=True)
    patient_count = Column(Integer)
    transcription = Column(String, nullable=True)
    visual_description = Column(String, nullable=True)
    special_notes = Column(String, nullable=True)
    assigned_ambulance_id = Column(String, ForeignKey("ambulances.id"), nullable=True)
    assigned_hospital_id = Column(String, ForeignKey("hospitals.id"), nullable=True)
    status = Column(String)  # new | en_route | arrived | handoff | completed

class IncidentEvent(Base):
    """One row per status transition or actor action on an incident."""
    __tablename__ = "incident_events"
    id = Column(String, primary_key=True)
    incident_id = Column(String, ForeignKey("incidents.id"), index=True)
    event_type = Column(String)   # reported | ai_parsed | ambulance_assigned | hospital_selected
                                  # police_notified | en_route | arrived_scene | patient_handoff | completed
    actor_type = Column(String)   # reporter | ai_system | ambulance | hospital | police
    actor_id = Column(String, nullable=True)
    actor_name = Column(String)
    narrative = Column(String)    # Gemini or static description of what happened
    timestamp = Column(String)    # ISO-8601
    lat = Column(Float, nullable=True)
    lng = Column(Float, nullable=True)

class Ambulance(Base):
    __tablename__ = "ambulances"
    id = Column(String, primary_key=True)
    unit_code = Column(String, unique=True)
    unit_type = Column(String)
    fuel_pct = Column(Float)
    crew_hours = Column(Float)
    lat = Column(Float, nullable=True)
    lng = Column(Float, nullable=True)

class Hospital(Base):
    __tablename__ = "hospitals"
    id = Column(String, primary_key=True)
    name = Column(String)
    trauma_level = Column(Integer)
    available_beds = Column(Integer)
    is_diverting = Column(Boolean)
    lat = Column(Float, nullable=True)
    lng = Column(Float, nullable=True)
