from datetime import datetime
from typing import Annotated

from beanie import Document, Indexed
from pydantic import Field

from app.core.timeutil import utcnow
from app.models.enums import StaffRole, TicketCategory


class StaffUser(Document):
    username: Annotated[str, Indexed(unique=True)]
    full_name: str
    email: str | None = None
    phone: str | None = None
    role: StaffRole
    specialties: list[TicketCategory] = Field(default_factory=list)
    password_hash: str
    must_change_password: bool = False
    totp_secret_enc: str | None = None
    totp_enabled: bool = False
    totp_last_step: int | None = None
    failed_attempts: int = 0
    locked_until: datetime | None = None
    session_version: int = 1
    active: bool = True
    last_login_at: datetime | None = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)

    class Settings:
        name = "staff_users"
