from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from app.core.config import settings

# Supports dynamic switching between SQLite and GCP Postgres
engine_args = {}
if settings.DATABASE_URL.startswith("sqlite"):
    engine_args["check_same_thread"] = False

engine = create_engine(settings.DATABASE_URL, connect_args=engine_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
