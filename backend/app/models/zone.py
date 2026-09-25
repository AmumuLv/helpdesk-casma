from datetime import datetime
from typing import Annotated

from beanie import Document, Indexed
from pydantic import Field

from app.core.timeutil import utcnow


class Zone(Document):
    code: Annotated[str, Indexed(unique=True)]
    name: Annotated[str, Indexed(unique=True)]
    description: str | None = None
    active: bool = True
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)

    class Settings:
        name = "zones"
