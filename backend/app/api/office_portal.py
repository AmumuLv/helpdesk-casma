from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel

from app.ai.engine import get_engine
from app.ai.taxonomy import QUICK_ISSUES
from app.api.deps import OfficePrincipal, parse_id, require_office
from app.core.ratelimit import limiter
from app.core.timeutil import utcnow
from app.models import Announcement, Equipment, Ticket
from app.models.enums import DeviceKind, EquipmentStatus, EquipmentType, QuickIssue, TicketChannel, TicketStatus
from app.schemas.ticket import ConfirmIn, OfficeTicketCreatedOut, OfficeTicketOut
from app.services import tickets as ticket_service
from app.services.serializers import office_ticket_out

router = APIRouter(prefix="/office", tags=["portal de oficina"])


class EquipmentBrief(BaseModel):
    id: str
    patrimonial_code: str
    type: EquipmentType
    name: str
    hostname: str | None


class QuickIssueOut(BaseModel):
    key: QuickIssue
    label: str


class AlertOut(BaseModel):
    title: str
    message: str


class OfficeHomeOut(BaseModel):
    office_name: str
    location: str | None
    device_label: str | None
    this_equipment: EquipmentBrief | None
    equipment: list[EquipmentBrief]
    quick_issues: list[QuickIssueOut]
    open_tickets: list[OfficeTicketOut]
    alerts: list[AlertOut]


def _brief(e: Equipment) -> EquipmentBrief:
    return EquipmentBrief(id=str(e.id), patrimonial_code=e.patrimonial_code, type=e.type,
                          name=" ".join(x for x in (e.brand, e.model) if x) or e.type.value, hostname=e.hostname)


async def _office_ticket(ticket_id: str, principal: OfficePrincipal) -> Ticket:
    tid = parse_id(ticket_id)
    ticket = await Ticket.get(tid) if tid else None
    if not ticket or ticket.deleted_at or ticket.office_id != principal.office.id:
        raise HTTPException(status_code=404, detail="Reporte no encontrado.")
    return ticket


@router.get("/home", response_model=OfficeHomeOut)
async def home(p: OfficePrincipal = Depends(require_office)):
    now = utcnow()
    equipment = await Equipment.find({"office_id": p.office.id, "status": {"$ne": EquipmentStatus.BAJA.value}}).sort("type").to_list()
    this_eq = next((e for e in equipment if p.device.equipment_id and e.id == p.device.equipment_id), None)
    tickets = await Ticket.find({
        "office_id": p.office.id, "deleted_at": None,
        "$or": [{"status": {"$ne": TicketStatus.RESUELTO.value}}, {"updated_at": {"$gte": now - timedelta(days=3)}}],
    }).sort(-Ticket.created_at).limit(10).to_list()
    alerts = await Announcement.find({"office_ids": p.office.id, "active_until": {"$gt": now}}).to_list()
    return OfficeHomeOut(
        office_name=p.office.name, location=p.office.location, device_label=p.device.label,
        this_equipment=_brief(this_eq) if this_eq else None, equipment=[_brief(e) for e in equipment],
        quick_issues=[QuickIssueOut(key=k, label=v.label) for k, v in QUICK_ISSUES.items()],
        open_tickets=[office_ticket_out(t) for t in tickets],
        alerts=[AlertOut(title=a.title, message=a.message) for a in alerts],
    )


@router.get("/equipment/by-code/{code}", response_model=EquipmentBrief)
async def equipment_by_code(code: str, p: OfficePrincipal = Depends(require_office)):
    eq = await Equipment.find_one({"patrimonial_code": code.strip().upper()[:40], "office_id": p.office.id})
    if not eq:
        raise HTTPException(status_code=404, detail="Este equipo no pertenece a su oficina.")
    return _brief(eq)


@router.post("/tickets", response_model=OfficeTicketCreatedOut, status_code=201)
@limiter.limit("20/hour")
async def create_ticket(
    request: Request,
    background_tasks: BackgroundTasks,
    quick_issue: QuickIssue = Form(...),
    description: str = Form("", max_length=2000),
    equipment_id: str | None = Form(None),
    reporter_name: str | None = Form(None, max_length=80),
    contact_phone: str | None = Form(None, max_length=20),
    source: Literal["QR", "APP"] = Form("APP"),
    photo: UploadFile | None = File(None),
    p: OfficePrincipal = Depends(require_office),
):
    equipment = None
    if equipment_id:
        eid = parse_id(equipment_id)
        equipment = await Equipment.get(eid) if eid else None
        if not equipment or equipment.office_id != p.office.id:
            raise HTTPException(status_code=422, detail="El equipo elegido no pertenece a su oficina.")
    elif p.device.equipment_id:
        equipment = await Equipment.get(p.device.equipment_id)
    channel = TicketChannel.QR if source == "QR" else TicketChannel.MOVIL if p.device.kind in (DeviceKind.CELULAR, DeviceKind.TABLET) else TicketChannel.WEB
    ticket, duplicated = await ticket_service.create_ticket(ticket_service.NewTicket(
        office=p.office, channel=channel, quick_issue=quick_issue, description=description.strip(), equipment=equipment,
        device=p.device, reporter_name=(reporter_name or "").strip() or None, contact_phone=(contact_phone or "").strip() or None,
        photo=photo if photo and photo.filename else None,
    ))
    if not duplicated:
        background_tasks.add_task(get_engine().analyze_ticket_background, str(ticket.id))
    return OfficeTicketCreatedOut(ticket=office_ticket_out(ticket), duplicated=duplicated)


@router.get("/tickets", response_model=list[OfficeTicketOut])
async def list_tickets(p: OfficePrincipal = Depends(require_office)):
    tickets = await Ticket.find({"office_id": p.office.id, "deleted_at": None}).sort(-Ticket.created_at).limit(30).to_list()
    return [office_ticket_out(t) for t in tickets]


@router.get("/tickets/{ticket_id}", response_model=OfficeTicketOut)
async def get_ticket(ticket_id: str, p: OfficePrincipal = Depends(require_office)):
    return office_ticket_out(await _office_ticket(ticket_id, p))


@router.post("/tickets/{ticket_id}/confirm", response_model=OfficeTicketOut)
async def confirm(ticket_id: str, body: ConfirmIn, p: OfficePrincipal = Depends(require_office)):
    ticket = await _office_ticket(ticket_id, p)
    return office_ticket_out(await ticket_service.confirm_by_office(ticket, p.office, body.solved))
