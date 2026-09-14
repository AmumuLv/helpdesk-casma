import asyncio
import logging
from dataclasses import dataclass
from datetime import timedelta

from beanie import PydanticObjectId
from fastapi import HTTPException, UploadFile

from app.ai.engine import TriageRequest, get_engine
from app.ai.taxonomy import CATEGORY_LABELS, QUICK_ISSUES
from app.core.config import get_settings
from app.core.timeutil import local_now, utcnow
from app.db import next_sequence
from app.models import AIModelRecord, Device, Equipment, Office, StaffUser, Ticket
from app.models.enums import (
    QuickIssue,
    TicketCategory,
    TicketChannel,
    TicketPriority,
    TicketStatus,
    TimelineKind,
)
from app.models.ticket import EquipmentSnapshot, Resolution, TimelineEntry
from app.services.events import broker
from app.services.storage import save_image

log = logging.getLogger("helpdesk.tickets")
_PRIORITY_UP = {TicketPriority.BAJA: TicketPriority.MEDIA, TicketPriority.MEDIA: TicketPriority.ALTA, TicketPriority.ALTA: TicketPriority.ALTA}


@dataclass
class NewTicket:
    office: Office
    channel: TicketChannel
    description: str = ""
    quick_issue: QuickIssue | None = None
    subject: str | None = None
    equipment: Equipment | None = None
    device: Device | None = None
    reporter_name: str | None = None
    contact_phone: str | None = None
    photo: UploadFile | None = None
    staff: StaffUser | None = None
    category: TicketCategory | None = None
    priority: TicketPriority | None = None


def equipment_snapshot(e: Equipment) -> EquipmentSnapshot:
    return EquipmentSnapshot(
        id=str(e.id), patrimonial_code=e.patrimonial_code, type=e.type, brand=e.brand, model=e.model,
        ip_address=e.ip_address, hostname=e.hostname,
    )


async def next_ticket_number() -> str:
    year = local_now().year
    seq = await next_sequence(f"ticket-{year}")
    return f"INC-{year}-{seq:06d}"


def _event(ticket: Ticket, kind: str) -> dict:
    return {
        "type": kind, "ticket_id": str(ticket.id), "number": ticket.number, "subject": ticket.subject,
        "office": ticket.office_name, "status": ticket.status.value, "priority": ticket.priority.value,
    }


async def _publish(ticket: Ticket, kind: str) -> None:
    event = _event(ticket, kind)
    await broker.publish("staff", event)
    await broker.publish(f"office:{ticket.office_id}", event)


