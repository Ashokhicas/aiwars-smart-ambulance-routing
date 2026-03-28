from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./ambulai.db"
    GEMINI_API_KEY: str = ""
    MAPS_API_KEY: str = ""
    JWT_SECRET: str = "super_secret"

    class Config:
        env_file = ".env"

settings = Settings()
