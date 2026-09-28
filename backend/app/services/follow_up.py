from app.core.timeutil import utcnow
from app.models import StaffUser, Ticket
from app.models.enums import TicketStatus, TimelineKind
from app.models.ticket import TimelineEntry, WaitReason
from app.services.events import broker
from app.services.serializers import follow_up_for


WAIT_REASON_LABEL = {
    WaitReason.REPUESTO: "Espera de repuesto",
    WaitReason.PROVEEDOR: "Espera de proveedor",
    WaitReason.AUTORIZACION: "Espera de autorización",
    WaitReason.USUARIO: "Espera de respuesta del usuario",
    WaitReason.DIAGNOSTICO_COMPLEJO: "Diagnóstico complejo",
    WaitReason.DEPENDENCIA_EXTERNA: "Dependencia externa",
    WaitReason.OTRO: "Otro motivo justificado",
}


def event_payload(ticket: Ticket, kind: str, **extra) -> dict:
    payload = {
        "type": kind,
        "ticket_id": str(ticket.id),
        "number": ticket.number,
        "subject": ticket.subject,
        "office": ticket.office_name,
        "status": ticket.status.value,
        "priority": ticket.priority.value,
        "assigned_to_id": str(ticket.assigned_to_id) if ticket.assigned_to_id else None,
        "assigned_to_name": ticket.assigned_to_name,
        "reporter_name": ticket.reporter_name,
    }
    payload.update(extra)
    return payload


async def publish_ticket_event(ticket: Ticket, kind: str, **extra) -> None:
    event = event_payload(ticket, kind, **extra)
    await broker.publish("staff", event)
    await broker.publish(f"office:{ticket.office_id}", event)


async def set_waiting(ticket: Ticket, actor: StaffUser, reason: WaitReason, note: str | None = None) -> Ticket:
    if ticket.status == TicketStatus.RESUELTO:
        raise ValueError("No se puede poner en espera una incidencia cerrada.")
    if not ticket.assigned_to_id:
        raise ValueError("Asigne un técnico antes de poner la incidencia en espera.")

    now = utcnow()
    label = WAIT_REASON_LABEL[reason]
    clean_note = " ".join((note or "").split()) or None
    ticket.waiting_reason = reason
    ticket.waiting_note = clean_note
    ticket.waiting_since = now
    ticket.waiting_by_id = actor.id
    ticket.waiting_by_name = actor.full_name
    ticket.followup_alert_state = None
    ticket.followup_alerted_at = None
    ticket.timeline.append(
        TimelineEntry(
            kind=TimelineKind.ESTADO,
            actor=actor.full_name,
            text=f"Atención en espera: {label}.",
        )
    )
    if clean_note:
        ticket.timeline.append(
            TimelineEntry(
                kind=TimelineKind.NOTA,
                actor=actor.full_name,
                text=f"Motivo interno de espera: {clean_note}",
                internal=True,
            )
        )
    ticket.updated_at = now
    await ticket.save()
    await publish_ticket_event(ticket, "ticket.waiting", wait_reason=reason.value, wait_reason_label=label, message=clean_note)
    return ticket


async def resume(ticket: Ticket, actor: StaffUser, note: str | None = None) -> Ticket:
    if ticket.status == TicketStatus.RESUELTO:
        raise ValueError("La incidencia ya está cerrada.")
    if not ticket.waiting_reason:
        raise ValueError("La incidencia no está marcada como en espera.")

    previous_label = WAIT_REASON_LABEL.get(ticket.waiting_reason, "Motivo registrado")
    clean_note = " ".join((note or "").split()) or None
    now = utcnow()
    ticket.waiting_reason = None
    ticket.waiting_note = None
    ticket.waiting_since = None
    ticket.waiting_by_id = None
    ticket.waiting_by_name = None
    ticket.followup_alert_state = None
    ticket.followup_alerted_at = None
    ticket.timeline.append(
        TimelineEntry(
            kind=TimelineKind.ESTADO,
            actor=actor.full_name,
            text=f"Atención reanudada después de {previous_label.lower()}.",
        )
    )
    if clean_note:
        ticket.timeline.append(TimelineEntry(kind=TimelineKind.NOTA, actor=actor.full_name, text=clean_note, internal=True))
    ticket.updated_at = now
    await ticket.save()
    await publish_ticket_event(ticket, "ticket.resumed", message=clean_note)
    return ticket


async def scan_follow_up_notifications() -> int:
    active = await Ticket.find({"deleted_at": None, "status": {"$ne": TicketStatus.RESUELTO.value}}).to_list()
    emitted = 0
    for ticket in active:
        follow_up = follow_up_for(ticket)
        alert_state = follow_up.state if follow_up.state in {"SIN_ACTUALIZACION", "REQUIERE_REVISION"} else None

        if alert_state and ticket.followup_alert_state != alert_state:
            await publish_ticket_event(
                ticket,
                "ticket.followup_due",
                follow_up_state=alert_state,
                follow_up_label=follow_up.label,
                message=follow_up.ai_recommendation or follow_up.detail,
            )
            ticket.followup_alert_state = alert_state
            ticket.followup_alerted_at = utcnow()
            await ticket.save()
            emitted += 1
        elif not alert_state and ticket.followup_alert_state:
            ticket.followup_alert_state = None
            ticket.followup_alerted_at = None
            await ticket.save()

    return emitted
