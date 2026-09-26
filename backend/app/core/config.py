from functools import lru_cache
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Help Desk TI - Municipalidad Provincial de Casma"
    environment: str = Field(default="production", pattern="^(development|production|test)$")

    mongo_uri: str
    mongo_db: str = "helpdesk_casma"

    jwt_secret: str = Field(min_length=32)
    field_encryption_key: str = Field(min_length=32)
    cookie_secure: bool = True
    cors_origins: Annotated[list[str], NoDecode] = []

    office_allowed_networks: Annotated[list[str], NoDecode] = []
    require_device_approval: bool = True
    office_session_days: int = 30
    staff_session_hours: int = 9
    mfa_token_minutes: int = 5
    staff_max_failed_logins: int = 5
    staff_lock_minutes: int = 15

    upload_dir: str = "./storage/uploads"
    model_dir: str = "./storage/models"
    backup_dir: str = "./storage/backups"
    backup_retention_days: int = Field(default=14, ge=1, le=365)
    max_upload_mb: int = 8

    public_base_url: str = "http://localhost:5173"
    timezone: str = "America/Lima"
    run_scheduler: bool = True

    ai_embeddings: str = Field(default="tfidf", pattern="^(tfidf|sentence-transformers)$")
    ai_embedding_model: str = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    ai_auto_assign_urgent: bool = False
    ai_retrain_every_resolved: int = 25

    @field_validator("cors_origins", "office_allowed_networks", mode="before")
    @classmethod
    def _split_csv(cls, v):
        if isinstance(v, str):
            return [x.strip() for x in v.split(",") if x.strip()]
        return v

    @property
    def is_dev(self) -> bool:
        return self.environment != "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
