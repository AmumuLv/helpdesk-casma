from collections import Counter

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from pymongo.errors import DuplicateKeyError

from app.api.deps import parse_id, require_admin
from app.core.security import hash_password, office_password_errors, temp_password
from app.core.timeutil import utcnow
from app.models import AuditLog, Device, Equipment, Office, StaffUser, Ticket, Zone
from app.models.enums import DeviceStatus, OfficeServiceLevel, StaffRole, TicketStatus
from app.schemas.admin import (
    DeviceApproveIn,
    DeviceOut,
    OfficeIn,
    OfficeOut,
    OfficePasswordIn,
    OfficePatch,
    StaffCreatedOut,
    StaffIn,
    StaffOut,
    StaffPatch,
)
from app.schemas.common import Message
from app.services import audit
from app.services.events import broker
from app.services.office_access import get_office_access, set_office_password
from app.services.serializers import device_out, office_out, staff_out

router = APIRouter(prefix="/admin", tags=["administración"])


async def _log(request: Request, admin: StaffUser, action: str, target_type: str, target_id: str, **details) -> None:
    await audit.record(request, "staff", action, actor_id=str(admin.id), actor_name=admin.full_name, target_type=target_type, target_id=target_id, **details)


async def _get_or_404(model, raw_id: str, label: str):
    oid = parse_id(raw_id)
    doc = await model.get(oid) if oid else None
    if not doc:
        raise HTTPException(status_code=404, detail=f"{label} no encontrado.")
    return doc


async def _office_zone_data(zone_id: str | None, zone_name: str | None = None) -> tuple[object | None, str | None]:
    if zone_id:
        zid = parse_id(zone_id)
        zone = await Zone.get(zid) if zid else None
        if not zone or not zone.active:
            raise HTTPException(status_code=422, detail="Zona no válida o inactiva.")
        return zone.id, zone.name
    return None, zone_name.strip() if zone_name else None


_SERVICE_WEIGHT_MIN = {
    OfficeServiceLevel.NORMAL: 1.0,
    OfficeServiceLevel.ATENCION_PUBLICO: 1.25,
    OfficeServiceLevel.SERVICIO_CRITICO: 1.5,
}


def _normalize_service_weight(data: dict, current: Office | None = None) -> dict:
    result = dict(data)
    level = result.get("service_level", current.service_level if current else OfficeServiceLevel.NORMAL)
    if isinstance(level, str):
        level = OfficeServiceLevel(level)
    result["service_level"] = level

    default_weight = _SERVICE_WEIGHT_MIN[level]
    if "priority_weight" in result:
        result["priority_weight"] = max(float(result["priority_weight"]), default_weight)
    elif "service_level" in data:
        result["priority_weight"] = default_weight
    return result


# ---------- Oficinas ----------
@router.get("/offices", response_model=list[OfficeOut])
async def list_offices(_: StaffUser = Depends(require_admin)):
    offices = await Office.find_all().sort("name").to_list()
    devices = await Device.get_pymongo_collection().find({}, {"office_id": 1, "status": 1}).to_list(None)
    approved = Counter(str(d["office_id"]) for d in devices if d["status"] == DeviceStatus.APROBADO.value)
    pending = Counter(str(d["office_id"]) for d in devices if d["status"] == DeviceStatus.PENDIENTE.value)
    return [office_out(o, approved.get(str(o.id), 0), pending.get(str(o.id), 0)) for o in offices]


@router.post("/offices", response_model=OfficeOut, status_code=201)
async def create_office(request: Request, body: OfficeIn, admin: StaffUser = Depends(require_admin)):
    data = body.model_dump()
    zone_id, zone_name = await _office_zone_data(data.pop("zone_id", None), data.get("zone_name"))
    data["zone_id"] = zone_id
    data["zone_name"] = zone_name
    data = _normalize_service_weight(data)
    office = Office(**data)
    try:
        await office.insert()
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Ya existe una oficina con ese código o usuario.")
    await _log(request, admin, "office.created", "office", str(office.id), username=office.username)
    return office_out(office)


@router.patch("/offices/{office_id}", response_model=OfficeOut)
async def update_office(request: Request, office_id: str, body: OfficePatch, admin: StaffUser = Depends(require_admin)):
    office: Office = await _get_or_404(Office, office_id, "Oficina")
    changes = body.model_dump(exclude_unset=True)
    if "zone_id" in changes:
        zone_id, zone_name = await _office_zone_data(changes.pop("zone_id"), changes.get("zone_name"))
        changes["zone_id"] = zone_id
        changes["zone_name"] = zone_name
    changes = _normalize_service_weight(changes, office)
    if ("username" in changes and changes["username"] != office.username) or changes.get("active") is False:
        office.session_version += 1
    for key, value in changes.items():
        setattr(office, key, value)
    office.updated_at = utcnow()
    try:
        await office.save()
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Ese usuario ya está en uso.")
    await _log(request, admin, "office.updated", "office", str(office.id), fields=sorted(changes))
    return office_out(office)


