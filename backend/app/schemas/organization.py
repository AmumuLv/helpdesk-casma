from app.models.enums import OfficeServiceLevel
from app.schemas.admin import EquipmentOut, OfficeOut
from app.schemas.ticket import TicketOut
from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class ZoneIn(BaseModel):
    code: str = Field(min_length=2, max_length=30)
    name: str = Field(min_length=3, max_length=120)
    description: str | None = Field(default=None, max_length=300)

    @field_validator("code")
    @classmethod
    def _code(cls, value: str) -> str:
        return value.strip().upper()


class ZonePatch(BaseModel):
    name: str | None = Field(default=None, min_length=3, max_length=120)
    description: str | None = Field(default=None, max_length=300)
    active: bool | None = None


class ZoneOut(BaseModel):
    id: str
    code: str
    name: str
    description: str | None
    active: bool
    office_count: int = 0
    user_count: int = 0
    equipment_count: int = 0
    created_at: datetime
    updated_at: datetime


class MunicipalUserIn(BaseModel):
    employee_code: str | None = Field(default=None, max_length=40)
    full_name: str = Field(min_length=3, max_length=120)
    office_id: str
    job_title: str | None = Field(default=None, max_length=120)
    email: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=20)

    @field_validator("employee_code")
    @classmethod
    def _employee_code(cls, value):
        return value.strip().upper() if value else None


class MunicipalUserPatch(BaseModel):
    employee_code: str | None = Field(default=None, max_length=40)
    full_name: str | None = Field(default=None, min_length=3, max_length=120)
    office_id: str | None = None
    job_title: str | None = Field(default=None, max_length=120)
    email: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=20)
    active: bool | None = None

    @field_validator("employee_code")
    @classmethod
    def _employee_code(cls, value):
        return value.strip().upper() if value else None


class MunicipalUserOut(BaseModel):
    id: str
    employee_code: str | None
    full_name: str
    office_id: str
    office_name: str
    zone_id: str | None
    zone_name: str | None
    job_title: str | None
    email: str | None
    phone: str | None
    photo_url: str | None = None
    active: bool
    equipment_count: int = 0
    created_at: datetime
    updated_at: datetime


class OrganizationOfficeSummary(BaseModel):
    id: str
    code: str
    name: str
    location: str | None
    head_name: str | None
    service_level: OfficeServiceLevel
    service_reason: str | None
    active: bool
    user_count: int
    equipment_count: int
    ticket_count: int


class ZoneProfileOut(BaseModel):
    zone: ZoneOut
    offices: list[OrganizationOfficeSummary]
    recent_tickets: list[TicketOut]


class OfficeProfileOut(BaseModel):
    office: OfficeOut
    users: list[MunicipalUserOut]
    equipment: list[EquipmentOut]
    recent_tickets: list[TicketOut]
    ticket_count: int


class MunicipalUserProfileOut(BaseModel):
    user: MunicipalUserOut
    equipment: list[EquipmentOut]
    recent_tickets: list[TicketOut]
    ticket_count: int
