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
from app.models.ticket import AIAnalysis
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
    midnight = datetime.combine(datetime.now(tz).date(), time.min, tzinfo=tz)
    since = utcnow() - timedelta(days=30)
    responded = await Ticket.get_pymongo_collection().find(
        base | {"created_at": {"$gte": since}, "first_response_at": {"$ne": None}}, {"created_at": 1, "first_response_at": 1}
    ).to_list(None)
    hours = [(aware(d["first_response_at"]) - aware(d["created_at"])).total_seconds() / 3600 for d in responded]
    return KpiOut(
        total=await Ticket.find(base).count(),
        pendientes=await Ticket.find(base | {"status": TicketStatus.PENDIENTE.value}).count(),
        en_proceso=await Ticket.find(base | {"status": TicketStatus.EN_PROCESO.value}).count(),
        resueltos=await Ticket.find(base | {"status": TicketStatus.RESUELTO.value}).count(),
        urgentes_abiertos=await Ticket.find(open_q | {"priority": TicketPriority.ALTA.value}).count(),
        nuevos_hoy=await Ticket.find(base | {"created_at": {"$gte": midnight}}).count(),
        sin_asignar=await Ticket.find(open_q | {"assigned_to_id": None}).count(),
        horas_primera_respuesta_30d=round(sum(hours) / len(hours), 2) if hours else None,
    )


@router.get("", response_model=Page[TicketOut])
async def list_tickets(
    status: TicketStatus | None = None,
    priority: TicketPriority | None = None,
    category: TicketCategory | None = None,
    office_id: str | None = None,
    equipment_id: str | None = None,
    assigned: str | None = Query(None, description="me | none | <id>"),
    q: str | None = Query(None, max_length=80),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: StaffUser = Depends(require_staff),
):
    query: dict = {"deleted_at": None}
    if status:
        query["status"] = status.value
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
    if q and q.strip():
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        query["$or"] = [{"number": rx}, {"subject": rx}, {"description": rx}, {"office_name": rx}, {"equipment.patrimonial_code": rx}]
    finder = Ticket.find(query)
    total = await finder.count()
    items = await Ticket.find(query).sort(-Ticket.created_at).skip((page - 1) * page_size).limit(page_size).to_list()
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


@router.post("/triage-preview", response_model=AIAnalysis)
async def triage_preview(body: TriagePreviewIn, _: StaffUser = Depends(require_staff)):
    office = await _office(body.office_id)
    equipment = await _equipment_for(office, body.equipment_id)
    return await get_engine().analyze(TriageRequest(
        subject=body.subject or "", description=body.description, quick_issue=body.quick_issue, office=office, equipment=equipment
    ))


@router.get("/{ticket_id}", response_model=TicketOut)
async def get_ticket(
    request: Request,
    ticket_id: str,
    user: StaffUser = Depends(require_staff),
):
    ticket = await _get(ticket_id)
    already_viewed = await AuditLog.find_one({
        "target_type": "ticket",
        "target_id": str(ticket.id),
        "action": "ticket.viewed",
        "actor_id": str(user.id),
    })
    if not already_viewed:
        await audit.record(
            request,
            "staff",
            "ticket.viewed",
            actor_id=str(user.id),
            actor_name=user.full_name,
            target_type="ticket",
            target_id=str(ticket.id),
        )
    return ticket_out(ticket)


@router.get("/{ticket_id}/audit", response_model=list[TicketAuditOut])
async def ticket_audit(ticket_id: str, _: StaffUser = Depends(require_staff)):
    await _get(ticket_id)
    logs = await AuditLog.find(
        {"target_type": "ticket", "target_id": ticket_id}
    ).sort("at").limit(300).to_list()
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
async def patch_ticket(request: Request, ticket_id: str, body: TicketPatch, user: StaffUser = Depends(require_staff)):
    if replayed := await _replayed_ticket(request):
        return ticket_out(replayed)
    ticket = await ticket_service.update_classification(await _get(ticket_id), user, body.category, body.priority)
    await audit.record(
        request, "staff", "ticket.classification_updated",
        actor_id=str(user.id), actor_name=user.full_name,
        target_type="ticket", target_id=str(ticket.id),
        category=body.category.value if body.category else None,
        priority=body.priority.value if body.priority else None,
        **audit.offline_request_details(request),
    )
    return ticket_out(ticket)


@router.post("/{ticket_id}/apply-ai-priority", response_model=TicketOut)
async def apply_ai_priority(
    request: Request,
    ticket_id: str,
    body: ApplyAiPriorityIn,
    user: StaffUser = Depends(require_staff),
):
    if replayed := await _replayed_ticket(request):
        return ticket_out(replayed)

    ticket = await _get(ticket_id)
    if not ticket.ai:
        raise HTTPException(status_code=409, detail="El ticket todavía no tiene análisis de IA.")
    if ticket.ai.priority != body.priority or ticket.ai.model_version != body.model_version:
        raise HTTPException(
            status_code=409,
            detail="La recomendación de IA cambió desde que fue revisada. Actualice el ticket antes de aplicarla.",
        )

    previous_priority = ticket.priority
    ai_priority = ticket.ai.priority
    ai_score = ticket.ai.priority_score
    ai_reasons = list(ticket.ai.priority_reasons)
    ai_model_version = ticket.ai.model_version

    ticket = await ticket_service.apply_ai_priority(ticket, user)
    await audit.record(
        request,
        "staff",
        "ticket.ai_priority_applied",
        actor_id=str(user.id),
        actor_name=user.full_name,
        target_type="ticket",
        target_id=str(ticket.id),
        previous_priority=previous_priority.value,
        applied_priority=ai_priority.value,
        ai_score=ai_score,
        ai_reasons=ai_reasons,
        ai_model_version=ai_model_version,
        **audit.offline_request_details(request),
    )
    return ticket_out(ticket)