async def create_ticket(data: NewTicket) -> tuple[Ticket, bool]:
    now = utcnow()
    actor = data.staff.full_name if data.staff else (data.reporter_name or data.office.name)

    if data.staff is None and data.quick_issue:
        scope = {"equipment_id": data.equipment.id} if data.equipment else {"device_id": data.device.id} if data.device else {}
        duplicate = await Ticket.find_one(
            {
                "office_id": data.office.id, "quick_issue": data.quick_issue.value, "deleted_at": None,
                "status": {"$ne": TicketStatus.RESUELTO.value}, "created_at": {"$gte": now - timedelta(hours=12)}, **scope,
            }
        )
        if duplicate:
            duplicate.timeline.append(
                TimelineEntry(kind=TimelineKind.REPORTE_REPETIDO, actor=actor, text=data.description or "Se volvió a reportar el mismo problema.")
            )
            if data.photo:
                duplicate.attachments.append(await save_image(data.photo))
            duplicate.updated_at = now
            await duplicate.save()
            await _publish(duplicate, "ticket.updated")
            return duplicate, True

    info = QUICK_ISSUES.get(data.quick_issue) if data.quick_issue else None
    subject = (data.subject or (info.subject if info else "Solicitud de soporte")).strip()
    if data.equipment and data.equipment.patrimonial_code not in subject:
        subject = f"{subject} - {data.equipment.patrimonial_code}"
    attachments = [await save_image(data.photo)] if data.photo else []

    analysis = await get_engine().analyze(
        TriageRequest(subject=subject, description=data.description, quick_issue=data.quick_issue, office=data.office,
                      equipment=data.equipment, category_hint=data.category)
    )
    category = data.category or analysis.category
    priority = data.priority or analysis.priority
    ticket = Ticket(
        number=await next_ticket_number(),
        office_id=data.office.id, office_name=data.office.name, office_location=data.office.location,
        device_id=data.device.id if data.device else None,
        equipment_id=data.equipment.id if data.equipment else None,
        equipment=equipment_snapshot(data.equipment) if data.equipment else None,
        channel=data.channel, quick_issue=data.quick_issue, subject=subject, description=data.description.strip(),
        reporter_name=data.reporter_name, contact_phone=data.contact_phone,
        category=category, category_source="TECNICO" if data.category else "IA",
        priority=priority, priority_source="TECNICO" if data.priority else "IA",
        attachments=attachments, ai=analysis,
        created_by_staff_id=data.staff.id if data.staff else None,
        timeline=[
            TimelineEntry(kind=TimelineKind.CREADO, actor=actor, text="Reporte recibido."),
            TimelineEntry(kind=TimelineKind.IA, actor="Asistente IA", text=analysis.briefing, internal=True),
        ],
    )
    settings = get_settings()
    if settings.ai_auto_assign_urgent and priority == TicketPriority.ALTA and analysis.suggested_technician_id:
        tech = await StaffUser.get(PydanticObjectId(analysis.suggested_technician_id))
        if tech and tech.active:
            ticket.assigned_to_id, ticket.assigned_to_name = tech.id, tech.full_name
            ticket.status, ticket.first_response_at = TicketStatus.EN_PROCESO, now
            ticket.timeline.append(TimelineEntry(kind=TimelineKind.ASIGNADO, actor="Asistente IA", text=f"{tech.full_name} atenderá su reporte."))
    await ticket.insert()
    await _publish(ticket, "ticket.created")
    return ticket, False


async def assign(ticket: Ticket, actor: StaffUser, technician_id: PydanticObjectId | None) -> Ticket:
    now = utcnow()
    if technician_id:
        tech = await StaffUser.get(technician_id)
        if not tech or not tech.active:
            raise HTTPException(status_code=422, detail="Técnico no válido.")
        ticket.assigned_to_id, ticket.assigned_to_name = tech.id, tech.full_name
        if ticket.status == TicketStatus.PENDIENTE:
            ticket.status = TicketStatus.EN_PROCESO
        ticket.first_response_at = ticket.first_response_at or now
        ticket.timeline.append(TimelineEntry(kind=TimelineKind.ASIGNADO, actor=actor.full_name, text=f"{tech.full_name} atenderá su reporte."))
    else:
        ticket.assigned_to_id, ticket.assigned_to_name = None, None
        if ticket.status == TicketStatus.EN_PROCESO:
            ticket.status = TicketStatus.PENDIENTE
        ticket.timeline.append(TimelineEntry(kind=TimelineKind.ASIGNADO, actor=actor.full_name, text="Se quitó la asignación.", internal=True))
    ticket.updated_at = now
    await ticket.save()
    await _publish(ticket, "ticket.updated")
    if ticket.assigned_to_id and ticket.assigned_to_id != actor.id:
        await broker.publish(f"staff:{ticket.assigned_to_id}", _event(ticket, "ticket.assigned"))
    return ticket


async def update_classification(ticket: Ticket, actor: StaffUser, category: TicketCategory | None, priority: TicketPriority | None) -> Ticket:
    if category and category != ticket.category:
        ticket.timeline.append(
            TimelineEntry(kind=TimelineKind.CATEGORIA, actor=actor.full_name, internal=True,
                          text=f"Categoría: {CATEGORY_LABELS[ticket.category]} → {CATEGORY_LABELS[category]}")
        )
        ticket.category, ticket.category_source = category, "TECNICO"
    if priority and priority != ticket.priority:
        ticket.timeline.append(
            TimelineEntry(kind=TimelineKind.PRIORIDAD, actor=actor.full_name, internal=True, text=f"Prioridad: {ticket.priority} → {priority}")
        )
        ticket.priority, ticket.priority_source = priority, "TECNICO"
    ticket.updated_at = utcnow()
    await ticket.save()
    await _publish(ticket, "ticket.updated")
    return ticket


