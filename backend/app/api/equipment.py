import io

import qrcode
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel
from pymongo.errors import DuplicateKeyError

from app.ai.engine import equipment_row, get_engine, load_ticket_rows
from app.api.deps import parse_id, require_admin, require_staff
from app.core.config import get_settings
from app.core.timeutil import utcnow
from app.models import Device, Equipment, Office, StaffUser, Ticket
from app.models.enums import EquipmentType
from app.schemas.admin import EquipmentIn, EquipmentOut
from app.schemas.common import Message
from app.services import audit
from app.services.serializers import equipment_out, ticket_out
from app.schemas.ticket import TicketOut

router = APIRouter(prefix="/equipment", tags=["equipos"])


class EquipmentDetailOut(BaseModel):
    equipment: EquipmentOut
    risk: float | None
    risk_factors: list[str]
    tickets: list[TicketOut]


async def _get(equipment_id: str) -> Equipment:
    eid = parse_id(equipment_id)
    eq = await Equipment.get(eid) if eid else None
    if not eq:
        raise HTTPException(status_code=404, detail="Equipo no encontrado.")
    return eq


async def _validate_office(office_id: str | None):
    if not office_id:
        return None
    oid = parse_id(office_id)
    if not oid or not await Office.get(oid):
        raise HTTPException(status_code=422, detail="Oficina no válida.")
    return oid


@router.get("", response_model=list[EquipmentOut])
async def list_equipment(
    office_id: str | None = None, type: EquipmentType | None = None, q: str | None = Query(None, max_length=60),
    _: StaffUser = Depends(require_staff),
):
    import re

    query: dict = {}
    if office_id and (oid := parse_id(office_id)):
        query["office_id"] = oid
    if type:
        query["type"] = type.value
    if q and q.strip():
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        query["$or"] = [{"patrimonial_code": rx}, {"brand": rx}, {"model": rx}, {"ip_address": rx}, {"hostname": rx}, {"serial_number": rx}]
    offices = {o.id: o.name for o in await Office.find_all().to_list()}
    items = await Equipment.find(query).sort("patrimonial_code").limit(1000).to_list()
    return [equipment_out(e, offices.get(e.office_id)) for e in items]


@router.post("", response_model=EquipmentOut, status_code=201)
async def create_equipment(request: Request, body: EquipmentIn, user: StaffUser = Depends(require_staff)):
    data = body.model_dump()
    data["office_id"] = await _validate_office(body.office_id)
    eq = Equipment(**data)
    try:
        await eq.insert()
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Ya existe un equipo con ese código patrimonial.")
    await audit.record(request, "staff", "equipment.created", actor_id=str(user.id), actor_name=user.full_name, target_type="equipment", target_id=str(eq.id))
    return equipment_out(eq)


@router.get("/{equipment_id}", response_model=EquipmentDetailOut)
async def equipment_detail(equipment_id: str, _: StaffUser = Depends(require_staff)):
    eq = await _get(equipment_id)
    engine = get_engine()
    await engine.ensure_ready()
    history = await load_ticket_rows(utcnow().replace(year=utcnow().year - 2), {"equipment_id": eq.id})
    risk, factors = engine.state["risk"].score(equipment_row(eq), history, engine.state["model_rates"], utcnow())
    tickets = await Ticket.find({"equipment_id": eq.id, "deleted_at": None}).sort(-Ticket.created_at).limit(50).to_list()
    office = await Office.get(eq.office_id) if eq.office_id else None
    return EquipmentDetailOut(equipment=equipment_out(eq, office.name if office else None), risk=risk, risk_factors=factors, tickets=[ticket_out(t) for t in tickets])


@router.put("/{equipment_id}", response_model=EquipmentOut)
async def update_equipment(request: Request, equipment_id: str, body: EquipmentIn, user: StaffUser = Depends(require_staff)):
    eq = await _get(equipment_id)
    data = body.model_dump()
    data["office_id"] = await _validate_office(body.office_id)
    for key, value in data.items():
        setattr(eq, key, value)
    eq.updated_at = utcnow()
    try:
        await eq.save()
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Ya existe un equipo con ese código patrimonial.")
    await audit.record(request, "staff", "equipment.updated", actor_id=str(user.id), actor_name=user.full_name, target_type="equipment", target_id=str(eq.id))
    return equipment_out(eq)


@router.delete("/{equipment_id}", response_model=Message)
async def delete_equipment(request: Request, equipment_id: str, admin: StaffUser = Depends(require_admin)):
    eq = await _get(equipment_id)
    if await Ticket.find({"equipment_id": eq.id}).count():
        raise HTTPException(status_code=409, detail="El equipo tiene historial de incidencias. Márquelo como BAJA en lugar de eliminarlo.")
    await Device.get_pymongo_collection().update_many({"equipment_id": eq.id}, {"$set": {"equipment_id": None}})
    await eq.delete()
    await audit.record(request, "staff", "equipment.deleted", actor_id=str(admin.id), actor_name=admin.full_name, target_type="equipment", target_id=str(eq.id))
    return Message(message="Equipo eliminado.")


@router.get("/{equipment_id}/qr")
async def equipment_qr(equipment_id: str, _: StaffUser = Depends(require_staff)):
    eq = await _get(equipment_id)
    url = f"{get_settings().public_base_url.rstrip('/')}/reportar?equipo={eq.patrimonial_code}"
    buffer = io.BytesIO()
    qrcode.make(url, box_size=10, border=2).save(buffer, format="PNG")
    return Response(buffer.getvalue(), media_type="image/png", headers={"Content-Disposition": f'inline; filename="QR-{eq.patrimonial_code}.png"'})
