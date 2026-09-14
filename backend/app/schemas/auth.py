from typing import Literal

from pydantic import BaseModel, Field

from app.models.enums import DeviceStatus, StaffRole, TicketCategory


class OfficeLoginIn(BaseModel):
    username: str = Field(min_length=2, max_length=60)
    password: str = Field(min_length=1, max_length=128)


class OfficeLoginOut(BaseModel):
    status: DeviceStatus
    pair_code: str | None = None


class StaffLoginIn(BaseModel):
    username: str = Field(min_length=2, max_length=60)
    password: str = Field(min_length=1, max_length=128)


class StaffLoginOut(BaseModel):
    mfa_token: str
    mfa_setup_required: bool


class MfaTokenIn(BaseModel):
    mfa_token: str = Field(max_length=2048)


class MfaVerifyIn(MfaTokenIn):
    code: str = Field(pattern=r"^\s*\d{3}\s*\d{3}\s*$")


class MfaSetupOut(BaseModel):
    secret: str
    otpauth_uri: str
    qr_data_uri: str


class PasswordChangeIn(BaseModel):
    current_password: str = Field(max_length=128)
    new_password: str = Field(max_length=128)


class StaffMe(BaseModel):
    id: str
    username: str
    full_name: str
    role: StaffRole
    specialties: list[TicketCategory]
    must_change_password: bool


class OfficeMe(BaseModel):
    id: str
    name: str
    location: str | None
    head_name: str | None
    device_id: str
    device_status: DeviceStatus
    pair_code: str | None
    equipment_id: str | None


class MeOut(BaseModel):
    kind: Literal["staff", "office"]
    staff: StaffMe | None = None
    office: OfficeMe | None = None
