import re
from collections import Counter
from datetime import datetime, time, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.ai.engine import TriageRequest, get_engine
from app.api.deps import OfficePrincipal, StaffPrincipal, parse_id, require_admin, require_staff, resolve_principal
from app.core.config import get_settings
from app.core.timeutil import aware, utcnow
from app.models import AuditLog, Equipment, Office, StaffUser, Ticket
from app.models.enums import QuickIssue, TicketCategory, TicketChannel, TicketPriority, TicketStatus
from app.models.ticket import AIAnalysis, ResolutionType
from app.schemas.admin import StaffOut
from app.schemas.common import Message, Page
from app.schemas.ticket import AssignIn, KpiOut, NoteIn, ResolveIn, TicketOut, TicketPatch, TriagePreviewIn
from app.services import audit
from app.services import tickets as ticket_service
from app.services.serializers import staff_out, ticket_out
from app.services.storage import attachment_path

router = APIRouter(prefix="/tickets", tags=["incidencias"])
tech_router = APIRouter(prefix="/technicians", tags=["incidencias"])
lookup_router = APIRouter(prefix="/lookup", tags=["incidencias"])


class TicketAuditOut(BaseModel):
    at: datetime
    actor_type: str
    actor_name: str | None = None
    action: str
    details: dict


class ApplyAiPriorityIn(BaseModel):
    priority: TicketPriority
    model_version: str


@lookup_router.get("/offices")
async def office_lookup(_: StaffUser = Depends(require_staff)):
    offices = await Office.find({"active": True}).sort("name").to_list()
    return [
        {
            "id": str(o.id),
            "code": o.code,
            "name": o.name,
            "zone_id": str(o.zone_id) if o.zone_id else None,
            "zone_name": o.zone_name,
            "location": o.location,
            "head_name": o.head_name,
            "head_phone": o.head_phone,
            "service_level": o.service_level.value,
            "service_reason": o.service_reason,
            "priority_weight": o.priority_weight,
            "active": o.active,
        }
        for o in offices
    ]


async def _get(ticket_id: str) -> Ticket:
    tid = parse_id(ticket_id)
    ticket = await Ticket.get(tid) if tid else None
    if not ticket or ticket.deleted_at:
        raise HTTPException(status_code=404, detail="Incidencia no encontrada.")
    return ticket


async def _replayed_ticket(request: Request) -> Ticket | None:
    target_id = await audit.replayed_target_id(request, "ticket")
    if not target_id:
        return None
    tid = parse_id(target_id)
    ticket = await Ticket.get(tid) if tid else None
    return ticket if ticket and not ticket.deleted_at else None


async def _office(office_id: str) -> Office:
    oid = parse_id(office_id)
    office = await Office.get(oid) if oid else None
    if not office:
        raise HTTPException(status_code=422, detail="Oficina no válida.")
    return office


async def _equipment_for(office: Office, equipment_id: str | None) -> Equipment | None:
    if not equipment_id:
        return None
    eid = parse_id(equipment_id)
    eq = await Equipment.get(eid) if eid else None
    if not eq or (eq.office_id and eq.office_id != office.id):
        raise HTTPException(status_code=422, detail="El equipo no pertenece a la oficina seleccionada.")
    return eq


@tech_router.get("", response_model=list[StaffOut])
async def technicians(_: StaffUser = Depends(require_staff)):
    staff = await StaffUser.find({"active": True}).sort("full_name").to_list()
    cursor = Ticket.get_pymongo_collection().find(
        {"status": {"$ne": TicketStatus.RESUELTO.value}, "deleted_at": None, "assigned_to_id": {"$ne": None}}, {"assigned_to_id": 1}
    )
    counts = Counter(str(d["assigned_to_id"]) for d in await cursor.to_list(None))
    return [staff_out(s, counts.get(str(s.id), 0)) for s in staff]


