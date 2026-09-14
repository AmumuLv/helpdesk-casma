from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from app.core.config import get_settings


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def local_now() -> datetime:
    return datetime.now(ZoneInfo(get_settings().timezone))


def aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
