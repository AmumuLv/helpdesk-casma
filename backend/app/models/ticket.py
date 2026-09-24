from datetime import datetime
from enum import StrEnum
from typing import Annotated

from beanie import Document, Indexed, PydanticObjectId
from pydantic import BaseModel, Field, model_validator

from app.core.timeutil import utcnow
from app.models.enums import (
    EquipmentType,
    QuickIssue,
    TicketCategory,
    TicketChannel,
    TicketPriority,
    TicketStatus,
    TimelineKind,
)


class ResolutionType(StrEnum):
    SOLUCIONADO = "SOLUCIONADO"
    REPARADO = "REPARADO"
    REEMPLAZADO = "REEMPLAZADO"
    OBSOLETO = "OBSOLETO"
    IRREPARABLE = "IRREPARABLE"
    BAJA_PATRIMONIAL = "BAJA_PATRIMONIAL"
    DERIVADO = "DERIVADO"


class AttachmentMeta(BaseModel):
    id: str
    path: str
    content_type: str = "image/jpeg"
    size: int
    width: int
    height: int
    uploaded_at: datetime = Field(default_factory=utcnow)


class TimelineEntry(BaseModel):
    at: datetime = Field(default_factory=utcnow)
    kind: TimelineKind
    actor: str
    text: str
    internal: bool = False


class SimilarCase(BaseModel):
    ticket_id: str
    number: str
    subject: str
    score: float
    resolution: str | None = None


class AIAnalysis(BaseModel):
    category: TicketCategory
    category_confidence: float
    priority: TicketPriority
    priority_score: float
    priority_reasons: list[str] = Field(default_factory=list)
    suggested_technician_id: str | None = None
    suggested_technician_name: str | None = None
    technician_reasons: list[str] = Field(default_factory=list)
    similar_cases: list[SimilarCase] = Field(default_factory=list)
    equipment_risk: float | None = None
    equipment_risk_factors: list[str] = Field(default_factory=list)
    equipment_incidents_90d: int = 0
    related_alert: str | None = None
    briefing: str = ""
    user_message: str = ""
    user_tips: list[str] = Field(default_factory=list)
    model_version: str = "heuristic"


class EquipmentSnapshot(BaseModel):
    id: str
    patrimonial_code: str
    type: EquipmentType
    brand: str | None = None
    model: str | None = None
    ip_address: str | None = None
    hostname: str | None = None


class Resolution(BaseModel):
    notes: str
    resolved_by_id: str
    resolved_by_name: str
    tipo_resolucion: ResolutionType = ResolutionType.SOLUCIONADO
    resolved_at: datetime = Field(default_factory=utcnow)
    confirmed_by_user: bool | None = None

    @model_validator(mode="before")
    @classmethod
    def _migrate_legacy_resolution_status(cls, data):
        """Convierte el campo temporal 'status' usado en versiones anteriores."""
        if not isinstance(data, dict) or "tipo_resolucion" in data or "status" not in data:
            return data
        values = dict(data)
        legacy = values.pop("status")
        mapping = {
            "Resuelto": ResolutionType.SOLUCIONADO,
            "Resuelto - Reparado": ResolutionType.REPARADO,
            "Resuelto - Reemplazado": ResolutionType.REEMPLAZADO,
            "Resuelto - Obsoleto": ResolutionType.OBSOLETO,
            "Resuelto - Baja patrimonial": ResolutionType.BAJA_PATRIMONIAL,
            "Resuelto - Derivado": ResolutionType.DERIVADO,
        }
        values["tipo_resolucion"] = mapping.get(legacy, ResolutionType.SOLUCIONADO)
        return values


class Ticket(Document):
    number: Annotated[str, Indexed(unique=True)]
    # La zona se conserva en el ticket para mantener trazabilidad histórica
    # aunque posteriormente cambie la oficina de zona.
    zone_id: Annotated[PydanticObjectId | None, Indexed()] = None
    office_id: Annotated[PydanticObjectId, Indexed()]
    office_name: str
    office_location: str | None = None
    # Usuario que reporta/posee el ticket dentro de la oficina.
    user_id: Annotated[PydanticObjectId | None, Indexed()] = None
    device_id: PydanticObjectId | None = None
    equipment_id: Annotated[PydanticObjectId | None, Indexed()] = None
    equipment: EquipmentSnapshot | None = None
    channel: TicketChannel
    quick_issue: QuickIssue | None = None
    subject: str
    description: str = ""
    reporter_name: str | None = None
    contact_phone: str | None = None
    category: TicketCategory
    category_source: str = "IA"
    priority_source: str = "IA"
    priority: TicketPriority
    status: Annotated[TicketStatus, Indexed()] = TicketStatus.PENDIENTE
    assigned_to_id: Annotated[PydanticObjectId | None, Indexed()] = None
    assigned_to_name: str | None = None
    attachments: list[AttachmentMeta] = Field(default_factory=list)
    ai: AIAnalysis | None = None
    resolution: Resolution | None = None
    timeline: list[TimelineEntry] = Field(default_factory=list)
    created_by_staff_id: PydanticObjectId | None = None
    first_response_at: datetime | None = None
    deleted_at: datetime | None = None
    created_at: Annotated[datetime, Indexed()] = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)

    @model_validator(mode="after")
    def _validate_hierarchy(self):
        if self.user_id is not None and self.office_id is None:
            raise ValueError("Un ticket con user_id debe pertenecer a una oficina.")
        return self

    class Settings:
        name = "tickets"