@router.get("/kpis", response_model=KpiOut)
async def kpis(_: StaffUser = Depends(require_staff)):
    base = {"deleted_at": None}
    open_q = base | {"status": {"$ne": TicketStatus.RESUELTO.value}}
    tz = ZoneInfo(get_settings().timezone)
    now = datetime.now(tz)
    midnight = datetime.combine(now.date(), time.min, tzinfo=tz)
    month_start = datetime(now.year, now.month, 1, tzinfo=tz)
    since = utcnow() - timedelta(days=30)
    collection = Ticket.get_pymongo_collection()

    responded = await collection.find(
        base | {"created_at": {"$gte": since}, "first_response_at": {"$ne": None}}, {"created_at": 1, "first_response_at": 1}
    ).to_list(None)
    response_hours = [(aware(d["first_response_at"]) - aware(d["created_at"])).total_seconds() / 3600 for d in responded]

    resolved = await collection.find(
        base | {
            "status": TicketStatus.RESUELTO.value,
            "resolution.resolved_at": {"$gte": since},
        },
        {"created_at": 1, "resolution.resolved_at": 1},
    ).to_list(None)
    resolution_hours = [
        (aware(d["resolution"]["resolved_at"]) - aware(d["created_at"])).total_seconds() / 3600
        for d in resolved
        if d.get("resolution") and d["resolution"].get("resolved_at")
    ]
    reabiertos_30d = await AuditLog.find({"action": "ticket.reopened", "at": {"$gte": since}}).count()

    return KpiOut(
        total=await Ticket.find(base).count(),
        pendientes=await Ticket.find(base | {"status": TicketStatus.PENDIENTE.value}).count(),
        en_proceso=await Ticket.find(base | {"status": TicketStatus.EN_PROCESO.value}).count(),
        resueltos=await Ticket.find(base | {"status": TicketStatus.RESUELTO.value}).count(),
        cerrados_mes=await Ticket.find(base | {
            "status": TicketStatus.RESUELTO.value,
            "resolution.resolved_at": {"$gte": month_start},
        }).count(),
        urgentes_abiertos=await Ticket.find(open_q | {"priority": TicketPriority.ALTA.value}).count(),
        nuevos_hoy=await Ticket.find(base | {"created_at": {"$gte": midnight}}).count(),
        sin_asignar=await Ticket.find(open_q | {"assigned_to_id": None}).count(),
        horas_primera_respuesta_30d=round(sum(response_hours) / len(response_hours), 2) if response_hours else None,
        horas_resolucion_30d=round(sum(resolution_hours) / len(resolution_hours), 2) if resolution_hours else None,
        reabiertos_30d=reabiertos_30d,
    )


@router.get("", response_model=Page[TicketOut])
async def list_tickets(
    status: TicketStatus | None = None,
    active: bool | None = Query(None, description="true = pendientes + en proceso"),
    priority: TicketPriority | None = None,
    category: TicketCategory | None = None,
    office_id: str | None = None,
    equipment_id: str | None = None,
    assigned: str | None = Query(None, description="me | none | <id>"),
    resolved_by: str | None = Query(None, max_length=64),
    resolution_type: ResolutionType | None = None,
    resolved_from: datetime | None = None,
    resolved_to: datetime | None = None,
    sort_by: Literal["created_desc", "closed_desc", "closed_asc", "duration_desc", "duration_asc"] = "created_desc",
    q: str | None = Query(None, max_length=80),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: StaffUser = Depends(require_staff),
):
    query: dict = {"deleted_at": None}
    if status:
        query["status"] = status.value
    elif active is True:
        query["status"] = {"$ne": TicketStatus.RESUELTO.value}
    if priority:
        query["priority"] = priority.value
    if category:
        query["category"] = category.value
    if office_id and (oid := parse_id(office_id)):
        query["office_id"] = oid
    if equipment_id and (eid := parse_id(equipment_id)):
        query["equipment_id"] = eid
    if assigned == "me":
        query["assigned_to_id"] = user.id
    elif assigned == "none":
        query["assigned_to_id"] = None
    elif assigned and (aid := parse_id(assigned)):
        query["assigned_to_id"] = aid
    if resolved_by:
        query["resolution.resolved_by_id"] = resolved_by
    if resolution_type:
        query["resolution.tipo_resolucion"] = resolution_type.value
    resolved_range: dict = {}
    if resolved_from:
        resolved_range["$gte"] = resolved_from
    if resolved_to:
        resolved_range["$lte"] = resolved_to
    if resolved_range:
        query["resolution.resolved_at"] = resolved_range
    if q and q.strip():
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        query["$or"] = [{"number": rx}, {"subject": rx}, {"description": rx}, {"office_name": rx}, {"equipment.patrimonial_code": rx}]

    finder = Ticket.find(query)
    total = await finder.count()
    offset = (page - 1) * page_size

    if sort_by == "created_desc":
        items = await Ticket.find(query).sort(-Ticket.created_at).skip(offset).limit(page_size).to_list()
    else:
        ordered = await Ticket.find(query).to_list()
        if sort_by in {"closed_desc", "closed_asc"}:
            ordered.sort(
                key=lambda t: aware(t.resolution.resolved_at).timestamp() if t.resolution else 0,
                reverse=sort_by == "closed_desc",
            )
        else:
            ordered.sort(
                key=lambda t: (
                    aware(t.resolution.resolved_at) - aware(t.created_at)
                ).total_seconds() if t.resolution else 0,
                reverse=sort_by == "duration_desc",
            )
        items = ordered[offset:offset + page_size]

    return Page[TicketOut](items=[ticket_out(t) for t in items], total=total, page=page, page_size=page_size)


