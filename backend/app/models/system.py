from datetime import datetime
from typing import Annotated, Any

from beanie import Document, Indexed, PydanticObjectId
from pydantic import Field

from app.core.timeutil import utcnow
from app.models.enums import TicketCategory


class SystemSetting(Document):
    key: Annotated[str, Indexed(unique=True)]
    value: dict[str, Any] = Field(default_factory=dict)
    updated_at: datetime = Field(default_factory=utcnow)

    class Settings:
        name = "settings"


class AuditLog(Document):
    at: Annotated[datetime, Indexed()] = Field(default_factory=utcnow)
    actor_type: str
    actor_id: str | None = None
    actor_name: str | None = None
    action: str
    target_type: str | None = None
    target_id: str | None = None
    ip: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)

    class Settings:
        name = "audit_logs"


class Announcement(Document):
    key: Annotated[str, Indexed()]
    office_ids: list[PydanticObjectId] = Field(default_factory=list)
    category: TicketCategory | None = None
    title: str
    message: str
    staff_message: str
    source: str = "ANOMALIA"
    active_until: Annotated[datetime, Indexed()]
    created_at: datetime = Field(default_factory=utcnow)

    class Settings:
        name = "announcements"


class AIModelRecord(Document):
    version: str
    trained_at: datetime = Field(default_factory=utcnow)
    backend: str
    samples: dict[str, int] = Field(default_factory=dict)
    metrics: dict[str, Any] = Field(default_factory=dict)

    class Settings:
        name = "ai_models"
