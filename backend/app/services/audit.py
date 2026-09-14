from fastapi import Request

from app.core.network import client_ip
from app.models import AuditLog


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
