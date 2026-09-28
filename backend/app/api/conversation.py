from enum import StrEnum
from typing import Literal

from beanie import PydanticObjectId
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.ai.engine import TriageRequest, get_engine
from app.api.deps import OfficePrincipal, StaffPrincipal, parse_id, require_office, require_staff, resolve_principal
from app.core.timeutil import utcnow
from app.models import Equipment, Office, StaffUser, Ticket, TicketConversation
from app.models.conversation import ConversationAttachment, ConversationMessage
from app.models.enums import TicketStatus, TimelineKind
from app.models.ticket import TimelineEntry, WaitReason
from app.services import audit
from app.services.conversation_storage import conversation_attachment_path, save_conversation_attachment
from app.services.events import broker

router = APIRouter(tags=["conversación"])


class AttentionState(StrEnum):
    POR_ATENDER = "POR_ATENDER"
    EN_ATENCION = "EN_ATENCION"
    ESPERANDO_RESPUESTA = "ESPERANDO_RESPUESTA"
    EN_ESPERA = "EN_ESPERA"
    CERRADA = "CERRADA"


class ReassignmentReason(StrEnum):
    OTRA_ESPECIALIDAD = "OTRA_ESPECIALIDAD"
    TECNICO_NO_DISPONIBLE = "TECNICO_NO_DISPONIBLE"
    DISTRIBUCION_CARGA = "DISTRIBUCION_CARGA"
    COMPLEJIDAD = "COMPLEJIDAD"
    RESPONSABLE_TI = "RESPONSABLE_TI"
    OTRO = "OTRO"


REASSIGNMENT_LABEL = {
    ReassignmentReason.OTRA_ESPECIALIDAD: "Otra especialidad",
    ReassignmentReason.TECNICO_NO_DISPONIBLE: "Técnico no disponible",
    ReassignmentReason.DISTRIBUCION_CARGA: "Distribución de carga",
    ReassignmentReason.COMPLEJIDAD: "Complejidad del caso",
    ReassignmentReason.RESPONSABLE_TI: "Decisión del responsable TI",
    ReassignmentReason.OTRO: "Otro motivo",
}


class ConversationAttachmentOut(BaseModel):
    id: str
    url: str
    filename: str
    content_type: str
    width: int | None = None
    height: int | None = None


class ConversationMessageOut(BaseModel):
    id: str
    at: str
    author_type: Literal["staff", "office"]
    author_name: str
    text: str
    attachments: list[ConversationAttachmentOut]
    seen_by_staff_at: str | None = None
    seen_by_office_at: str | None = None


class ConversationOut(BaseModel):
    attention_state: AttentionState
    attention_label: str
    office_attention_label: str
    messages: list[ConversationMessageOut]
    unread_for_staff: int
    unread_for_office: int


class ReassignIn(BaseModel):
    technician_id: str | None = None
    reason: ReassignmentReason | None = None
    note: str | None = Field(default=None, max_length=500)


class ReassignOut(BaseModel):
    assigned_to_id: str | None
    assigned_to_name: str | None
    handoff_summary: str | None = None


class ConversationAssistantOut(BaseModel):
    summary: str
    missing_info: list[str]
    suggested_questions: list[str]
    suggested_reply: str
    priority_suggestion: str | None
    priority_reason: str | None
    recommended_technician_id: str | None
    recommended_technician_name: str | None
    technician_reasons: list[str]
    keep_current_technician: bool
    handoff_summary: str


async def _ticket(ticket_id: str) -> Ticket:
    tid = parse_id(ticket_id)
    ticket = await Ticket.get(tid) if tid else None
    if not ticket or ticket.deleted_at:
        raise HTTPException(status_code=404, detail="Incidencia no encontrada.")
    return ticket


async def _office_ticket(ticket_id: str, principal: OfficePrincipal) -> Ticket:
    ticket = await _ticket(ticket_id)
    if ticket.office_id != principal.office.id:
        raise HTTPException(status_code=404, detail="Reporte no encontrado.")
    return ticket


