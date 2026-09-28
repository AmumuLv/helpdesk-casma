import re
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query

from app.api.deps import parse_id, require_staff
from app.core.timeutil import aware
from app.models import Office, StaffUser, Ticket
from app.models.enums import TicketCategory, TicketPriority, TicketStatus
from app.models.ticket import ResolutionType
from app.schemas.common import Page
from app.schemas.ticket import TicketOut
from app.services.serializers import ticket_out

router = APIRouter(prefix="/workboard", tags=["incidencias"])

SortMode = Literal[
    "smart",
    "created_desc",
    "created_asc",
    "priority_desc",
    "closed_desc",
    "closed_asc",
    "duration_desc",
    "duration_asc",
]


@router.get("/tickets", response_model=Page[TicketOut])
async def workboard_tickets(
    status: TicketStatus | None = None,
    active: bool | None = Query(None, description="true = pendientes + en proceso"),
    priority: TicketPriority | None = None,
    category: TicketCategory | None = None,
    zone_id: str | None = None,
    office_id: str | None = None,
    user_id: str | None = None,
    technician_id: str | None = None,
    assigned: str | None = Query(None, description="me | none"),
    resolution_type: ResolutionType | None = None,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
    resolved_from: datetime | None = None,
    resolved_to: datetime | None = None,
    sort_by: SortMode = "smart",
    q: str | None = Query(None, max_length=100),
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
    elif zone_id and (zid := parse_id(zone_id)):
        office_ids = [office.id for office in await Office.find({"zone_id": zid}).to_list()]
        query["office_id"] = {"$in": office_ids}

    if user_id and (uid := parse_id(user_id)):
        query["user_id"] = uid

    if status == TicketStatus.RESUELTO:
        if technician_id:
            query["resolution.resolved_by_id"] = technician_id
    else:
        if assigned == "me":
            query["assigned_to_id"] = user.id
        elif assigned == "none":
            query["assigned_to_id"] = None
        elif technician_id and (tid := parse_id(technician_id)):
            query["assigned_to_id"] = tid

    if resolution_type:
        query["resolution.tipo_resolucion"] = resolution_type.value

    created_range: dict = {}
    if created_from:
        created_range["$gte"] = created_from
    if created_to:
        created_range["$lte"] = created_to
    if created_range:
        query["created_at"] = created_range

    resolved_range: dict = {}
    if resolved_from:
        resolved_range["$gte"] = resolved_from
    if resolved_to:
        resolved_range["$lte"] = resolved_to
    if resolved_range:
        query["resolution.resolved_at"] = resolved_range

    if q and q.strip():
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        query["$or"] = [
            {"number": rx},
            {"subject": rx},
            {"description": rx},
            {"office_name": rx},
            {"reporter_name": rx},
            {"assigned_to_name": rx},
            {"equipment.patrimonial_code": rx},
        ]

    finder = Ticket.find(query)
    total = await finder.count()
    offset = (page - 1) * page_size

    if sort_by == "created_desc":
        items = await Ticket.find(query).sort(-Ticket.created_at).skip(offset).limit(page_size).to_list()
    elif sort_by == "created_asc":
        items = await Ticket.find(query).sort(Ticket.created_at).skip(offset).limit(page_size).to_list()
    else:
        ordered = await Ticket.find(query).to_list()
        priority_rank = {
            TicketPriority.ALTA: 0,
            TicketPriority.MEDIA: 1,
            TicketPriority.BAJA: 2,
        }
        status_rank = {
            TicketStatus.PENDIENTE: 0,
            TicketStatus.EN_PROCESO: 1,
            TicketStatus.RESUELTO: 2,
        }

        if sort_by == "smart":
            ordered.sort(
                key=lambda ticket: (
                    priority_rank.get(ticket.priority, 9),
                    0 if ticket.assigned_to_id is None else 1,
                    status_rank.get(ticket.status, 9),
                    aware(ticket.created_at).timestamp(),
                )
            )
        elif sort_by == "priority_desc":
            ordered.sort(
                key=lambda ticket: (
                    priority_rank.get(ticket.priority, 9),
                    aware(ticket.created_at).timestamp(),
                )
            )
        elif sort_by in {"closed_desc", "closed_asc"}:
            ordered.sort(
                key=lambda ticket: aware(ticket.resolution.resolved_at).timestamp() if ticket.resolution else 0,
                reverse=sort_by == "closed_desc",
            )
        elif sort_by in {"duration_desc", "duration_asc"}:
            ordered.sort(
                key=lambda ticket: (
                    aware(ticket.resolution.resolved_at) - aware(ticket.created_at)
                ).total_seconds() if ticket.resolution else 0,
                reverse=sort_by == "duration_desc",
            )
        items = ordered[offset:offset + page_size]

    return Page[TicketOut](
        items=[ticket_out(ticket) for ticket in items],
        total=total,
        page=page,
        page_size=page_size,
    )
