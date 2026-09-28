from app.core.timeutil import aware, utcnow
from app.models import Device, Equipment, Office, StaffUser, Ticket
from app.models.enums import TicketStatus
from app.models.ticket import WaitReason
from app.schemas.admin import DeviceOut, EquipmentOut, OfficeOut, StaffOut
from app.schemas.ticket import AttachmentOut, FollowUpOut, OfficeTicketOut, OfficeTimelineItem, TicketOut


_AUTOMATED_FOLLOW_UP_ACTORS = {"Asistente IA", "IA predictiva", "Triaje local"}
_WAIT_REASON_LABEL = {
    WaitReason.REPUESTO: "Espera de repuesto",
    WaitReason.PROVEEDOR: "Espera de proveedor",
    WaitReason.AUTORIZACION: "Espera de autorización",
    WaitReason.USUARIO: "Espera de respuesta del usuario",
    WaitReason.DIAGNOSTICO_COMPLEJO: "Diagnóstico complejo",
    WaitReason.DEPENDENCIA_EXTERNA: "Dependencia externa",
    WaitReason.OTRO: "Otro motivo justificado",
}


def _attachments(t: Ticket) -> list[AttachmentOut]:
    return [AttachmentOut(id=a.id, url=f"/api/tickets/{t.id}/attachments/{a.id}", width=a.width, height=a.height) for a in t.attachments]


def last_human_activity(t: Ticket):
    human_activity = [entry.at for entry in t.timeline if entry.actor not in _AUTOMATED_FOLLOW_UP_ACTORS]
    return max(human_activity) if human_activity else t.created_at


def _ai_follow_up(t: Ticket, state: str, hours: float) -> tuple[str | None, str | None, list[str]]:
    if not t.ai:
        return None, None, []

    reasons: list[str] = []
    similar = t.ai.similar_cases[:2]
    if similar:
        reasons.append(f"La IA encontró {len(similar)} caso(s) histórico(s) parecido(s) para comparar el contexto.")
    if t.ai.equipment_incidents_90d >= 2:
        reasons.append(f"El equipo registra {t.ai.equipment_incidents_90d} incidencias en los últimos 90 días.")
    if t.ai.historical_patterns:
        reasons.append(t.ai.historical_patterns[0])

    if state == "EN_ESPERA":
        label = _WAIT_REASON_LABEL.get(t.waiting_reason, "motivo registrado")
        summary = f"La IA reconoce que la atención está en espera por {label.lower()}; este tiempo no se interpreta como falta de seguimiento."
        recommendation = "Mantener el caso visible y actualizarlo cuando cambie la dependencia registrada."
    elif state == "REQUIERE_REVISION":
        summary = "La IA recomienda revisar este caso por la combinación de tiempo sin actividad y contexto histórico disponible."
        recommendation = "Solicitar una actualización del caso y confirmar el siguiente paso antes de cambiar responsable o prioridad."
    elif state == "SIN_ACTUALIZACION":
        summary = "La IA detecta una pausa de seguimiento que conviene comprobar, sin atribuir responsabilidad automática al técnico."
        recommendation = "Revisar si existe una novedad, dependencia externa o motivo de espera que deba registrarse."
    elif state == "EN_SEGUIMIENTO":
        summary = "La IA no detecta señales claras de falta de seguimiento en este momento."
        recommendation = "Mantener el seguimiento actual y registrar los avances relevantes."
    else:
        summary = "La atención ya fue finalizada y conserva su contexto histórico para futuros análisis."
        recommendation = None

    if hours >= 48 and state not in {"EN_ESPERA", "CERRADA"}:
        reasons.insert(0, f"Han transcurrido {round(hours, 1)} horas desde la última actividad humana registrada.")

    return summary, recommendation, reasons[:4]


def follow_up_for(t: Ticket) -> FollowUpOut:
    last_activity = last_human_activity(t)

    if t.status == TicketStatus.RESUELTO:
        closed_at = t.resolution.resolved_at if t.resolution else last_activity
        ai_summary, ai_recommendation, ai_reasons = _ai_follow_up(t, "CERRADA", 0)
        return FollowUpOut(
            state="CERRADA",
            label="Atención finalizada",
            detail="La solución quedó registrada en el historial.",
            last_activity_at=closed_at,
            hours_without_update=0,
            ai_summary=ai_summary,
            ai_recommendation=ai_recommendation,
            ai_reasons=ai_reasons,
        )

    hours = max(0.0, (aware(utcnow()) - aware(last_activity)).total_seconds() / 3600)

    if t.waiting_reason:
        reason_label = _WAIT_REASON_LABEL.get(t.waiting_reason, "Motivo registrado")
        ai_summary, ai_recommendation, ai_reasons = _ai_follow_up(t, "EN_ESPERA", hours)
        return FollowUpOut(
            state="EN_ESPERA",
            label="En espera",
            detail=f"La atención está pausada por {reason_label.lower()}. El motivo quedó registrado para dar contexto al tiempo transcurrido.",
            last_activity_at=last_activity,
            hours_without_update=round(hours, 1),
            wait_reason=t.waiting_reason,
            wait_reason_label=reason_label,
            wait_note=t.waiting_note,
            waiting_since=t.waiting_since,
            ai_summary=ai_summary,
            ai_recommendation=ai_recommendation,
            ai_reasons=ai_reasons,
        )

    if not t.assigned_to_id:
        state = "REQUIERE_REVISION"
        label = "Requiere revisión"
        detail = "Aún no tiene técnico asignado. Conviene revisar quién continuará la atención."
    elif hours <= 12:
        state = "EN_SEGUIMIENTO"
        label = "En seguimiento"
        detail = "Registra actividad reciente. El caso continúa con seguimiento normal."
    elif hours <= 48:
        state = "SIN_ACTUALIZACION"
        label = "Sin actualización reciente"
        detail = "No hay una actualización reciente. Conviene revisar si existen novedades o un motivo de espera."
    else:
        state = "REQUIERE_REVISION"
        label = "Requiere revisión"
        detail = "Lleva tiempo sin una actualización. Se recomienda revisar el caso; no implica incumplimiento del técnico."

    ai_summary, ai_recommendation, ai_reasons = _ai_follow_up(t, state, hours)
    return FollowUpOut(
        state=state,
        label=label,
        detail=detail,
        last_activity_at=last_activity,
        hours_without_update=round(hours, 1),
        ai_summary=ai_summary,
        ai_recommendation=ai_recommendation,
        ai_reasons=ai_reasons,
    )