async def _conversation(ticket: Ticket, create: bool = True) -> TicketConversation | None:
    conversation = await TicketConversation.find_one({"ticket_id": ticket.id})
    if conversation or not create:
        return conversation
    conversation = TicketConversation(ticket_id=ticket.id)
    await conversation.insert()
    return conversation


def _attention(ticket: Ticket) -> tuple[AttentionState, str, str]:
    if ticket.status == TicketStatus.RESUELTO:
        return AttentionState.CERRADA, "Cerrada", "Finalizada"
    if ticket.waiting_reason == WaitReason.USUARIO:
        return AttentionState.ESPERANDO_RESPUESTA, "Esperando respuesta", "Necesitamos su respuesta"
    if ticket.waiting_reason:
        return AttentionState.EN_ESPERA, "En espera", "En espera"
    if ticket.assigned_to_id or ticket.status == TicketStatus.EN_PROCESO:
        return AttentionState.EN_ATENCION, "En atención", "Siendo atendida"
    return AttentionState.POR_ATENDER, "Por atender", "Recibida"


def _attachment_out(ticket: Ticket, attachment: ConversationAttachment) -> ConversationAttachmentOut:
    return ConversationAttachmentOut(
        id=attachment.id,
        url=f"/api/tickets/{ticket.id}/conversation/attachments/{attachment.id}",
        filename=attachment.original_name,
        content_type=attachment.content_type,
        width=attachment.width,
        height=attachment.height,
    )


def _out(ticket: Ticket, conversation: TicketConversation | None) -> ConversationOut:
    state, label, office_label = _attention(ticket)
    messages = conversation.messages if conversation else []
    return ConversationOut(
        attention_state=state,
        attention_label=label,
        office_attention_label=office_label,
        messages=[
            ConversationMessageOut(
                id=message.id,
                at=message.at.isoformat(),
                author_type=message.author_type,
                author_name=message.author_name,
                text=message.text,
                attachments=[_attachment_out(ticket, a) for a in message.attachments],
                seen_by_staff_at=message.seen_by_staff_at.isoformat() if message.seen_by_staff_at else None,
                seen_by_office_at=message.seen_by_office_at.isoformat() if message.seen_by_office_at else None,
            )
            for message in messages
        ],
        unread_for_staff=sum(1 for m in messages if m.author_type == "office" and not m.seen_by_staff_at),
        unread_for_office=sum(1 for m in messages if m.author_type == "staff" and not m.seen_by_office_at),
    )


def _event(ticket: Ticket, kind: str, **extra) -> dict:
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


async def _publish(ticket: Ticket, kind: str, **extra) -> None:
    payload = _event(ticket, kind, **extra)
    await broker.publish("staff", payload)
    await broker.publish(f"office:{ticket.office_id}", payload)


def _clear_wait(ticket: Ticket) -> None:
    ticket.waiting_reason = None
    ticket.waiting_note = None
    ticket.waiting_since = None
    ticket.waiting_by_id = None
    ticket.waiting_by_name = None


def _handoff_summary(ticket: Ticket, conversation: TicketConversation | None) -> str:
    recent = (conversation.messages[-4:] if conversation else [])
    chat = " | ".join(
        f"{m.author_name}: {m.text[:180]}" for m in recent if m.text.strip()
    )
    parts = [f"{ticket.number}: {ticket.subject}."]
    if ticket.ai and ticket.ai.briefing:
        parts.append(f"Contexto IA: {ticket.ai.briefing}")
    elif ticket.description:
        parts.append(f"Descripción: {ticket.description[:260]}")
    if chat:
        parts.append(f"Conversación reciente: {chat}")
    if ticket.waiting_reason:
        parts.append(f"Pendiente actual: {ticket.waiting_reason.value.replace('_', ' ').lower()}.")
    return " ".join(parts)[:1600]