@router.post("/offices/{office_id}/revoke-sessions", response_model=Message)
async def revoke_office_sessions(request: Request, office_id: str, admin: StaffUser = Depends(require_admin)):
    office: Office = await _get_or_404(Office, office_id, "Oficina")
    office.session_version += 1
    await office.save()
    await _log(request, admin, "office.sessions_revoked", "office", str(office.id))
    return Message(message="Se cerraron las sesiones de la oficina.")


class OfficePasswordStatus(BaseModel):
    configured: bool
    updated_at: str | None


@router.get("/settings/office-password", response_model=OfficePasswordStatus)
async def office_password_status(_: StaffUser = Depends(require_admin)):
    access = await get_office_access()
    return OfficePasswordStatus(configured=bool(access), updated_at=access.value.get("updated_at") if access else None)


@router.put("/settings/office-password", response_model=Message)
async def change_office_password(request: Request, body: OfficePasswordIn, admin: StaffUser = Depends(require_admin)):
    if errors := office_password_errors(body.new_password):
        raise HTTPException(status_code=422, detail=" ".join(errors))
    version = await set_office_password(body.new_password)
    await _log(request, admin, "office_password.changed", "setting", "office_access", version=version)
    return Message(message="Contraseña de oficinas actualizada. Todas las oficinas deberán ingresar con la nueva clave.")


# ---------- Dispositivos ----------
async def _device_view(devices: list[Device]) -> list[DeviceOut]:
    offices = {o.id: o.name for o in await Office.find_all().to_list()}
    eq_ids = [d.equipment_id for d in devices if d.equipment_id]
    equipment = {e.id: e.patrimonial_code for e in await Equipment.find({"_id": {"$in": eq_ids}}).to_list()} if eq_ids else {}
    return [device_out(d, offices.get(d.office_id, "—"), equipment.get(d.equipment_id)) for d in devices]


@router.get("/devices", response_model=list[DeviceOut])
async def list_devices(status: DeviceStatus | None = None, office_id: str | None = None, _: StaffUser = Depends(require_admin)):
    query: dict = {}
    if status:
        query["status"] = status.value
    if office_id and (oid := parse_id(office_id)):
        query["office_id"] = oid
    return await _device_view(await Device.find(query).sort(-Device.created_at).limit(500).to_list())


@router.post("/devices/{device_id}/approve", response_model=DeviceOut)
async def approve_device(request: Request, device_id: str, body: DeviceApproveIn, admin: StaffUser = Depends(require_admin)):
    device: Device = await _get_or_404(Device, device_id, "Dispositivo")
    equipment_id = None
    if body.equipment_id:
        eq = await _get_or_404(Equipment, body.equipment_id, "Equipo")
        if eq.office_id != device.office_id:
            raise HTTPException(status_code=422, detail="El equipo debe pertenecer a la misma oficina que el dispositivo.")
        equipment_id = eq.id
    device.status, device.kind, device.label, device.equipment_id = DeviceStatus.APROBADO, body.kind, body.label.strip(), equipment_id
    device.reviewed_by, device.reviewed_at = admin.id, utcnow()
    await device.save()
    await broker.publish("staff", {"type": "device.reviewed", "device_id": str(device.id)})
    await _log(request, admin, "device.approved", "device", str(device.id), label=device.label)
    return (await _device_view([device]))[0]


async def _set_device_status(request: Request, device_id: str, admin: StaffUser, status: DeviceStatus) -> DeviceOut:
    device: Device = await _get_or_404(Device, device_id, "Dispositivo")
    device.status, device.reviewed_by, device.reviewed_at = status, admin.id, utcnow()
    await device.save()
    await broker.publish("staff", {"type": "device.reviewed", "device_id": str(device.id)})
    await _log(request, admin, f"device.{status.value.lower()}", "device", str(device.id))
    return (await _device_view([device]))[0]


@router.post("/devices/{device_id}/reject", response_model=DeviceOut)
async def reject_device(request: Request, device_id: str, admin: StaffUser = Depends(require_admin)):
    return await _set_device_status(request, device_id, admin, DeviceStatus.RECHAZADO)


@router.post("/devices/{device_id}/revoke", response_model=DeviceOut)
async def revoke_device(request: Request, device_id: str, admin: StaffUser = Depends(require_admin)):
    return await _set_device_status(request, device_id, admin, DeviceStatus.REVOCADO)


