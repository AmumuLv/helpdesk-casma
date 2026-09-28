from fastapi import APIRouter, Depends, HTTPException, Request

from app.api.deps import require_staff
from app.api.tickets import _get
from app.models import StaffUser
from app.schemas.ticket import ResumeIn, TicketOut, WaitIn
from app.services import audit
from app.services import follow_up as follow_up_service
from app.services.serializers import ticket_out

router = APIRouter(prefix="/tickets", tags=["seguimiento"])


@router.post("/{ticket_id}/wait", response_model=TicketOut)
async def mark_waiting(request: Request, ticket_id: str, data: WaitIn, user: StaffUser = Depends(require_staff)):
    ticket = await _get(ticket_id)
    try:
        ticket = await follow_up_service.set_waiting(ticket, user, data.reason, data.note)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    await audit.record(
        request,
        "staff",
        "ticket.waiting",
        actor_id=str(user.id),
        actor_name=user.full_name,
        target_type="ticket",
        target_id=str(ticket.id),
        wait_reason=data.reason.value,
        note=data.note,
    )
    return ticket_out(ticket)


@router.post("/{ticket_id}/resume", response_model=TicketOut)
async def resume_ticket(request: Request, ticket_id: str, data: ResumeIn, user: StaffUser = Depends(require_staff)):
    ticket = await _get(ticket_id)
    try:
        ticket = await follow_up_service.resume(ticket, user, data.note)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    await audit.record(
        request,
        "staff",
        "ticket.resumed",
        actor_id=str(user.id),
        actor_name=user.full_name,
        target_type="ticket",
        target_id=str(ticket.id),
        note=data.note,
    )
    return ticket_out(ticket)
