import asyncio
import json

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.api.deps import OfficePrincipal, StaffPrincipal, resolve_principal
from app.services.events import broker

router = APIRouter(tags=["eventos"])


@router.get("/events")
async def events(request: Request):
    principal = await resolve_principal(request)
    if isinstance(principal, StaffPrincipal) and not principal.user.must_change_password:
        channels = ["staff", f"staff:{principal.user.id}"]
    elif isinstance(principal, OfficePrincipal) and principal.approved:
        channels = [f"office:{principal.office.id}"]
    else:
        raise HTTPException(status_code=401, detail="Sesión no válida.")

    queue = broker.subscribe(channels)

    async def stream():
        try:
            yield "retry: 5000\n\n"
            while not await request.is_disconnected():
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=20)
                    yield f"event: {event['type']}\ndata: {json.dumps(event, default=str)}\n\n"
                except TimeoutError:
                    yield ": ping\n\n"
        finally:
            broker.unsubscribe(channels, queue)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
