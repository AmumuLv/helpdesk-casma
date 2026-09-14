import argparse
import asyncio
import getpass
import random
import sys
from datetime import timedelta

from app import db
from app.ai.engine import get_engine
from app.ai.seed import _PHRASES
from app.core.config import get_settings
from app.core.security import hash_password, office_password_errors, staff_password_errors
from app.core.timeutil import utcnow
from app.models import Equipment, Office, StaffUser, Ticket
from app.models.enums import (
    EquipmentType,
    StaffRole,
    TicketCategory,
    TicketChannel,
    TicketPriority,
    TicketStatus,
    TimelineKind,
)
from app.models.ticket import Resolution, TimelineEntry
from app.services.office_access import set_office_password
from app.services.tickets import equipment_snapshot


def _ask_password(validator, *args) -> str:
    while True:
        pw = getpass.getpass("Contraseña: ")
        if errors := validator(pw, *args):
            print("\n".join(f"  - {e}" for e in errors))
            continue
        if getpass.getpass("Repita la contraseña: ") != pw:
            print("  - Las contraseñas no coinciden.")
            continue
        return pw


async def create_admin(username: str, full_name: str) -> None:
    username = username.strip().lower()
    if await StaffUser.find_one(StaffUser.username == username):
        sys.exit(f"El usuario {username} ya existe.")
    password = _ask_password(staff_password_errors, username)
    await StaffUser(username=username, full_name=full_name, role=StaffRole.ADMIN, password_hash=hash_password(password),
                    specialties=[TicketCategory.RED_INTERNET, TicketCategory.SISTEMAS_MUNICIPALES]).insert()
    print(f"Administrador {username} creado. Configure la verificación en dos pasos al iniciar sesión.")


async def office_password() -> None:
    password = _ask_password(lambda pw: office_password_errors(pw))
    version = await set_office_password(password)
    print(f"Contraseña de oficinas configurada (versión {version}).")


_DEMO_OFFICES = [
    ("ADM", "Gerencia de Administración", "administracion", "Palacio Municipal - Piso 2", "José Ramírez", 1.0),
    ("CAJ", "Caja y Tesorería", "tesoreria", "Palacio Municipal - Piso 1", "Rosa Villanueva", 1.6),
    ("MDP", "Mesa de Partes", "mesadepartes", "Palacio Municipal - Piso 1", "Luis Chávez", 1.5),
    ("REN", "Gerencia de Rentas", "rentas", "Palacio Municipal - Piso 2", "Carmen Flores", 1.2),
    ("OBR", "Gerencia de Obras", "obras", "Anexo Municipal", "Miguel Salazar", 1.0),
    ("RRC", "Registro Civil", "registrocivil", "Anexo Municipal", "Elena Paredes", 1.1),
]
_MODELS = [("HP", "ProDesk 400 G6", EquipmentType.PC), ("Lenovo", "ThinkCentre M720", EquipmentType.PC),
           ("Dell", "OptiPlex 3080", EquipmentType.PC), ("Epson", "L3250", EquipmentType.IMPRESORA),
           ("HP", "LaserJet M428", EquipmentType.IMPRESORA), ("Lenovo", "ThinkPad E14", EquipmentType.LAPTOP)]
_RESOLUTIONS = {
    TicketCategory.HARDWARE: ["Se reemplazó la fuente de poder.", "Se limpió la memoria RAM y se reasentó.", "Se cambió el cable de poder dañado."],
    TicketCategory.RED_INTERNET: ["Se reconectó el patch cord en el switch del piso.", "Se reinició el switch de acceso.", "Se reemplazó el cable de red dañado."],
    TicketCategory.IMPRESORA: ["Se retiró el papel atascado y se limpiaron rodillos.", "Se reemplazó el tóner.", "Se reinstaló el controlador de impresora."],
    TicketCategory.SOFTWARE: ["Se liberó espacio en disco y se deshabilitaron programas de inicio.", "Se reinstaló Microsoft Office."],
    TicketCategory.SISTEMAS_MUNICIPALES: ["Se restableció el acceso al módulo con el proveedor.", "Se actualizó el cliente del sistema."],
    TicketCategory.CUENTAS_CORREO: ["Se restableció la contraseña y se verificó el acceso.", "Se desbloqueó la cuenta de dominio."],
    TicketCategory.SEGURIDAD: ["Se aisló el equipo, se ejecutó análisis antivirus y se restauró desde respaldo."],
    TicketCategory.PERIFERICOS: ["Se reemplazó el mouse.", "Se cambió el teclado."],
    TicketCategory.OTRO: ["Se brindó el apoyo solicitado."],
}