# ---------- Personal de Soporte TI ----------
async def _open_counts() -> Counter:
    docs = await Ticket.get_pymongo_collection().find(
        {"status": {"$ne": TicketStatus.RESUELTO.value}, "deleted_at": None, "assigned_to_id": {"$ne": None}}, {"assigned_to_id": 1}
    ).to_list(None)
    return Counter(str(d["assigned_to_id"]) for d in docs)


@router.get("/staff", response_model=list[StaffOut])
async def list_staff(_: StaffUser = Depends(require_admin)):
    counts = await _open_counts()
    return [staff_out(u, counts.get(str(u.id), 0)) for u in await StaffUser.find_all().sort("full_name").to_list()]


@router.post("/staff", response_model=StaffCreatedOut, status_code=201)
async def create_staff(request: Request, body: StaffIn, admin: StaffUser = Depends(require_admin)):
    password = temp_password()
    user = StaffUser(**body.model_dump(), password_hash=hash_password(password), must_change_password=True)
    try:
        await user.insert()
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Ese nombre de usuario ya existe.")
    await _log(request, admin, "staff.created", "staff", str(user.id), role=user.role)
    return StaffCreatedOut(staff=staff_out(user), temporary_password=password)


@router.patch("/staff/{staff_id}", response_model=StaffOut)
async def update_staff(request: Request, staff_id: str, body: StaffPatch, admin: StaffUser = Depends(require_admin)):
    user: StaffUser = await _get_or_404(StaffUser, staff_id, "Usuario")
    changes = body.model_dump(exclude_unset=True)
    if user.id == admin.id and (changes.get("active") is False or changes.get("role") not in (None, StaffRole.ADMIN)):
        raise HTTPException(status_code=422, detail="No puede desactivarse ni quitarse el rol de administrador a sí mismo.")
    if ("role" in changes and changes["role"] != user.role) or changes.get("active") is False:
        user.session_version += 1
    for key, value in changes.items():
        setattr(user, key, value)
    user.updated_at = utcnow()
    await user.save()
    await _log(request, admin, "staff.updated", "staff", str(user.id), fields=sorted(changes))
    return staff_out(user)


@router.post("/staff/{staff_id}/reset-password", response_model=StaffCreatedOut)
async def reset_staff_password(request: Request, staff_id: str, admin: StaffUser = Depends(require_admin)):
    user: StaffUser = await _get_or_404(StaffUser, staff_id, "Usuario")
    password = temp_password()
    user.password_hash, user.must_change_password = hash_password(password), True
    user.session_version += 1
    user.failed_attempts, user.locked_until = 0, None
    await user.save()
    await _log(request, admin, "staff.password_reset", "staff", str(user.id))
    return StaffCreatedOut(staff=staff_out(user), temporary_password=password)


@router.post("/staff/{staff_id}/reset-mfa", response_model=StaffOut)
async def reset_staff_mfa(request: Request, staff_id: str, admin: StaffUser = Depends(require_admin)):
    user: StaffUser = await _get_or_404(StaffUser, staff_id, "Usuario")
    user.totp_enabled, user.totp_secret_enc, user.totp_last_step = False, None, None
    user.session_version += 1
    await user.save()
    await _log(request, admin, "staff.mfa_reset", "staff", str(user.id))
    return staff_out(user)


@router.post("/staff/{staff_id}/unlock", response_model=StaffOut)
async def unlock_staff(request: Request, staff_id: str, admin: StaffUser = Depends(require_admin)):
    user: StaffUser = await _get_or_404(StaffUser, staff_id, "Usuario")
    user.failed_attempts, user.locked_until = 0, None
    await user.save()
    await _log(request, admin, "staff.unlocked", "staff", str(user.id))
    return staff_out(user)


# ---------- Auditoría ----------
class AuditOut(BaseModel):
    at: str
    actor_type: str
    actor_name: str | None
    action: str
    target_type: str | None
    target_id: str | None
    ip: str | None
    details: dict


@router.get("/audit", response_model=list[AuditOut])
async def list_audit(limit: int = Query(200, ge=1, le=1000), action: str | None = Query(None, max_length=60), _: StaffUser = Depends(require_admin)):
    query = {"action": action} if action else {}
    logs = await AuditLog.find(query).sort(-AuditLog.at).limit(limit).to_list()
    return [AuditOut(at=l.at.isoformat(), actor_type=l.actor_type, actor_name=l.actor_name, action=l.action,
                     target_type=l.target_type, target_id=l.target_id, ip=l.ip, details=l.details) for l in logs]
