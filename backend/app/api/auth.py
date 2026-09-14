import base64
import io
from datetime import timedelta

import qrcode
from fastapi import APIRouter, Depends, HTTPException, Request, Response

from app.api.deps import (
    DEVICE_COOKIE,
    SESSION_COOKIE,
    OfficePrincipal,
    StaffPrincipal,
    clear_session,
    parse_id,
    resolve_principal,
    set_cookie,
    staff_required,
)
from app.core.config import get_settings
from app.core.network import client_ip, ip_allowed
from app.core.ratelimit import limiter
from app.core.security import (
    create_token,
    decode_token,
    decrypt_field,
    encrypt_field,
    hash_password,
    hash_token,
    new_device_token,
    new_pair_code,
    new_totp_secret,
    staff_password_errors,
    totp_uri,
    verify_password,
    verify_totp,
)
from app.core.timeutil import aware, utcnow
from app.models import Device, Office, StaffUser
from app.models.enums import DeviceStatus
from app.schemas.auth import (
    MeOut,
    MfaSetupOut,
    MfaTokenIn,
    MfaVerifyIn,
    OfficeLoginIn,
    OfficeLoginOut,
    OfficeMe,
    PasswordChangeIn,
    StaffLoginIn,
    StaffLoginOut,
    StaffMe,
)
from app.schemas.common import Message
from app.services import audit
from app.services.devices import guess_kind
from app.services.events import broker
from app.services.office_access import get_office_access

router = APIRouter(prefix="/auth", tags=["autenticación"])
DEVICE_COOKIE_AGE = 400 * 24 * 3600


def _me(principal) -> MeOut:
    if isinstance(principal, StaffPrincipal):
        u = principal.user
        return MeOut(kind="staff", staff=StaffMe(id=str(u.id), username=u.username, full_name=u.full_name, role=u.role,
                                                 specialties=u.specialties, must_change_password=u.must_change_password))
    o, d = principal.office, principal.device
    status = DeviceStatus.APROBADO if principal.approved else d.status
    return MeOut(kind="office", office=OfficeMe(
        id=str(o.id), name=o.name, location=o.location, head_name=o.head_name, device_id=str(d.id), device_status=status,
        pair_code=d.pair_code if status == DeviceStatus.PENDIENTE else None,
        equipment_id=str(d.equipment_id) if d.equipment_id else None,
    ))


def _issue_staff_session(response: Response, user: StaffUser) -> None:
    hours = get_settings().staff_session_hours
    token = create_token(str(user.id), "staff", timedelta(hours=hours), {"sv": user.session_version})
    set_cookie(response, SESSION_COOKIE, token, hours * 3600)


async def _register_failure(user: StaffUser) -> None:
    settings = get_settings()
    user.failed_attempts += 1
    if user.failed_attempts >= settings.staff_max_failed_logins:
        user.locked_until = utcnow() + timedelta(minutes=settings.staff_lock_minutes)
        user.failed_attempts = 0
    await user.save()


@router.post("/office/login", response_model=OfficeLoginOut)
@limiter.limit("10/minute")
async def office_login(request: Request, response: Response, body: OfficeLoginIn):
    settings = get_settings()
    ip = client_ip(request)
    if not ip_allowed(ip, settings.office_allowed_networks):
        raise HTTPException(status_code=403, detail="Solo puede ingresar desde la red de la municipalidad.")
    office = await Office.find_one(Office.username == body.username.strip().lower())
    access = await get_office_access()
    valid = verify_password(body.password, access.value.get("password_hash") if access else None)
    if not (office and office.active and valid):
        await audit.record(request, "office", "office.login_failed", username=body.username.strip().lower()[:60])
        raise HTTPException(status_code=401, detail="Usuario o contraseña incorrectos.")

    ua = request.headers.get("user-agent", "")[:300]
    raw = request.cookies.get(DEVICE_COOKIE)
    device = await Device.find_one(Device.token_hash == hash_token(raw)) if raw else None
    if device and device.office_id == office.id and device.status in (DeviceStatus.RECHAZADO, DeviceStatus.REVOCADO):
        raise HTTPException(status_code=403, detail="Este equipo no está autorizado. Llame a Soporte TI.")
    if device is None or device.office_id != office.id:
        raw = new_device_token()
        device = Device(
            office_id=office.id, token_hash=hash_token(raw), pair_code=new_pair_code(), kind=guess_kind(ua),
            status=DeviceStatus.PENDIENTE if settings.require_device_approval else DeviceStatus.APROBADO,
            user_agent=ua, first_ip=ip, last_ip=ip,
        )
        await device.insert()
        if device.status == DeviceStatus.PENDIENTE:
            await broker.publish("staff", {"type": "device.pending", "device_id": str(device.id), "office": office.name, "pair_code": device.pair_code})
    else:
        device.last_ip, device.last_seen_at, device.user_agent = ip, utcnow(), ua
        await device.save()

    set_cookie(response, DEVICE_COOKIE, raw, DEVICE_COOKIE_AGE)
    token = create_token(
        str(office.id), "office", timedelta(days=settings.office_session_days),
        {"dev": str(device.id), "sv": office.session_version, "gv": access.value["version"]},
    )
    set_cookie(response, SESSION_COOKIE, token, settings.office_session_days * 86400)
    await audit.record(request, "office", "office.login", actor_id=str(office.id), actor_name=office.name, target_type="device", target_id=str(device.id))
    pending = device.status == DeviceStatus.PENDIENTE and settings.require_device_approval
    return OfficeLoginOut(status=DeviceStatus.PENDIENTE if pending else DeviceStatus.APROBADO, pair_code=device.pair_code if pending else None)


