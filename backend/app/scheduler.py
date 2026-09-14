import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.ai.engine import get_engine
from app.api.ai import publish_alerts
from app.core.config import get_settings

log = logging.getLogger("helpdesk.scheduler")


async def anomaly_job() -> None:
    try:
        await publish_alerts(await get_engine().scan_anomalies())
    except Exception:
        log.exception("Escaneo de anomalías falló")


async def retrain_job() -> None:
    try:
        await get_engine().train()
    except Exception:
        log.exception("Reentrenamiento nocturno falló")


def build_scheduler() -> AsyncIOScheduler:
    scheduler = AsyncIOScheduler(timezone=get_settings().timezone)
    scheduler.add_job(anomaly_job, "interval", minutes=5, id="anomalies", max_instances=1, coalesce=True)
    scheduler.add_job(retrain_job, CronTrigger(hour=2, minute=30), id="retrain", max_instances=1, coalesce=True)
    return scheduler