@router.post("/{ticket_id}/assign", response_model=TicketOut)
async def assign(request: Request, ticket_id: str, body: AssignIn, user: StaffUser = Depends(require_staff)):
    if replayed := await _replayed_ticket(request):
        return ticket_out(replayed)
    tech_id = parse_id(body.technician_id) if body.technician_id else None
    if body.technician_id and not tech_id:
        raise HTTPException(status_code=422, detail="Técnico no válido.")
    ticket = await ticket_service.assign(await _get(ticket_id), user, tech_id)
    await audit.record(
        request, "staff", "ticket.assigned",
        actor_id=str(user.id), actor_name=user.full_name,
        target_type="ticket", target_id=str(ticket.id),
        technician_id=str(ticket.assigned_to_id) if ticket.assigned_to_id else None,
        technician_name=ticket.assigned_to_name,
        **audit.offline_request_details(request),
    )
    return ticket_out(ticket)


@router.post("/{ticket_id}/notes", response_model=TicketOut)
async def add_note(request: Request, ticket_id: str, body: NoteIn, user: StaffUser = Depends(require_staff)):
    if replayed := await _replayed_ticket(request):
        return ticket_out(replayed)
    ticket = await ticket_service.add_note(await _get(ticket_id), user, body.text, body.visible_to_office)
    await audit.record(
        request, "staff", "ticket.note_added",
        actor_id=str(user.id), actor_name=user.full_name,
        target_type="ticket", target_id=str(ticket.id),
        visible_to_office=body.visible_to_office,
        **audit.offline_request_details(request),
    )
    return ticket_out(ticket)


@router.post("/{ticket_id}/resolve", response_model=TicketOut)
async def resolve(request: Request, ticket_id: str, body: ResolveIn, user: StaffUser = Depends(require_staff)):
    if replayed := await _replayed_ticket(request):
        return ticket_out(replayed)
    ticket = await ticket_service.resolve(
        await _get(ticket_id),
        user,
        body.notes,
        body.tipo_resolucion,
    )
    await audit.record(
        request, "staff", "ticket.resolved",
        actor_id=str(user.id), actor_name=user.full_name,
        target_type="ticket", target_id=str(ticket.id),
        resolution_type=body.tipo_resolucion.value,
        **audit.offline_request_details(request),
    )
    return ticket_out(ticket)


@router.post("/{ticket_id}/reopen", response_model=TicketOut)
async def reopen(request: Request, ticket_id: str, user: StaffUser = Depends(require_staff)):
    if replayed := await _replayed_ticket(request):
        return ticket_out(replayed)
    ticket = await ticket_service.reopen(await _get(ticket_id), user.full_name, by_user=False)
    await audit.record(
        request, "staff", "ticket.reopened",
        actor_id=str(user.id), actor_name=user.full_name,
        target_type="ticket", target_id=str(ticket.id),
        **audit.offline_request_details(request),
    )
    return ticket_out(ticket)


@router.post("/{ticket_id}/reanalyze", response_model=TicketOut)
async def reanalyze(
    request: Request,
    ticket_id: str,
    background_tasks: BackgroundTasks,
    user: StaffUser = Depends(require_staff),
):
    ticket = await _get(ticket_id)
    background_tasks.add_task(get_engine().analyze_ticket_background, str(ticket.id))
    await audit.record(
        request, "staff", "ticket.reanalysis_requested",
        actor_id=str(user.id), actor_name=user.full_name,
        target_type="ticket", target_id=str(ticket.id),
    )
    return ticket_out(ticket)


@router.delete("/{ticket_id}", response_model=Message)
async def delete_ticket(request: Request, ticket_id: str, user: StaffUser = Depends(require_admin)):
    ticket = await _get(ticket_id)
    ticket.deleted_at = utcnow()
    await ticket.save()
    await audit.record(request, "staff", "ticket.deleted", actor_id=str(user.id), actor_name=user.full_name, target_type="ticket", target_id=str(ticket.id), number=ticket.number)
    return Message(message="Incidencia eliminada.")


@router.get("/{ticket_id}/attachments/{attachment_id}")
async def attachment(request: Request, ticket_id: str, attachment_id: str):
    principal = await resolve_principal(request)
    ticket = await _get(ticket_id)
    allowed = isinstance(principal, StaffPrincipal) or (
        isinstance(principal, OfficePrincipal) and principal.approved and principal.office.id == ticket.office_id
    )
    meta = next((a for a in ticket.attachments if a.id == attachment_id), None)
    if not allowed or not meta:
        raise HTTPException(status_code=404, detail="Archivo no encontrado.")
    path = attachment_path(meta)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Archivo no encontrado.")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})
