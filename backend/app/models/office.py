from datetime import datetime
from typing import Annotated

from beanie import Document, Indexed, PydanticObjectId
from pydantic import Field

from app.core.timeutil import utcnow
from app.models.enums import OfficeServiceLevel


class Office(Document):
    code: Annotated[str, Indexed(unique=True)]
    name: str
    username: Annotated[str, Indexed(unique=True)]
    # Jerarquía institucional: Zona > Oficina.
    # Se mantiene opcional para que los documentos históricos sigan cargando
    # hasta que la migración/asignación de zonas se complete.
    zone_id: Annotated[PydanticObjectId | None, Indexed()] = None
    # Nombre legible de la zona para navegación y reportes.
    zone_name: str | None = None
    location: str | None = None
    head_name: str | None = None
    head_phone: str | None = None
    # Perfil operativo para el triaje local. Ej.: Mesa de Partes, Caja o servicios críticos.
    service_level: OfficeServiceLevel = OfficeServiceLevel.NORMAL
    service_reason: str | None = None
    priority_weight: float = Field(default=1.0, ge=0.5, le=2.0)
    active: bool = True
    session_version: int = 1
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)

    class Settings:
        name = "offices"
