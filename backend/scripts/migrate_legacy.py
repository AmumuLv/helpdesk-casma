"""Importa tickets del sistema anterior (Node/Express: colección `tickets`) al nuevo esquema.

Uso: python -m scripts.migrate_legacy --legacy-uri "mongodb+srv://..." --legacy-db helpdesk_db
Crea oficinas inactivas a partir del campo `area` (el administrador luego las revisa, asigna usuario y activa).
"""
import argparse
import asyncio
import re
import unicodedata

from pymongo import AsyncMongoClient

from app import db
from app.core.timeutil import aware, utcnow
from app.models import Office, Ticket
from app.models.enums import TicketCategory, TicketChannel, TicketPriority, TicketStatus, TimelineKind
from app.models.ticket import Resolution, TimelineEntry


def slug(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", text)[:30] or "oficina"


async def run(uri: str, name: str) -> None:
    await db.connect()
    legacy = AsyncMongoClient(uri, tz_aware=True)[name]
    imported = 0
    async for old in legacy["tickets"].find({}):
        number = f"INC-LEG-{str(old['_id'])[-8:].upper()}"
        if await Ticket.find_one(Ticket.number == number):
            continue
        area = (old.get("area") or "Sin área").strip()
        office = await Office.find_one(Office.name == area)
        if not office:
            base = slug(area)
            office = Office(code=f"LEG{await Office.find_all().count() + 1:03d}", name=area, username=f"{base}-legacy", active=False)
            await office.insert()
        created = aware(old.get("fecha")) or utcnow()
        status = TicketStatus(old.get("estado", "PENDIENTE")) if old.get("estado") in TicketStatus.__members__ else TicketStatus.PENDIENTE
        await Ticket(
            number=number, office_id=office.id, office_name=office.name, channel=TicketChannel.WEB,
            subject=(old.get("asunto") or "Incidencia importada")[:160], description=(old.get("descripcion") or "")[:2000],
            reporter_name=old.get("creadoPor"), category=TicketCategory.OTRO, category_source="IA",
            priority=TicketPriority(old.get("prioridad", "MEDIA")) if old.get("prioridad") in TicketPriority.__members__ else TicketPriority.MEDIA,
            status=status, assigned_to_name=None if old.get("tecnicoAsignado") in (None, "Sin Asignar") else old["tecnicoAsignado"],
            resolution=Resolution(notes="Importado del sistema anterior.", resolved_by_id="legacy", resolved_by_name=old.get("tecnicoAsignado") or "Sistema anterior", resolved_at=created) if status == TicketStatus.RESUELTO else None,
            timeline=[TimelineEntry(at=created, kind=TimelineKind.CREADO, actor=old.get("creadoPor") or area, text="Importado del sistema anterior.")],
            created_at=created, updated_at=created,
        ).insert()
        imported += 1
    print(f"Tickets importados: {imported}")
    await db.disconnect()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--legacy-uri", required=True)
    parser.add_argument("--legacy-db", default="helpdesk_db")
    args = parser.parse_args()
    asyncio.run(run(args.legacy_uri, args.legacy_db))
