from fastapi import Request

from app.core.network import client_ip
from app.models import AuditLog


def offline_request_details(request: Request | None) -> dict:
    if request is None:
        return {}
    operation = (request.headers.get("X-Offline-Operation") or "").strip()
    if not operation:
        return {}
    return {
        "offline_operation": operation[:80],
        "offline_replay": request.headers.get("X-Offline-Replay") == "1",
    }


async def replayed_target_id(request: Request | None, target_type: str) -> str | None:
    if request is None:
        return None
    operation = (request.headers.get("X-Offline-Operation") or "").strip()
    if not operation:
        return None
    previous = await AuditLog.find_one({
        "target_type": target_type,
        "details.offline_operation": operation[:80],
    })
    return previous.target_id if previous else None


async def record(
    request: Request | None,
    actor_type: str,
    action: str,
    actor_id: str | None = None,
    actor_name: str | None = None,
    target_type: str | None = None,
    target_id: str | None = None,
    **details,
) -> None:
    await AuditLog(
        actor_type=actor_type, actor_id=actor_id, actor_name=actor_name, action=action,
        target_type=target_type, target_id=target_id, ip=client_ip(request) if request else None, details=details,
    ).insert()
