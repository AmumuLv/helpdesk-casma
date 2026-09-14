from datetime import datetime
from typing import Annotated

from beanie import Document, Indexed, PydanticObjectId
from pydantic import BaseModel, Field

from app.core.timeutil import utcnow
from app.models.enums import EquipmentStatus, EquipmentType


class EquipmentSpecs(BaseModel):
    cpu: str | None = None
    ram_gb: float | None = None
    storage_gb: float | None = None
    os: str | None = None


class Equipment(Document):
    patrimonial_code: Annotated[str, Indexed(unique=True)]
    type: EquipmentType
    brand: str | None = None
    model: str | None = None
    serial_number: str | None = None
    hostname: str | None = None
    ip_address: str | None = None
    mac_address: str | None = None
    office_id: Annotated[PydanticObjectId | None, Indexed()] = None
    specs: EquipmentSpecs = Field(default_factory=EquipmentSpecs)
    acquired_on: datetime | None = None
    warranty_until: datetime | None = None
    status: EquipmentStatus = EquipmentStatus.OPERATIVO
    criticality: int = Field(default=1, ge=1, le=3)
    notes: str | None = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)

    class Settings:
        name = "equipment"