@router.post("", response_model=TicketOut, status_code=201)
async def create_by_staff(
    request: Request,
    background_tasks: BackgroundTasks,
    office_id: str = Form(...),
    description: str = Form(..., min_length=3, max_length=2000),
    subject: str | None = Form(None, max_length=160),
    quick_issue: QuickIssue | None = Form(None),
    equipment_id: str | None = Form(None),
    reporter_name: str | None = Form(None, max_length=80),
    contact_phone: str | None = Form(None, max_length=20),
    category: TicketCategory | None = Form(None),
    priority: TicketPriority | None = Form(None),
    hierarchy_level: Literal[
        "PERSONAL",
        "UNIDAD_ORGANIZACION",
        "SUBGERENCIA",
        "GERENCIA",
        "GERENCIA_MUNICIPAL",
        "ALCALDIA",
    ] = Form("PERSONAL"),
    technician_id: str | None = Form(None),
    photo: UploadFile | None = File(None),
    user: StaffUser = Depends(require_staff),
):
    if replayed := await _replayed_ticket(request):
        return ticket_out(replayed)
    office = await _office(office_id)
    equipment = await _equipment_for(office, equipment_id)
    ticket, duplicated = await ticket_service.create_ticket(ticket_service.NewTicket(
        office=office, channel=TicketChannel.TELEFONO, description=description, quick_issue=quick_issue, subject=subject,
        equipment=equipment, reporter_name=reporter_name, contact_phone=contact_phone,
        photo=photo if photo and photo.filename else None, staff=user, category=category, priority=priority,
        hierarchy_level=hierarchy_level,
    ))
    if technician_id and (tid := parse_id(technician_id)):
        ticket = await ticket_service.assign(ticket, user, tid)
    if not duplicated:
        background_tasks.add_task(get_engine().analyze_ticket_background, str(ticket.id))
    await audit.record(
        request, "staff", "ticket.created",
        actor_id=str(user.id), actor_name=user.full_name,
        target_type="ticket", target_id=str(ticket.id),
        **audit.offline_request_details(request),
    )
    return ticket_out(ticket)


@router.get("/{ticket_id}", response_model=TicketOut)
async def get_ticket(ticket_id: str, _: StaffUser = Depends(require_staff)):
    return ticket_out(await _get(ticket_id))


@router.get("/{ticket_id}/audit", response_model=list[TicketAuditOut])
async def ticket_audit(ticket_id: str, _: StaffUser = Depends(require_staff)):
    ticket = await _get(ticket_id)
    target_id = str(ticket.id)
    cursor = (
        AuditLog.find({"target_type": "ticket", "target_id": target_id})
        .sort(-AuditLog.at)
        .limit(300)
    )
    logs = await cursor.to_list()
    return [
        TicketAuditOut(
            at=log.at,
            actor_type=log.actor_type,
            actor_name=log.actor_name,
            action=log.action,
            details=log.details,
        )
        for log in logs
    ]


@router.patch("/{ticket_id}", response_model=TicketOut)
async def patch_ticket(request: Request, ticket_id: str, data: TicketPatch, user: StaffUser = Depends(require_staff)):
    t = await _get(ticket_id)
    updates: dict = {}
    details: dict = {}
    if data.category is not None and data.category.value != t.category:
        updates["category"] = data.category.value
        updates["category_source"] = "TECNICO"
        details["category"] = data.category.value
    if data.priority is not None and data.priority.value != t.priority:
        updates["priority"] = data.priority.value
        updates["priority_source"] = "TECNICO"
        details["priority"] = data.priority.value
    if updates:
        await t.set(updates)
        await audit.record(request, "staff", "ticket.classification.updated", actor_id=str(user.id), actor_name=user.full_name,
                           target_type="ticket", target_id=str(t.id), **details)
    return ticket_out(t)


@router.post("/{ticket_id}/apply-ai-priority", response_model=TicketOut)
async def apply_ai_priority(request: Request, ticket_id: str, data: ApplyAiPriorityIn, user: StaffUser = Depends(require_staff)):
    t = await _get(ticket_id)
    if not t.ai or t.ai.model_version != data.model_version:
        raise HTTPException(status_code=409, detail="La sugerencia IA ya cambió; vuelva a analizar antes de aplicarla.")
    updates = {
        "priority": data.priority.value,
        "priority_source": "IA_SUPERVISADA",
        "priority_model_version": data.model_version,
        "priority_applied_at": utcnow(),
        "priority_applied_by": str(user.id),
    }
    await t.set(updates)
    await audit.record(
        request, "staff", "ticket.ai_priority.applied", actor_id=str(user.id), actor_name=user.full_name,
        target_type="ticket", target_id=str(t.id), priority=data.priority.value, model_version=data.model_version,
    )
    return ticket_out(t)