def ticket_out(t: Ticket) -> TicketOut:
    return TicketOut(
        id=str(t.id), number=t.number, office_id=str(t.office_id), office_name=t.office_name, office_location=t.office_location,
        equipment=t.equipment, channel=t.channel, quick_issue=t.quick_issue, subject=t.subject, description=t.description,
        reporter_name=t.reporter_name, contact_phone=t.contact_phone, category=t.category, category_source=t.category_source,
        priority=t.priority, priority_source=t.priority_source, status=t.status, assigned_to_id=str(t.assigned_to_id) if t.assigned_to_id else None,
        assigned_to_name=t.assigned_to_name, attachments=_attachments(t), ai=t.ai, resolution=t.resolution,
        timeline=t.timeline, follow_up=follow_up_for(t), first_response_at=t.first_response_at, created_at=t.created_at, updated_at=t.updated_at,
    )


def office_ticket_out(t: Ticket) -> OfficeTicketOut:
    return OfficeTicketOut(
        id=str(t.id), number=t.number, subject=t.subject, description=t.description, status=t.status, priority=t.priority,
        equipment_code=t.equipment.patrimonial_code if t.equipment else None,
        assigned_to_name=t.assigned_to_name, attachments=_attachments(t),
        user_message=t.ai.user_message if t.ai else "Recibimos su reporte.",
        user_tips=t.ai.user_tips if t.ai else [],
        resolution_notes=t.resolution.notes if t.resolution else None,
        confirmed_by_user=t.resolution.confirmed_by_user if t.resolution else None,
        timeline=[OfficeTimelineItem(at=e.at, actor=e.actor, text=e.text) for e in t.timeline if not e.internal],
        created_at=t.created_at, updated_at=t.updated_at,
    )


def office_out(o: Office, approved: int = 0, pending: int = 0) -> OfficeOut:
    return OfficeOut(
        id=str(o.id), code=o.code, name=o.name, username=o.username,
        zone_id=str(o.zone_id) if o.zone_id else None, zone_name=o.zone_name,
        location=o.location, head_name=o.head_name,
        head_phone=o.head_phone, service_level=o.service_level, service_reason=o.service_reason,
        priority_weight=o.priority_weight, active=o.active,
        devices_approved=approved, devices_pending=pending, created_at=o.created_at,
    )


def device_out(d: Device, office_name: str, equipment_code: str | None) -> DeviceOut:
    return DeviceOut(
        id=str(d.id), office_id=str(d.office_id), office_name=office_name, status=d.status, pair_code=d.pair_code,
        kind=d.kind, label=d.label, user_agent=d.user_agent, first_ip=d.first_ip, last_ip=d.last_ip,
        equipment_id=str(d.equipment_id) if d.equipment_id else None, equipment_code=equipment_code,
        last_seen_at=d.last_seen_at, created_at=d.created_at,
    )


def staff_out(u: StaffUser, open_tickets: int = 0) -> StaffOut:
    return StaffOut(
        id=str(u.id), username=u.username, full_name=u.full_name, email=u.email, phone=u.phone, role=u.role,
        specialties=u.specialties, active=u.active, totp_enabled=u.totp_enabled,
        locked=bool(u.locked_until and aware(u.locked_until) > utcnow()), last_login_at=u.last_login_at, open_tickets=open_tickets,
    )


def equipment_out(
    e: Equipment,
    office_name: str | None = None,
    zone_id: str | None = None,
    zone_name: str | None = None,
) -> EquipmentOut:
    return EquipmentOut(
        id=str(e.id),
        office_id=str(e.office_id) if e.office_id else None,
        office_name=office_name,
        zone_id=zone_id,
        zone_name=zone_name,
        responsable_id=str(e.responsable_id) if e.responsable_id else None,
        **e.model_dump(exclude={"id", "office_id", "responsable_id", "revision_id"}),
    )