@router.get("/tickets/{ticket_id}/conversation", response_model=ConversationOut)
async def staff_conversation(ticket_id: str, _: StaffUser = Depends(require_staff)):
    ticket = await _ticket(ticket_id)
    return _out(ticket, await _conversation(ticket))


@router.get("/office/tickets/{ticket_id}/conversation", response_model=ConversationOut)
async def office_conversation(ticket_id: str, p: OfficePrincipal = Depends(require_office)):
    ticket = await _office_ticket(ticket_id, p)
    return _out(ticket, await _conversation(ticket))


@router.post("/tickets/{ticket_id}/conversation/read", response_model=ConversationOut)
async def staff_read(ticket_id: str, _: StaffUser = Depends(require_staff)):
    ticket = await _ticket(ticket_id)
    conversation = await _conversation(ticket)
    now = utcnow()
    changed = False
    for message in conversation.messages:
        if message.author_type == "office" and not message.seen_by_staff_at:
            message.seen_by_staff_at = now
            changed = True
    if changed:
        conversation.updated_at = now
        await conversation.save()
    return _out(ticket, conversation)


@router.post("/office/tickets/{ticket_id}/conversation/read", response_model=ConversationOut)
async def office_read(ticket_id: str, p: OfficePrincipal = Depends(require_office)):
    ticket = await _office_ticket(ticket_id, p)
    conversation = await _conversation(ticket)
    now = utcnow()
    changed = False
    for message in conversation.messages:
        if message.author_type == "staff" and not message.seen_by_office_at:
            message.seen_by_office_at = now
            changed = True
    if changed:
        conversation.updated_at = now
        await conversation.save()
    return _out(ticket, conversation)


@router.post("/tickets/{ticket_id}/conversation/messages", response_model=ConversationOut)
async def staff_message(
    request: Request,
    ticket_id: str,
    text: str = Form("", max_length=2000),
    wait_for_reply: bool = Form(False),
    attachment: UploadFile | None = File(None),
    user: StaffUser = Depends(require_staff),
):
    ticket = await _ticket(ticket_id)
    if ticket.status == TicketStatus.RESUELTO:
        raise HTTPException(status_code=409, detail="Reabra la incidencia antes de enviar mensajes.")
    clean = text.strip()
    if not clean and not (attachment and attachment.filename):
        raise HTTPException(status_code=422, detail="Escriba un mensaje o adjunte un archivo.")
    if wait_for_reply and not ticket.assigned_to_id:
        raise HTTPException(status_code=409, detail="Asigne un técnico antes de solicitar respuesta a la oficina.")

    conversation = await _conversation(ticket)
    now = utcnow()
    files = [await save_conversation_attachment(attachment)] if attachment and attachment.filename else []
    conversation.messages.append(
        ConversationMessage(
            author_type="staff",
            author_id=str(user.id),
            author_name=user.full_name,
            text=clean,
            attachments=files,
            seen_by_staff_at=now,
        )
    )
    conversation.updated_at = now

    ticket.first_response_at = ticket.first_response_at or now
    if ticket.assigned_to_id and ticket.status == TicketStatus.PENDIENTE:
        ticket.status = TicketStatus.EN_PROCESO
    if wait_for_reply:
        if ticket.waiting_reason != WaitReason.USUARIO:
            ticket.timeline.append(TimelineEntry(kind=TimelineKind.ESTADO, actor=user.full_name, text="Soporte TI está esperando una respuesta de la oficina."))
        ticket.waiting_reason = WaitReason.USUARIO
        ticket.waiting_note = "Se solicitó información adicional por el chat del ticket."
        ticket.waiting_since = now
        ticket.waiting_by_id = user.id
        ticket.waiting_by_name = user.full_name
    elif ticket.waiting_reason == WaitReason.USUARIO:
        _clear_wait(ticket)
        ticket.timeline.append(TimelineEntry(kind=TimelineKind.ESTADO, actor=user.full_name, text="Atención reanudada por Soporte TI."))

    ticket.followup_alert_state = None
    ticket.followup_alerted_at = None
    ticket.updated_at = now
    await conversation.save()
    await ticket.save()
    await _publish(ticket, "ticket.note", visible_to_office=True, message=clean[:180] or "Archivo adjunto", source="staff")
    await audit.record(
        request,
        "staff",
        "ticket.message.sent",
        actor_id=str(user.id),
        actor_name=user.full_name,
        target_type="ticket",
        target_id=str(ticket.id),
        wait_for_reply=wait_for_reply,
        has_attachment=bool(files),
    )
    return _out(ticket, conversation)