async def seed_demo(force: bool) -> None:
    if not get_settings().is_dev and not force:
        sys.exit("seed-demo solo en development (use --force para forzar).")
    rng = random.Random(42)
    techs = []
    for username, name, specs in [
        ("cruiz", "Carlos Ruiz", [TicketCategory.RED_INTERNET, TicketCategory.HARDWARE]),
        ("amendoza", "Ana Mendoza", [TicketCategory.SOFTWARE, TicketCategory.SISTEMAS_MUNICIPALES, TicketCategory.CUENTAS_CORREO]),
        ("pgomez", "Pedro Gómez", [TicketCategory.IMPRESORA, TicketCategory.PERIFERICOS, TicketCategory.HARDWARE]),
    ]:
        tech = await StaffUser.find_one(StaffUser.username == username)
        if not tech:
            tech = StaffUser(username=username, full_name=name, role=StaffRole.TECNICO, specialties=specs,
                             password_hash=hash_password("Demo-" + username + "-2026!"), must_change_password=True)
            await tech.insert()
        techs.append(tech)
    now = utcnow()
    for code, name, username, location, head, weight in _DEMO_OFFICES:
        office = await Office.find_one(Office.code == code)
        if not office:
            office = Office(code=code, name=name, username=username, location=location, head_name=head, priority_weight=weight)
            await office.insert()
        equipment = await Equipment.find({"office_id": office.id}).to_list()
        for i in range(len(equipment), 5):
            brand, model, etype = rng.choice(_MODELS)
            eq = Equipment(patrimonial_code=f"{code}-{etype.value[:3]}-{i + 1:03d}", type=etype, brand=brand, model=model,
                           ip_address=f"10.10.{_DEMO_OFFICES.index((code, name, username, location, head, weight)) + 1}.{20 + i}",
                           office_id=office.id, acquired_on=now - timedelta(days=rng.randint(200, 3200)), criticality=2 if weight > 1.3 else 1)
            await eq.insert()
            equipment.append(eq)
        if await Ticket.find({"office_id": office.id}).count():
            continue
        fragile = rng.sample(equipment, 2)
        for n in range(rng.randint(25, 40)):
            eq = rng.choice(fragile if rng.random() < 0.55 else equipment)
            cats = [TicketCategory.IMPRESORA] if eq.type == EquipmentType.IMPRESORA else [c for c in TicketCategory if c != TicketCategory.IMPRESORA]
            cat = rng.choice(cats)
            created = now - timedelta(days=rng.randint(3, 520), hours=rng.randint(0, 9))
            resolved_at = created + timedelta(hours=rng.uniform(0.5, 30))
            tech = rng.choice([t for t in techs if cat in t.specialties] or techs)
            seq = await Ticket.find_all().count() + 1
            await Ticket(
                number=f"INC-DEMO-{seq:06d}", office_id=office.id, office_name=office.name, office_location=office.location,
                equipment_id=eq.id, equipment=equipment_snapshot(eq), channel=TicketChannel.WEB, subject=rng.choice(_PHRASES[cat]).capitalize(),
                description="", category=cat, category_source="TECNICO", priority=rng.choice(list(TicketPriority)),
                status=TicketStatus.RESUELTO, assigned_to_id=tech.id, assigned_to_name=tech.full_name, first_response_at=created + timedelta(minutes=30),
                resolution=Resolution(notes=rng.choice(_RESOLUTIONS[cat]), resolved_by_id=str(tech.id), resolved_by_name=tech.full_name, resolved_at=resolved_at, confirmed_by_user=True),
                timeline=[TimelineEntry(at=created, kind=TimelineKind.CREADO, actor=office.name, text="Reporte recibido.")],
                created_at=created, updated_at=resolved_at,
            ).insert()
    print("Datos de demostración creados. Contraseñas demo de técnicos: Demo-<usuario>-2026! (deben cambiarse).")


async def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("create-admin")
    p.add_argument("--username", required=True)
    p.add_argument("--full-name", required=True)
    sub.add_parser("set-office-password")
    sub.add_parser("train-ai")
    sub.add_parser("check-db")
    d = sub.add_parser("seed-demo")
    d.add_argument("--force", action="store_true")
    args = parser.parse_args()

    await db.connect()
    try:
        if args.command == "create-admin":
            await create_admin(args.username, args.full_name)
        elif args.command == "set-office-password":
            await office_password()
        elif args.command == "check-db":
            info = await db.database().command("buildInfo")
            names = await db.database().list_collection_names()
            print(f"Conexión correcta.\nServidor MongoDB: {info.get('version', '?')}\nBase: {get_settings().mongo_db}\nColecciones: {len(names)}")
        elif args.command == "train-ai":
            record = await get_engine().train()
            print(record.model_dump_json(indent=2, exclude={"id", "revision_id"}))
        elif args.command == "seed-demo":
            await seed_demo(args.force)
    finally:
        await db.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
