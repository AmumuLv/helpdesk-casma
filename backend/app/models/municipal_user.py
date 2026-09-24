from datetime import datetime
from typing import Annotated

from beanie import Document, Indexed, PydanticObjectId
from pydantic import Field, model_validator

from app.core.timeutil import utcnow


class MunicipalUser(Document):
    employee_code: Annotated[str | None, Indexed(unique=True, sparse=True)] = None
    full_name: Annotated[str, Indexed()]
    office_id: Annotated[PydanticObjectId, Indexed()]
    job_title: str | None = None
    email: str | None = None
    phone: str | None = None
    photo_path: str | None = None
    active: bool = True
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)

    @model_validator(mode="before")
    @classmethod
    def _normalize(cls, data):
        if not isinstance(data, dict):
            return data
        values = dict(data)
        if values.get("employee_code"):
            values["employee_code"] = str(values["employee_code"]).strip().upper()
        if values.get("full_name"):
            values["full_name"] = " ".join(str(values["full_name"]).split())
        return values

    class Settings:
        name = "municipal_users"
