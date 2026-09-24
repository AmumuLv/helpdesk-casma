from app.core.timeutil import aware, utcnow
from app.models import Device, Equipment, Office, StaffUser, Ticket
from app.schemas.admin import DeviceOut, EquipmentOut, OfficeOut, StaffOut
from app.schemas.ticket import AttachmentOut, OfficeTicketOut, OfficeTimelineItem, TicketOut


def _attachments(t: Ticket) -> list[AttachmentOut]:
    return [AttachmentOut(id=a.id, url=f"/api/tickets/{t.id}/attachments/{a.id}", width=a.width, height=a.height) for a in t.attachments]


def ticket_out(t: Ticket) -> TicketOut:
    return TicketOut(
        id=str(t.id), number=t.number, office_id=str(t.office_id), office_name=t.office_name, office_location=t.office_location,
        equipment=t.equipment, channel=t.channel, quick_issue=t.quick_issue, subject=t.subject, description=t.description,
        reporter_name=t.reporter_name, contact_phone=t.contact_phone, category=t.category, category_source=t.category_source,
        priority=t.priority, status=t.status, assigned_to_id=str(t.assigned_to_id) if t.assigned_to_id else None,
        assigned_to_name=t.assigned_to_name, attachments=_attachments(t), ai=t.ai, resolution=t.resolution,
        timeline=t.timeline, first_response_at=t.first_response_at, created_at=t.created_at, updated_at=t.updated_at,
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
        head_phone=o.head_phone, priority_weight=o.priority_weight, active=o.active,
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
        id=str(e.id), office_id=str(e.office_id) if e.office_id else None, office_name=office_name,
        zone_id=zone_id, zone_name=zone_name,
        **e.model_dump(exclude={"id", "office_id", "revision_id"}),
    )