@router.post("/staff/login", response_model=StaffLoginOut)
@limiter.limit("5/minute")
async def staff_login(request: Request, body: StaffLoginIn):
    settings = get_settings()
    user = await StaffUser.find_one(StaffUser.username == body.username.strip().lower())
    if user and user.locked_until and aware(user.locked_until) > utcnow():
        verify_password(body.password, None)
        raise HTTPException(status_code=429, detail="Demasiados intentos fallidos. Espere unos minutos.")
    valid = verify_password(body.password, user.password_hash if user else None)
    if not valid or not user or not user.active:
        if user:
            await _register_failure(user)
        await audit.record(request, "staff", "staff.login_failed", username=body.username.strip().lower()[:60])
        raise HTTPException(status_code=401, detail="Usuario o contraseña incorrectos.")
    user.failed_attempts, user.locked_until = 0, None
    await user.save()
    stage = "verify" if user.totp_enabled else "setup"
    token = create_token(str(user.id), "mfa", timedelta(minutes=settings.mfa_token_minutes), {"sv": user.session_version, "stage": stage})
    return StaffLoginOut(mfa_token=token, mfa_setup_required=not user.totp_enabled)


async def _mfa_user(token: str) -> tuple[StaffUser, str]:
    payload = decode_token(token, "mfa")
    uid = parse_id(payload["sub"]) if payload else None
    user = await StaffUser.get(uid) if uid else None
    if not user or not user.active or user.session_version != payload.get("sv"):
        raise HTTPException(status_code=401, detail="La verificación expiró. Ingrese nuevamente.")
    return user, payload["stage"]


@router.post("/staff/mfa/setup", response_model=MfaSetupOut)
@limiter.limit("5/minute")
async def mfa_setup(request: Request, body: MfaTokenIn):
    user, stage = await _mfa_user(body.mfa_token)
    if stage != "setup" or user.totp_enabled:
        raise HTTPException(status_code=409, detail="La verificación en dos pasos ya está configurada.")
    secret = new_totp_secret()
    user.totp_secret_enc = encrypt_field(secret)
    await user.save()
    uri = totp_uri(secret, user.username)
    buffer = io.BytesIO()
    qrcode.make(uri, box_size=8, border=2).save(buffer, format="PNG")
    return MfaSetupOut(secret=secret, otpauth_uri=uri, qr_data_uri="data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode())


@router.post("/staff/mfa/verify", response_model=MeOut)
@limiter.limit("10/minute")
async def mfa_verify(request: Request, response: Response, body: MfaVerifyIn):
    user, stage = await _mfa_user(body.mfa_token)
    secret = decrypt_field(user.totp_secret_enc) if user.totp_secret_enc else None
    if not secret:
        raise HTTPException(status_code=409, detail="Configure primero la verificación en dos pasos.")
    step = verify_totp(secret, body.code, user.totp_last_step)
    if step is None:
        await _register_failure(user)
        raise HTTPException(status_code=401, detail="Código incorrecto o vencido.")
    user.totp_last_step, user.failed_attempts, user.last_login_at = step, 0, utcnow()
    if stage == "setup":
        user.totp_enabled = True
    await user.save()
    _issue_staff_session(response, user)
    await audit.record(request, "staff", "staff.login", actor_id=str(user.id), actor_name=user.full_name, mfa_enrolled=stage == "setup")
    return _me(StaffPrincipal(user))


@router.post("/staff/password", response_model=Message)
@limiter.limit("5/minute")
async def change_password(request: Request, response: Response, body: PasswordChangeIn,
                          user: StaffUser = Depends(staff_required(allow_password_change=True))):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=401, detail="La contraseña actual no es correcta.")
    if errors := staff_password_errors(body.new_password, user.username):
        raise HTTPException(status_code=422, detail=" ".join(errors))
    if verify_password(body.new_password, user.password_hash):
        raise HTTPException(status_code=422, detail="La nueva contraseña debe ser distinta a la actual.")
    user.password_hash, user.must_change_password = hash_password(body.new_password), False
    user.session_version += 1
    user.updated_at = utcnow()
    await user.save()
    _issue_staff_session(response, user)
    await audit.record(request, "staff", "staff.password_changed", actor_id=str(user.id), actor_name=user.full_name)
    return Message(message="Contraseña actualizada.")


@router.post("/logout", response_model=Message)
async def logout(response: Response):
    clear_session(response)
    return Message(message="Sesión cerrada.")


@router.get("/me", response_model=MeOut)
async def me(request: Request):
    principal = await resolve_principal(request)
    if principal is None:
        raise HTTPException(status_code=401, detail="Sesión no válida.")
    if isinstance(principal, OfficePrincipal) or isinstance(principal, StaffPrincipal):
        return _me(principal)