async def add_note(ticket: Ticket, actor: StaffUser, text: str, visible_to_office: bool) -> Ticket:
    ticket.timeline.append(TimelineEntry(kind=TimelineKind.NOTA, actor=actor.full_name, text=text.strip(), internal=not visible_to_office))
    ticket.first_response_at = ticket.first_response_at or utcnow()
    ticket.updated_at = utcnow()
    await ticket.save()
    await _publish(ticket, "ticket.updated")
    return ticket


async def resolve(ticket: Ticket, actor: StaffUser, notes: str) -> Ticket:
    if ticket.status == TicketStatus.RESUELTO:
        raise HTTPException(status_code=409, detail="La incidencia ya está resuelta.")
    now = utcnow()
    ticket.status = TicketStatus.RESUELTO
    ticket.resolution = Resolution(notes=notes.strip(), resolved_by_id=str(actor.id), resolved_by_name=actor.full_name, resolved_at=now)
    if not ticket.assigned_to_id:
        ticket.assigned_to_id, ticket.assigned_to_name = actor.id, actor.full_name
    ticket.first_response_at = ticket.first_response_at or now
    ticket.timeline.append(TimelineEntry(kind=TimelineKind.ESTADO, actor=actor.full_name, text=f"Problema resuelto: {notes.strip()}"))
    ticket.updated_at = now
    await ticket.save()
    await _publish(ticket, "ticket.resolved")
    asyncio.create_task(_maybe_retrain())
    return ticket


async def reopen(ticket: Ticket, actor_name: str, by_user: bool) -> Ticket:
    if ticket.status != TicketStatus.RESUELTO:
        raise HTTPException(status_code=409, detail="La incidencia no está resuelta.")
    ticket.status = TicketStatus.EN_PROCESO if ticket.assigned_to_id else TicketStatus.PENDIENTE
    if ticket.resolution and by_user:
        ticket.resolution.confirmed_by_user = False
    if by_user:
        ticket.priority = _PRIORITY_UP[ticket.priority]
    text = "El usuario indica que el problema continúa." if by_user else "Incidencia reabierta."
    ticket.timeline.append(TimelineEntry(kind=TimelineKind.ESTADO, actor=actor_name, text=text))
    ticket.updated_at = utcnow()
    await ticket.save()
    await _publish(ticket, "ticket.reopened")
    return ticket


async def confirm_by_office(ticket: Ticket, office: Office, solved: bool) -> Ticket:
    if ticket.status != TicketStatus.RESUELTO:
        raise HTTPException(status_code=409, detail="Este reporte todavía se está atendiendo.")
    if not solved:
        return await reopen(ticket, office.name, by_user=True)
    if ticket.resolution:
        ticket.resolution.confirmed_by_user = True
    ticket.timeline.append(TimelineEntry(kind=TimelineKind.CONFIRMACION, actor=office.name, text="El usuario confirmó que ya funciona."))
    ticket.updated_at = utcnow()
    await ticket.save()
    await _publish(ticket, "ticket.updated")
    return ticket


async def _maybe_retrain() -> None:
    try:
        latest = await AIModelRecord.find_all().sort(-AIModelRecord.trained_at).limit(1).to_list()
        since = latest[0].trained_at if latest else utcnow() - timedelta(days=3650)
        resolved = await Ticket.find({"status": TicketStatus.RESUELTO.value, "resolution.resolved_at": {"$gt": since}}).count()
        if resolved >= get_settings().ai_retrain_every_resolved:
            await get_engine().train()
    except Exception:
        log.exception("Reentrenamiento automático falló")
