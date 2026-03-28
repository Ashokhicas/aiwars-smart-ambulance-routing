from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://postgres:postgres@localhost:5432/ambulai"
    REDIS_URL: str = "redis://localhost:6379/0"
    GEMINI_API_KEY: str = ""
    MAPS_API_KEY: str = ""
    JWT_SECRET: str = "super_secret"

    class Config:
        env_file = ".env"

settings = Settings()