@router.post("/office/tickets/{ticket_id}/conversation/messages", response_model=ConversationOut)
async def office_message(
    request: Request,
    ticket_id: str,
    text: str = Form("", max_length=2000),
    attachment: UploadFile | None = File(None),
    p: OfficePrincipal = Depends(require_office),
):
    ticket = await _office_ticket(ticket_id, p)
    if ticket.status == TicketStatus.RESUELTO:
        raise HTTPException(status_code=409, detail="La incidencia está finalizada. Si el problema continúa, use la opción de confirmar que sigue fallando.")
    clean = text.strip()
    if not clean and not (attachment and attachment.filename):
        raise HTTPException(status_code=422, detail="Escriba un mensaje o adjunte un archivo.")

    conversation = await _conversation(ticket)
    now = utcnow()
    files = [await save_conversation_attachment(attachment)] if attachment and attachment.filename else []
    conversation.messages.append(
        ConversationMessage(
            author_type="office",
            author_id=str(p.office.id),
            author_name=p.office.name,
            text=clean,
            attachments=files,
            seen_by_office_at=now,
        )
    )
    conversation.updated_at = now

    if ticket.waiting_reason == WaitReason.USUARIO:
        _clear_wait(ticket)
        if ticket.assigned_to_id:
            ticket.status = TicketStatus.EN_PROCESO
        ticket.timeline.append(TimelineEntry(kind=TimelineKind.ESTADO, actor=p.office.name, text="La oficina respondió. La atención vuelve a estar activa."))
    ticket.followup_alert_state = None
    ticket.followup_alerted_at = None
    ticket.updated_at = now
    await conversation.save()
    await ticket.save()
    await _publish(ticket, "ticket.note", visible_to_office=True, message=clean[:180] or "Archivo adjunto", source="office")
    await audit.record(
        request,
        "office",
        "ticket.message.office_sent",
        actor_id=str(p.office.id),
        actor_name=p.office.name,
        target_type="ticket",
        target_id=str(ticket.id),
        has_attachment=bool(files),
    )
    return _out(ticket, conversation)


