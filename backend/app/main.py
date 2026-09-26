import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import APIRouter, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app import db
from app.ai.engine import get_engine
from app.api import admin, ai, auth, equipment, events, office_portal, organization, tickets
from app.core.config import get_settings
from app.core.ratelimit import limiter

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("helpdesk")
CSRF_HEADER = ("x-requested-with", "HelpDeskCasma")
UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)
    Path(settings.model_dir).mkdir(parents=True, exist_ok=True)
    Path(settings.backup_dir).mkdir(parents=True, exist_ok=True)
    await db.connect()
    warmup = asyncio.create_task(get_engine().ensure_ready())
    scheduler = None
    if settings.run_scheduler:
        from app.scheduler import build_scheduler

        scheduler = build_scheduler()
        scheduler.start()
    yield
    if scheduler:
        scheduler.shutdown(wait=False)
    warmup.cancel()
    await db.disconnect()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version="2.0.0",
        lifespan=lifespan,
        docs_url="/api/docs" if settings.is_dev else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if settings.is_dev else None,
    )
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    @app.middleware("http")
    async def security_middleware(request: Request, call_next):
        if request.url.path.startswith("/api") and request.method in UNSAFE_METHODS:
            if request.headers.get(CSRF_HEADER[0]) != CSRF_HEADER[1]:
                return JSONResponse(status_code=403, content={"detail": "Solicitud rechazada."})
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        response.headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(self), camera=(self)")
        if request.url.path.startswith("/api") and not request.url.path.startswith("/api/docs"):
            response.headers.setdefault("Content-Security-Policy", "default-src 'none'; img-src 'self'; frame-ancestors 'none'")
            response.headers.setdefault("Cache-Control", "no-store")
        return response

    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True,
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"], allow_headers=["Content-Type", "X-Requested-With"],
        )

    api = APIRouter(prefix="/api")

    @api.get("/health", tags=["sistema"])
    async def health():
        return {"status": "ok", "ai_ready": get_engine().state is not None}

    for module in (auth, office_portal, tickets, admin, organization, equipment, ai, events):
        api.include_router(module.router)
    api.include_router(tickets.tech_router)
    api.include_router(tickets.lookup_router)
    app.include_router(api)
    return app


app = create_app()
