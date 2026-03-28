from sqlalchemy import Column, String, Integer, Float, Boolean, ForeignKey
from app.database import Base

class Incident(Base):
    __tablename__ = "incidents"
    id = Column(String, primary_key=True, index=True)
    incident_number = Column(String, index=True)
    raw_input = Column(String)
    incident_type = Column(String)
    severity = Column(String)
    location_raw = Column(String)
    lat = Column(Float, nullable=True) # Map Coords
    lng = Column(Float, nullable=True) # Map Coords
    patient_count = Column(Integer)
    special_notes = Column(String, nullable=True)
    status = Column(String)

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