@router.get("/tickets/{ticket_id}/conversation/assistant", response_model=ConversationAssistantOut)
async def conversation_assistant(ticket_id: str, _: StaffUser = Depends(require_staff)):
    ticket = await _ticket(ticket_id)
    office = await Office.get(ticket.office_id)
    if not office:
        raise HTTPException(status_code=422, detail="La oficina del ticket ya no está disponible.")
    equipment = await Equipment.get(ticket.equipment_id) if ticket.equipment_id else None
    conversation = await _conversation(ticket)
    recent = conversation.messages[-8:]
    chat_context = "\n".join(f"{m.author_name}: {m.text}" for m in recent if m.text.strip())
    description = ticket.description
    if chat_context:
        description = f"{description}\n\nConversación reciente:\n{chat_context}".strip()

    analysis = await get_engine().analyze(
        TriageRequest(
            subject=ticket.subject,
            description=description,
            quick_issue=ticket.quick_issue,
            office=office,
            equipment=equipment,
            exclude_ticket_id=str(ticket.id),
            category_hint=ticket.category if ticket.category_source == "TECNICO" else None,
        )
    )

    questions_by_category = {
        "HARDWARE": ["¿El equipo enciende y muestra alguna luz o sonido?", "¿Aparece algún mensaje o código de error?"],
        "PERIFERICOS": ["¿El periférico funciona en otro puerto o equipo?", "¿Desde cuándo presenta la falla?"],
        "RED_INTERNET": ["¿El problema afecta a un solo equipo o a toda la oficina?", "¿La conexión es por cable o Wi‑Fi?"],
        "IMPRESORA": ["¿Aparece algún mensaje en la impresora o en la computadora?", "¿El problema ocurre al imprimir cualquier documento?"],
        "SOFTWARE": ["¿Qué programa presenta el problema y qué mensaje muestra?", "¿El error empezó después de alguna actualización o cambio?"],
        "SISTEMAS_MUNICIPALES": ["¿Qué módulo o pantalla del sistema está afectado?", "¿El problema ocurre con un solo usuario o con varios?"],
        "CUENTAS_CORREO": ["¿Puede iniciar sesión y el problema ocurre al enviar o recibir?", "¿Aparece algún mensaje de error?"],
        "SEGURIDAD": ["¿Qué comportamiento inusual se observó y desde cuándo?", "¿El problema afecta a más de un equipo o cuenta?"],
        "OTRO": ["¿Qué estaba intentando hacer cuando apareció el problema?", "¿Aparece algún mensaje de error o comportamiento repetible?"],
    }
    questions = questions_by_category.get(analysis.category.value, questions_by_category["OTRO"])
    all_text = f"{ticket.description} {chat_context}".lower()
    missing = questions[:2] if len(all_text.split()) < 80 else questions[:1]
    latest_office = next((m for m in reversed(recent) if m.author_type == "office" and m.text.strip()), None)
    prefix = "Gracias por la actualización. " if latest_office else "Para continuar con la atención, "
    suggested_reply = prefix + (missing[0] if missing else "seguiremos con la revisión y le avisaremos cuando tengamos una novedad.")

    current_id = str(ticket.assigned_to_id) if ticket.assigned_to_id else None
    continuity = sum(1 for m in conversation.messages if m.author_type == "staff" and m.author_id == current_id) if current_id else 0
    ai_id = analysis.suggested_technician_id
    keep_current = bool(current_id and (ai_id in {None, current_id} or continuity >= 2))
    if keep_current:
        recommended_id = current_id
        recommended_name = ticket.assigned_to_name
        tech_reasons = ["Mantener técnico actual recomendado: ya existe continuidad en el diagnóstico y la conversación."]
        if continuity:
            tech_reasons.append(f"El responsable actual registra {continuity} intervención(es) en el chat del ticket.")
    else:
        recommended_id = ai_id
        recommended_name = analysis.suggested_technician_name
        tech_reasons = analysis.technician_reasons[:4]

    priority_suggestion = analysis.priority.value if analysis.priority != ticket.priority else None
    priority_reason = "; ".join(analysis.priority_reasons[:3]) if priority_suggestion else None
    summary = analysis.briefing
    if recent:
        summary = f"{summary} La conversación contiene {len(recent)} mensaje(s) recientes considerados para esta sugerencia."

    return ConversationAssistantOut(
        summary=summary,
        missing_info=missing,
        suggested_questions=questions,
        suggested_reply=suggested_reply,
        priority_suggestion=priority_suggestion,
        priority_reason=priority_reason,
        recommended_technician_id=recommended_id,
        recommended_technician_name=recommended_name,
        technician_reasons=tech_reasons,
        keep_current_technician=keep_current,
        handoff_summary=_handoff_summary(ticket, conversation),
    )


