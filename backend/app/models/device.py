from datetime import datetime
from typing import Annotated

from beanie import Document, Indexed, PydanticObjectId
from pydantic import Field

from app.core.timeutil import utcnow
from app.models.enums import DeviceKind, DeviceStatus


class Device(Document):
    office_id: Annotated[PydanticObjectId, Indexed()]
    token_hash: Annotated[str, Indexed(unique=True)]
    status: Annotated[DeviceStatus, Indexed()] = DeviceStatus.PENDIENTE
    pair_code: str
    kind: DeviceKind = DeviceKind.OTRO
    label: str | None = None
    user_agent: str | None = None
    first_ip: str | None = None
    last_ip: str | None = None
    equipment_id: PydanticObjectId | None = None
    reviewed_by: PydanticObjectId | None = None
    reviewed_at: datetime | None = None
    last_seen_at: datetime = Field(default_factory=utcnow)
    created_at: datetime = Field(default_factory=utcnow)

    class Settings:
        name = "devices"
