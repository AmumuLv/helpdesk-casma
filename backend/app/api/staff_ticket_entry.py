import re

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Request, UploadFile

from app.ai.engine import get_engine
from app.api.deps import parse_id, require_staff
from app.api.tickets import _equipment_for, _office, _replayed_ticket
from app.models import MunicipalUser, StaffUser
from app.models.enums import TicketCategory, TicketChannel, TicketPriority
from app.schemas.ticket import TicketOut
from app.services import audit
from app.services import tickets as ticket_service
from app.services.serializers import ticket_out

router = APIRouter(prefix="/tickets", tags=["incidencias"])


async def _municipal_user_for(office_id, municipal_user_id: str | None) -> MunicipalUser | None:
    if not municipal_user_id:
        return None
    uid = parse_id(municipal_user_id)
    municipal_user = await MunicipalUser.get(uid) if uid else None
    if not municipal_user or not municipal_user.active or municipal_user.office_id != office_id:
        raise HTTPException(status_code=422, detail="El usuario seleccionado no pertenece a la oficina o ya no está activo.")
    return municipal_user


def _clean_registered_phone(value: str | None) -> str | None:
    digits = re.sub(r"\D", "", value or "")
    return digits if len(digits) == 9 else None


@router.post("/assisted", response_model=TicketOut, status_code=201)
async def create_assisted_ticket(
    request: Request,
    background_tasks: BackgroundTasks,
    office_id: str = Form(...),
    description: str = Form(..., min_length=3, max_length=2000),
    municipal_user_id: str | None = Form(None),
    equipment_id: str | None = Form(None),
    reporter_name: str | None = Form(None, max_length=80),
    contact_phone: str | None = Form(None, min_length=9, max_length=9, pattern=r"^\d{9}$"),
    channel: TicketChannel = Form(TicketChannel.TELEFONO),
    category: TicketCategory | None = Form(None),
    priority: TicketPriority | None = Form(None),
    technician_id: str | None = Form(None),
    photo: UploadFile | None = File(None),
    user: StaffUser = Depends(require_staff),
):
    if replayed := await _replayed_ticket(request):
        return ticket_out(replayed)

    office = await _office(office_id)
    equipment = await _equipment_for(office, equipment_id)
    municipal_user = await _municipal_user_for(office.id, municipal_user_id)

    if municipal_user:
        reporter_name = municipal_user.full_name
        contact_phone = contact_phone or _clean_registered_phone(municipal_user.phone)

    reporter_name = " ".join((reporter_name or "").split()) or None
    if not reporter_name:
        raise HTTPException(status_code=422, detail="Indique quién reporta la incidencia o seleccione un usuario registrado.")

    ticket, duplicated = await ticket_service.create_ticket(
        ticket_service.NewTicket(
            office=office,
            channel=channel,
            description=description,
            equipment=equipment,
            reporter_name=reporter_name,
            contact_phone=contact_phone,
            photo=photo if photo and photo.filename else None,
            staff=user,
            category=category,
            priority=priority,
        )
    )

    traceability = {}
    if office.zone_id:
        traceability["zone_id"] = office.zone_id
    if municipal_user:
        traceability["user_id"] = municipal_user.id
    if traceability:
        await ticket.set(traceability)

    if technician_id:
        tid = parse_id(technician_id)
        if not tid:
            raise HTTPException(status_code=422, detail="Técnico no válido.")
        ticket = await ticket_service.assign(ticket, user, tid)

    if not duplicated:
        background_tasks.add_task(get_engine().analyze_ticket_background, str(ticket.id))

    await audit.record(
        request,
        "staff",
        "ticket.created.assisted",
        actor_id=str(user.id),
        actor_name=user.full_name,
        target_type="ticket",
        target_id=str(ticket.id),
        office_id=str(office.id),
        municipal_user_id=str(municipal_user.id) if municipal_user else None,
        channel=channel.value,
        **audit.offline_request_details(request),
    )
    return ticket_out(ticket)