@router.delete("/{ticket_id}", response_model=Message)
async def delete_ticket(request: Request, ticket_id: str, user: StaffUser = Depends(require_admin)):
    t = await _get(ticket_id)
    await t.set({"deleted_at": utcnow()})
    await audit.record(request, "staff", "ticket.deleted", actor_id=str(user.id), actor_name=user.full_name,
                       target_type="ticket", target_id=str(t.id), number=t.number)
    return Message(message="Incidencia eliminada.")


@router.post("/{ticket_id}/assign", response_model=TicketOut)
async def assign_ticket(request: Request, ticket_id: str, data: AssignIn, user: StaffUser = Depends(require_staff)):
    t = await _get(ticket_id)
    technician_id = parse_id(data.technician_id) if data.technician_id else None
    t = await ticket_service.assign(t, user, technician_id)
    await audit.record(request, "staff", "ticket.assigned", actor_id=str(user.id), actor_name=user.full_name,
                       target_type="ticket", target_id=str(t.id), technician_id=data.technician_id)
    return ticket_out(t)


@router.post("/{ticket_id}/notes", response_model=TicketOut)
async def add_note(request: Request, ticket_id: str, data: NoteIn, user: StaffUser = Depends(require_staff)):
    t = await _get(ticket_id)
    t = await ticket_service.add_note(t, user, data.text, data.visible_to_office)
    await audit.record(request, "staff", "ticket.note.added", actor_id=str(user.id), actor_name=user.full_name,
                       target_type="ticket", target_id=str(t.id), visible_to_office=data.visible_to_office)
    return ticket_out(t)


@router.post("/{ticket_id}/resolve", response_model=TicketOut)
async def resolve_ticket(request: Request, ticket_id: str, data: ResolveIn, background_tasks: BackgroundTasks, user: StaffUser = Depends(require_staff)):
    t = await _get(ticket_id)
    t = await ticket_service.resolve(t, user, data.notes, data.tipo_resolucion)
    background_tasks.add_task(get_engine().retrain)
    await audit.record(request, "staff", "ticket.resolved", actor_id=str(user.id), actor_name=user.full_name,
                       target_type="ticket", target_id=str(t.id), resolution_type=data.tipo_resolucion.value)
    return ticket_out(t)


@router.post("/{ticket_id}/reopen", response_model=TicketOut)
async def reopen_ticket(request: Request, ticket_id: str, user: StaffUser = Depends(require_staff)):
    t = await _get(ticket_id)
    t = await ticket_service.reopen(t, user.full_name, by_user=False)
    await audit.record(request, "staff", "ticket.reopened", actor_id=str(user.id), actor_name=user.full_name,
                       target_type="ticket", target_id=str(t.id))
    return ticket_out(t)


@router.post("/{ticket_id}/reanalyze", response_model=TicketOut)
async def reanalyze_ticket(request: Request, ticket_id: str, background_tasks: BackgroundTasks, user: StaffUser = Depends(require_staff)):
    t = await _get(ticket_id)
    analysis = get_engine().analyze_ticket(t)
    await t.set({"ai": analysis})
    await audit.record(request, "staff", "ticket.ai.reanalyzed", actor_id=str(user.id), actor_name=user.full_name,
                       target_type="ticket", target_id=str(t.id), model_version=analysis.model_version)
    background_tasks.add_task(get_engine().retrain)
    return ticket_out(t)


@router.get("/{ticket_id}/attachment/{attachment_id}")
async def ticket_attachment(ticket_id: str, attachment_id: str, principal: StaffPrincipal | OfficePrincipal = Depends(resolve_principal)):
    t = await _get(ticket_id)
    if isinstance(principal, OfficePrincipal) and t.office_id != principal.office.id:
        raise HTTPException(status_code=403, detail="No autorizado.")
    attachment = next((a for a in t.attachments if a.id == attachment_id), None)
    if not attachment:
        raise HTTPException(status_code=404, detail="Adjunto no encontrado.")
    path = attachment_path(attachment.stored_name)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Archivo no encontrado.")
    return FileResponse(path, media_type=attachment.content_type, filename=attachment.original_name)
