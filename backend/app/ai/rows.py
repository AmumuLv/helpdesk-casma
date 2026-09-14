from dataclasses import dataclass
from datetime import datetime


@dataclass(slots=True)
class TicketRow:
    id: str
    number: str
    office_id: str
    office_location: str | None
    device_id: str | None
    equipment_id: str | None
    category: str
    category_source: str
    priority: str
    status: str
    subject: str
    description: str
    created_at: datetime
    resolved_at: datetime | None
    assigned_to_id: str | None
    resolution_notes: str | None

    @property
    def text(self) -> str:
        return f"{self.subject}. {self.description}".strip()


@dataclass(slots=True)
class EquipmentRow:
    id: str
    code: str
    type: str
    brand: str | None
    model: str | None
    office_id: str | None
    acquired_on: datetime | None
    criticality: int
    status: str


PHYSICAL_CATEGORIES = {"HARDWARE", "IMPRESORA", "PERIFERICOS"}
