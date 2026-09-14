from fastapi import APIRouter, Depends, HTTPException, Request

from app.ai.engine import get_engine
from app.api.deps import parse_id, require_admin, require_staff
from app.core.timeutil import utcnow
from app.models import Announcement, StaffUser
from app.schemas.common import Message
from app.services import audit
from app.services.events import broker

router = APIRouter(prefix="/ai", tags=["inteligencia artificial"])


async def publish_alerts(alerts: list[Announcement]) -> None:
    for a in alerts:
        await broker.publish("staff", {"type": "alert.created", "title": a.title, "message": a.staff_message})
        for oid in a.office_ids:
            await broker.publish(f"office:{oid}", {"type": "alert.created", "title": a.title, "message": a.message})


@router.get("/insights")
async def insights(_: StaffUser = Depends(require_staff)):
    return await get_engine().insights()


@router.get("/status")
async def status(_: StaffUser = Depends(require_staff)):
    engine = get_engine()
    return {"ready": engine.state is not None, "version": engine.version, "backend": engine.backend}


@router.post("/retrain")
async def retrain(request: Request, admin: StaffUser = Depends(require_admin)):
    record = await get_engine().train()
    await audit.record(request, "staff", "ai.retrained", actor_id=str(admin.id), actor_name=admin.full_name, version=record.version)
    return record.model_dump(exclude={"id", "revision_id"})


@router.post("/scan-anomalies")
async def scan(_: StaffUser = Depends(require_staff)):
    created = await get_engine().scan_anomalies()
    await publish_alerts(created)
    return {"created": [{"title": a.title, "message": a.staff_message} for a in created]}


@router.post("/alerts/{alert_id}/close", response_model=Message)
async def close_alert(request: Request, alert_id: str, user: StaffUser = Depends(require_staff)):
    aid = parse_id(alert_id)
    alert = await Announcement.get(aid) if aid else None
    if not alert:
        raise HTTPException(status_code=404, detail="Alerta no encontrada.")
    alert.active_until = utcnow()
    await alert.save()
    await audit.record(request, "staff", "alert.closed", actor_id=str(user.id), actor_name=user.full_name, target_type="alert", target_id=alert_id)
    return Message(message="Alerta cerrada.")
