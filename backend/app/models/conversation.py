import uuid
from datetime import datetime
from typing import Annotated, Literal

from beanie import Document, Indexed, PydanticObjectId
from pydantic import BaseModel, Field

from app.core.timeutil import utcnow


class ConversationAttachment(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    path: str
    original_name: str
    content_type: str
    size: int
    width: int | None = None
    height: int | None = None
    uploaded_at: datetime = Field(default_factory=utcnow)


class ConversationMessage(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    at: datetime = Field(default_factory=utcnow)
    author_type: Literal["staff", "office"]
    author_id: str | None = None
    author_name: str
    text: str = ""
    attachments: list[ConversationAttachment] = Field(default_factory=list)
    seen_by_staff_at: datetime | None = None
    seen_by_office_at: datetime | None = None


class TicketConversation(Document):
    ticket_id: Annotated[PydanticObjectId, Indexed(unique=True)]
    messages: list[ConversationMessage] = Field(default_factory=list)
    updated_at: datetime = Field(default_factory=utcnow)

    class Settings:
        name = "ticket_conversations"
