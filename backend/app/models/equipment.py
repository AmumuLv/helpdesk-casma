from datetime import datetime
from typing import Annotated, Any

from beanie import Document, Indexed, PydanticObjectId
from pydantic import BaseModel, Field, model_validator

from app.core.timeutil import utcnow
from app.models.enums import EquipmentStatus, EquipmentType


class EquipmentSpecs(BaseModel):
    cpu: str | None = None
    ram_gb: float | None = None
    storage_gb: float | None = None
    os: str | None = None


class Equipment(Document):
    # Nombre legado usado por la API actual.
    patrimonial_code: Annotated[str, Indexed(unique=True)]
    # Nombre solicitado para la estructura patrimonial. Se sincroniza con
    # patrimonial_code para no romper clientes ni registros existentes.
    codigo_patrimonial: Annotated[str | None, Indexed(unique=True, sparse=True)] = None
    type: EquipmentType
    brand: str | None = None
    model: str | None = None
    serial_number: str | None = None
    hostname: str | None = None
    ip_address: str | None = None
    mac_address: str | None = None
    office_id: Annotated[PydanticObjectId | None, Indexed()] = None
    # Usuario responsable dentro de la oficina: Zona > Oficina > Usuario.
    responsable_id: Annotated[PydanticObjectId | None, Indexed()] = None
    specs: EquipmentSpecs = Field(default_factory=EquipmentSpecs)
    acquired_on: datetime | None = None
    warranty_until: datetime | None = None
    status: EquipmentStatus = EquipmentStatus.OPERATIVO
    criticality: int = Field(default=1, ge=1, le=3)
    notes: str | None = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)

    @model_validator(mode="before")
    @classmethod
    def _sync_patrimonial_code(cls, data: Any):
        """Acepta ambos nombres y conserva un único valor normalizado."""
        if not isinstance(data, dict):
            return data
        values = dict(data)
        code = values.get("codigo_patrimonial") or values.get("patrimonial_code")
        if code is not None:
            normalized = str(code).strip().upper()
            values["patrimonial_code"] = normalized
            values["codigo_patrimonial"] = normalized
        return values

    @model_validator(mode="after")
    def _validate_responsable_office(self):
        if self.responsable_id is not None and self.office_id is None:
            raise ValueError("Un equipo con responsable_id debe pertenecer a una oficina.")
        return self

    class Settings:
        name = "equipment"