@router.post("/tickets/{ticket_id}/reassign", response_model=ReassignOut)
async def reassign_ticket(request: Request, ticket_id: str, data: ReassignIn, user: StaffUser = Depends(require_staff)):
    ticket = await _ticket(ticket_id)
    if ticket.status == TicketStatus.RESUELTO:
        raise HTTPException(status_code=409, detail="Reabra la incidencia antes de cambiar responsable.")

    previous_id = str(ticket.assigned_to_id) if ticket.assigned_to_id else None
    previous_name = ticket.assigned_to_name
    target = None
    if data.technician_id:
        tid = parse_id(data.technician_id)
        target = await StaffUser.get(tid) if tid else None
        if not target or not target.active:
            raise HTTPException(status_code=422, detail="Técnico no válido.")
    target_id = str(target.id) if target else None
    if target_id == previous_id:
        raise HTTPException(status_code=409, detail="Ese técnico ya es responsable de la incidencia.")
    if previous_id and not data.reason:
        raise HTTPException(status_code=422, detail="Seleccione el motivo de la reasignación.")

    conversation = await _conversation(ticket)
    now = utcnow()
    handoff = _handoff_summary(ticket, conversation) if previous_id and target else None
    ticket.assigned_to_id = target.id if target else None
    ticket.assigned_to_name = target.full_name if target else None
    if target:
        ticket.status = TicketStatus.EN_PROCESO
        ticket.first_response_at = ticket.first_response_at or now
        public_text = f"{target.full_name} continuará la atención de su reporte." if previous_id else f"{target.full_name} atenderá su reporte."
        ticket.timeline.append(TimelineEntry(kind=TimelineKind.ASIGNADO, actor=user.full_name, text=public_text))
    else:
        _clear_wait(ticket)
        ticket.status = TicketStatus.PENDIENTE
        ticket.timeline.append(TimelineEntry(kind=TimelineKind.ASIGNADO, actor=user.full_name, text="El Área TI está reorganizando la atención del reporte.", internal=True))

    if previous_id and data.reason:
        label = REASSIGNMENT_LABEL[data.reason]
        detail = f"Reasignación: {previous_name or 'responsable anterior'} → {target.full_name if target else 'sin asignar'}. Motivo: {label}."
        if data.note and data.note.strip():
            detail += f" Contexto: {data.note.strip()}"
        ticket.timeline.append(TimelineEntry(kind=TimelineKind.ASIGNADO, actor=user.full_name, text=detail, internal=True))
        if handoff:
            ticket.timeline.append(TimelineEntry(kind=TimelineKind.IA, actor="Asistente IA", text=f"Resumen de transferencia: {handoff}", internal=True))

    ticket.followup_alert_state = None
    ticket.followup_alerted_at = None
    ticket.updated_at = now
    await ticket.save()
    event_type = "ticket.reassigned" if previous_id and target else "ticket.assigned" if target else "ticket.unassigned"
    await _publish(ticket, event_type, previous_technician_name=previous_name, reassignment_reason=data.reason.value if data.reason else None)
    await audit.record(
        request,
        "staff",
        "ticket.reassigned" if previous_id else "ticket.assigned",
        actor_id=str(user.id),
        actor_name=user.full_name,
        target_type="ticket",
        target_id=str(ticket.id),
        previous_technician_name=previous_name,
        technician_id=target_id,
        technician_name=target.full_name if target else None,
        reason=data.reason.value if data.reason else None,
        note=data.note,
    )
    return ReassignOut(
        assigned_to_id=target_id,
        assigned_to_name=target.full_name if target else None,
        handoff_summary=handoff,
    )


@router.get("/tickets/{ticket_id}/conversation/attachments/{attachment_id}")
async def conversation_attachment(
    ticket_id: str,
    attachment_id: str,
    principal: StaffPrincipal | OfficePrincipal = Depends(resolve_principal),
):
    ticket = await _ticket(ticket_id)
    if isinstance(principal, OfficePrincipal) and ticket.office_id != principal.office.id:
        raise HTTPException(status_code=403, detail="No autorizado.")
    conversation = await _conversation(ticket, create=False)
    attachment = next(
        (a for message in (conversation.messages if conversation else []) for a in message.attachments if a.id == attachment_id),
        None,
    )
    if not attachment:
        raise HTTPException(status_code=404, detail="Adjunto no encontrado.")
    path = conversation_attachment_path(attachment.path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Archivo no encontrado.")
    return FileResponse(path, media_type=attachment.content_type, filename=attachment.original_name)
