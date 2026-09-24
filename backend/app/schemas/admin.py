import re
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.models.enums import (
    DeviceKind,
    DeviceStatus,
    EquipmentStatus,
    EquipmentType,
    StaffRole,
    TicketCategory,
)
from app.models.equipment import EquipmentSpecs

_USERNAME = re.compile(r"^[a-z0-9][a-z0-9._-]{2,39}$")


def _username(v: str) -> str:
    v = v.strip().lower()
    if not _USERNAME.fullmatch(v):
        raise ValueError("Use de 3 a 40 caracteres: letras minúsculas, números, punto, guion o guion bajo.")
    return v


class OfficeIn(BaseModel):
    code: str = Field(min_length=2, max_length=20)
    name: str = Field(min_length=3, max_length=120)
    username: str
    zone_name: str | None = Field(default=None, max_length=120)
    location: str | None = Field(default=None, max_length=120)
    head_name: str | None = Field(default=None, max_length=120)
    head_phone: str | None = Field(default=None, max_length=20)
    priority_weight: float = Field(default=1.0, ge=0.5, le=2.0)

    _u = field_validator("username")(_username)

    @field_validator("code")
    @classmethod
    def _code(cls, v: str) -> str:
        return v.strip().upper()


class OfficePatch(BaseModel):
    name: str | None = Field(default=None, min_length=3, max_length=120)
    username: str | None = None
    zone_name: str | None = Field(default=None, max_length=120)
    location: str | None = Field(default=None, max_length=120)
    head_name: str | None = Field(default=None, max_length=120)
    head_phone: str | None = Field(default=None, max_length=20)
    priority_weight: float | None = Field(default=None, ge=0.5, le=2.0)
    active: bool | None = None

    @field_validator("username")
    @classmethod
    def _u(cls, v):
        return _username(v) if v is not None else v


class OfficeOut(BaseModel):
    id: str
    code: str
    name: str
    username: str
    zone_id: str | None = None
    zone_name: str | None = None
    location: str | None
    head_name: str | None
    head_phone: str | None
    priority_weight: float
    active: bool
    devices_approved: int = 0
    devices_pending: int = 0
    created_at: datetime


class OfficePasswordIn(BaseModel):
    new_password: str = Field(max_length=128)


class DeviceOut(BaseModel):
    id: str
    office_id: str
    office_name: str
    status: DeviceStatus
    pair_code: str
    kind: DeviceKind
    label: str | None
    user_agent: str | None
    first_ip: str | None
    last_ip: str | None
    equipment_id: str | None
    equipment_code: str | None
    last_seen_at: datetime
    created_at: datetime


class DeviceApproveIn(BaseModel):
    kind: DeviceKind
    label: str = Field(min_length=2, max_length=80)
    equipment_id: str | None = None


class StaffIn(BaseModel):
    username: str
    full_name: str = Field(min_length=3, max_length=120)
    email: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=20)
    role: StaffRole
    specialties: list[TicketCategory] = []

    _u = field_validator("username")(_username)


class StaffPatch(BaseModel):
    full_name: str | None = Field(default=None, min_length=3, max_length=120)
    email: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=20)
    role: StaffRole | None = None
    specialties: list[TicketCategory] | None = None
    active: bool | None = None


class StaffOut(BaseModel):
    id: str
    username: str
    full_name: str
    email: str | None
    phone: str | None
    role: StaffRole
    specialties: list[TicketCategory]
    active: bool
    totp_enabled: bool
    locked: bool
    last_login_at: datetime | None
    open_tickets: int = 0


class StaffCreatedOut(BaseModel):
    staff: StaffOut
    temporary_password: str


class EquipmentIn(BaseModel):
    patrimonial_code: str = Field(min_length=3, max_length=40)
    type: EquipmentType
    area: str | None = Field(default=None, max_length=120)
    device_label: str | None = Field(default=None, max_length=120)
    brand: str | None = Field(default=None, max_length=60)
    model: str | None = Field(default=None, max_length=80)
    hostname: str | None = Field(default=None, max_length=80)
    ip_address: str | None = Field(default=None, max_length=45)
    mac_address: str | None = Field(default=None, max_length=17)
    office_id: str | None = None
    responsible_name: str | None = Field(default=None, max_length=120)
    responsible_type: str = Field(default="USUARIO", pattern="^(USUARIO|JEFE|OFICINA)$")
    property_type: str | None = Field(default=None, max_length=80)
    specs: EquipmentSpecs = EquipmentSpecs()
    acquired_on: datetime | None = None
    warranty_until: datetime | None = None
    status: EquipmentStatus = EquipmentStatus.OPERATIVO
    criticality: int = Field(default=1, ge=1, le=3)
    notes: str | None = Field(default=None, max_length=1000)

    @field_validator("patrimonial_code")
    @classmethod
    def _code(cls, v: str) -> str:
        return v.strip().upper()

    @field_validator("ip_address")
    @classmethod
    def _ip(cls, v):
        if v:
            import ipaddress

            ipaddress.ip_address(v.strip())
            return v.strip()
        return None


class EquipmentOut(EquipmentIn):
    id: str
    inventory_id: str | None = None
    office_name: str | None = None
    zone_id: str | None = None
    zone_name: str | None = None
    created_at: datetime
    updated_at: datetime
