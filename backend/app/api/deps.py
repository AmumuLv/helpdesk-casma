from dataclasses import dataclass
from datetime import timedelta

from beanie import PydanticObjectId
from fastapi import HTTPException, Request, Response, status

from app.core.config import get_settings
from app.core.network import client_ip, ip_allowed
from app.core.security import decode_token, hash_token
from app.core.timeutil import aware, utcnow
from app.models import Device, Office, StaffUser
from app.models.enums import DeviceStatus, StaffRole
from app.services.office_access import get_office_access

SESSION_COOKIE = "hd_session"
DEVICE_COOKIE = "hd_device"
COOKIE_PATH = "/api"


@dataclass
class StaffPrincipal:
    user: StaffUser


@dataclass
class OfficePrincipal:
    office: Office
    device: Device

    @property
    def approved(self) -> bool:
        return self.device.status == DeviceStatus.APROBADO or not get_settings().require_device_approval


def set_cookie(response: Response, name: str, value: str, max_age: int) -> None:
    response.set_cookie(
        name, value, max_age=max_age, httponly=True, secure=get_settings().cookie_secure, samesite="strict", path=COOKIE_PATH
    )


def clear_session(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path=COOKIE_PATH, secure=get_settings().cookie_secure, httponly=True, samesite="strict")


def parse_id(value: str | None) -> PydanticObjectId | None:
    try:
        return PydanticObjectId(value)
    except Exception:
        return None


async def resolve_principal(request: Request) -> StaffPrincipal | OfficePrincipal | None:
    if hasattr(request.state, "principal"):
        return request.state.principal
    principal = await _resolve(request)
    request.state.principal = principal
    return principal


async def _resolve(request: Request) -> StaffPrincipal | OfficePrincipal | None:
    token = request.cookies.get(SESSION_COOKIE)
    if payload := decode_token(token, "staff"):
        uid = parse_id(payload["sub"])
        user = await StaffUser.get(uid) if uid else None
        if user and user.active and user.session_version == payload.get("sv"):
            return StaffPrincipal(user)
        return None

    if payload := decode_token(token, "office"):
        settings = get_settings()
        if not ip_allowed(client_ip(request), settings.office_allowed_networks):
            return None
        oid, did = parse_id(payload["sub"]), parse_id(payload.get("dev"))
        office = await Office.get(oid) if oid else None
        device = await Device.get(did) if did else None
        access = await get_office_access()
        device_token = request.cookies.get(DEVICE_COOKIE) or ""
        if not (office and device and access and office.active):
            return None
        if device.office_id != office.id or device.token_hash != hash_token(device_token):
            return None
        if office.session_version != payload.get("sv") or access.value.get("version") != payload.get("gv"):
            return None
        if device.status in (DeviceStatus.RECHAZADO, DeviceStatus.REVOCADO):
            return None
        now = utcnow()
        if now - aware(device.last_seen_at) > timedelta(minutes=5):
            device.last_seen_at, device.last_ip = now, client_ip(request)
            await device.save()
        return OfficePrincipal(office, device)
    return None


def staff_required(*roles: StaffRole, allow_password_change: bool = False):
    async def dependency(request: Request) -> StaffUser:
        principal = await resolve_principal(request)
        if not isinstance(principal, StaffPrincipal):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sesión no válida.")
        user = principal.user
        if user.must_change_password and not allow_password_change:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"code": "PASSWORD_CHANGE_REQUIRED", "message": "Debe cambiar su contraseña."})
        if roles and user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tiene permisos para esta acción.")
        return user

    return dependency


require_staff = staff_required()
require_admin = staff_required(StaffRole.ADMIN)


async def require_office(request: Request) -> OfficePrincipal:
    principal = await resolve_principal(request)
    if not isinstance(principal, OfficePrincipal):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sesión no válida.")
    if not principal.approved:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"code": "DEVICE_PENDING", "message": "Este equipo espera autorización de Soporte TI."})
    return principal
