from datetime import datetime

from pydantic import BaseModel, Field

from app.models.enums import QuickIssue, TicketCategory, TicketChannel, TicketPriority, TicketStatus
from app.models.ticket import AIAnalysis, EquipmentSnapshot, Resolution, ResolutionType, TimelineEntry


class AttachmentOut(BaseModel):
    id: str
    url: str
    width: int
    height: int


class TicketOut(BaseModel):
    id: str
    number: str
    office_id: str
    office_name: str
    office_location: str | None
    equipment: EquipmentSnapshot | None
    channel: TicketChannel
    quick_issue: QuickIssue | None
    subject: str
    description: str
    reporter_name: str | None
    contact_phone: str | None
    category: TicketCategory
    category_source: str
    priority: TicketPriority
    priority_source: str
    status: TicketStatus
    assigned_to_id: str | None
    assigned_to_name: str | None
    attachments: list[AttachmentOut]
    ai: AIAnalysis | None
    resolution: Resolution | None
    timeline: list[TimelineEntry]
    first_response_at: datetime | None
    created_at: datetime
    updated_at: datetime


class OfficeTimelineItem(BaseModel):
    at: datetime
    actor: str
    text: str


class OfficeTicketOut(BaseModel):
    id: str
    number: str
    subject: str
    description: str
    status: TicketStatus
    priority: TicketPriority
    equipment_code: str | None
    assigned_to_name: str | None
    attachments: list[AttachmentOut]
    user_message: str
    user_tips: list[str]
    resolution_notes: str | None
    confirmed_by_user: bool | None
    timeline: list[OfficeTimelineItem]
    created_at: datetime
    updated_at: datetime


class OfficeTicketCreatedOut(BaseModel):
    ticket: OfficeTicketOut
    duplicated: bool


class TicketPatch(BaseModel):
    category: TicketCategory | None = None
    priority: TicketPriority | None = None


class AssignIn(BaseModel):
    technician_id: str | None = None


class NoteIn(BaseModel):
    text: str = Field(min_length=2, max_length=2000)
    visible_to_office: bool = False


class ResolveIn(BaseModel):
    notes: str = Field(min_length=5, max_length=2000)
    tipo_resolucion: ResolutionType = ResolutionType.SOLUCIONADO


class ConfirmIn(BaseModel):
    solved: bool


class TriagePreviewIn(BaseModel):
    office_id: str
    description: str = Field(default="", max_length=2000)
    subject: str | None = Field(default=None, max_length=160)
    quick_issue: QuickIssue | None = None
    equipment_id: str | None = None


class KpiOut(BaseModel):
    total: int
    pendientes: int
    en_proceso: int
    resueltos: int
    urgentes_abiertos: int
    nuevos_hoy: int
    sin_asignar: int
    horas_primera_respuesta_30d: float | None
