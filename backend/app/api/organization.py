import re
from collections import Counter

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pymongo.errors import DuplicateKeyError

from app.api.deps import parse_id, require_admin, require_staff
from app.core.timeutil import utcnow
from app.models import Equipment, MunicipalUser, Office, StaffUser, Zone
from app.schemas.organization import (
    MunicipalUserIn,
    MunicipalUserOut,
    MunicipalUserPatch,
    ZoneIn,
    ZoneOut,
    ZonePatch,
)
from app.services import audit

router = APIRouter(prefix="/organization", tags=["organización municipal"])


async def _zone(raw_id: str) -> Zone:
    oid = parse_id(raw_id)
    zone = await Zone.get(oid) if oid else None
    if not zone:
        raise HTTPException(status_code=404, detail="Zona no encontrada.")
    return zone


async def _office(raw_id: str) -> Office:
    oid = parse_id(raw_id)
    office = await Office.get(oid) if oid else None
    if not office:
        raise HTTPException(status_code=422, detail="Oficina no válida.")
    return office


async def _municipal_user(raw_id: str) -> MunicipalUser:
    oid = parse_id(raw_id)
    user = await MunicipalUser.get(oid) if oid else None
    if not user:
        raise HTTPException(status_code=404, detail="Usuario municipal no encontrado.")
    return user


async def _zone_outs(zones: list[Zone]) -> list[ZoneOut]:
    office_docs = await Office.get_pymongo_collection().find({}, {"zone_id": 1}).to_list(None)
    user_docs = await MunicipalUser.get_pymongo_collection().find({}, {"office_id": 1}).to_list(None)
    equipment_docs = await Equipment.get_pymongo_collection().find({}, {"office_id": 1}).to_list(None)

    office_zone = {str(doc["_id"]): str(doc.get("zone_id")) if doc.get("zone_id") else None for doc in office_docs}
    offices_by_zone = Counter(zone_id for zone_id in office_zone.values() if zone_id)
    users_by_zone = Counter(
        office_zone.get(str(doc.get("office_id")))
        for doc in user_docs
        if office_zone.get(str(doc.get("office_id")))
    )
    equipment_by_zone = Counter(
        office_zone.get(str(doc.get("office_id")))
        for doc in equipment_docs
        if office_zone.get(str(doc.get("office_id")))
    )

    return [
        ZoneOut(
            id=str(zone.id),
            code=zone.code,
            name=zone.name,
            description=zone.description,
            active=zone.active,
            office_count=offices_by_zone.get(str(zone.id), 0),
            user_count=users_by_zone.get(str(zone.id), 0),
            equipment_count=equipment_by_zone.get(str(zone.id), 0),
            created_at=zone.created_at,
            updated_at=zone.updated_at,
        )
        for zone in zones
    ]


async def _user_outs(users: list[MunicipalUser]) -> list[MunicipalUserOut]:
    office_ids = list({user.office_id for user in users})
    offices = {
        office.id: office
        for office in await Office.find({"_id": {"$in": office_ids}}).to_list()
    } if office_ids else {}
    equipment_docs = await Equipment.get_pymongo_collection().find(
        {"responsable_id": {"$in": [user.id for user in users]}},
        {"responsable_id": 1},
    ).to_list(None) if users else []
    equipment_counts = Counter(str(doc.get("responsable_id")) for doc in equipment_docs if doc.get("responsable_id"))

    result: list[MunicipalUserOut] = []
    for user in users:
        office = offices.get(user.office_id)
        if not office:
            continue
        result.append(
            MunicipalUserOut(
                id=str(user.id),
                employee_code=user.employee_code,
                full_name=user.full_name,
                office_id=str(user.office_id),
                office_name=office.name,
                zone_id=str(office.zone_id) if office.zone_id else None,
                zone_name=office.zone_name,
                job_title=user.job_title,
                email=user.email,
                phone=user.phone,
                photo_url=None,
                active=user.active,
                equipment_count=equipment_counts.get(str(user.id), 0),
                created_at=user.created_at,
                updated_at=user.updated_at,
            )
        )
    return result


@router.get("/zones", response_model=list[ZoneOut])
async def list_zones(
    active: bool | None = None,
    _: StaffUser = Depends(require_staff),
):
    query = {} if active is None else {"active": active}
    return await _zone_outs(await Zone.find(query).sort("name").to_list())


@router.post("/zones", response_model=ZoneOut, status_code=201)
async def create_zone(
    request: Request,
    body: ZoneIn,
    admin: StaffUser = Depends(require_admin),
):
    zone = Zone(
        code=body.code,
        name=body.name.strip(),
        description=body.description.strip() if body.description else None,
    )
    try:
        await zone.insert()
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Ya existe una zona con ese código o nombre.")
    await audit.record(
        request, "staff", "zone.created",
        actor_id=str(admin.id), actor_name=admin.full_name,
        target_type="zone", target_id=str(zone.id),
    )
    return (await _zone_outs([zone]))[0]


@router.patch("/zones/{zone_id}", response_model=ZoneOut)
async def update_zone(
    request: Request,
    zone_id: str,
    body: ZonePatch,
    admin: StaffUser = Depends(require_admin),
):
    zone = await _zone(zone_id)
    changes = body.model_dump(exclude_unset=True)
    if changes.get("active") is False:
        active_offices = await Office.find({"zone_id": zone.id, "active": True}).count()
        if active_offices:
            raise HTTPException(
                status_code=409,
                detail="No puede desactivar la zona mientras tenga oficinas activas.",
            )

    old_name = zone.name
    for key, value in changes.items():
        setattr(zone, key, value.strip() if isinstance(value, str) else value)
    zone.updated_at = utcnow()
    try:
        await zone.save()
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Ya existe una zona con ese nombre.")

    if zone.name != old_name:
        await Office.get_pymongo_collection().update_many(
            {"zone_id": zone.id},
            {"$set": {"zone_name": zone.name, "updated_at": utcnow()}},
        )

    await audit.record(
        request, "staff", "zone.updated",
        actor_id=str(admin.id), actor_name=admin.full_name,
        target_type="zone", target_id=str(zone.id),
        fields=sorted(changes),
    )
    return (await _zone_outs([zone]))[0]


@router.get("/users", response_model=list[MunicipalUserOut])
async def list_municipal_users(
    office_id: str | None = None,
    zone_id: str | None = None,
    active: bool | None = None,
    q: str | None = Query(None, max_length=80),
    _: StaffUser = Depends(require_staff),
):
    query: dict = {}
    if active is not None:
        query["active"] = active

    if office_id:
        oid = parse_id(office_id)
        if not oid:
            raise HTTPException(status_code=422, detail="Oficina no válida.")
        query["office_id"] = oid
    elif zone_id:
        zid = parse_id(zone_id)
        if not zid:
            raise HTTPException(status_code=422, detail="Zona no válida.")
        offices = await Office.find({"zone_id": zid}).to_list()
        query["office_id"] = {"$in": [office.id for office in offices]}

    if q and q.strip():
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        query["$or"] = [
            {"full_name": rx},
            {"employee_code": rx},
            {"job_title": rx},
            {"email": rx},
        ]

    users = await MunicipalUser.find(query).sort("full_name").limit(1000).to_list()
    return await _user_outs(users)


@router.post("/users", response_model=MunicipalUserOut, status_code=201)
async def create_municipal_user(
    request: Request,
    body: MunicipalUserIn,
    admin: StaffUser = Depends(require_admin),
):
    office = await _office(body.office_id)
    if not office.active:
        raise HTTPException(status_code=422, detail="La oficina seleccionada está inactiva.")

    user = MunicipalUser(
        employee_code=body.employee_code,
        full_name=body.full_name,
        office_id=office.id,
        job_title=body.job_title.strip() if body.job_title else None,
        email=body.email.strip().lower() if body.email else None,
        phone=body.phone.strip() if body.phone else None,
    )
    try:
        await user.insert()
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Ese código de trabajador ya está registrado.")

    await audit.record(
        request, "staff", "municipal_user.created",
        actor_id=str(admin.id), actor_name=admin.full_name,
        target_type="municipal_user", target_id=str(user.id),
        office_id=str(office.id),
    )
    return (await _user_outs([user]))[0]


@router.patch("/users/{user_id}", response_model=MunicipalUserOut)
async def update_municipal_user(
    request: Request,
    user_id: str,
    body: MunicipalUserPatch,
    admin: StaffUser = Depends(require_admin),
):
    user = await _municipal_user(user_id)
    changes = body.model_dump(exclude_unset=True)
    assigned_count = await Equipment.find({"responsable_id": user.id}).count()

    if "office_id" in changes and changes["office_id"]:
        office = await _office(changes["office_id"])
        if office.id != user.office_id and assigned_count:
            raise HTTPException(
                status_code=409,
                detail="Reasigne primero los equipos de este usuario antes de cambiarlo de oficina.",
            )
        changes["office_id"] = office.id

    if changes.get("active") is False and assigned_count:
        raise HTTPException(
            status_code=409,
            detail="Reasigne primero los equipos de este usuario antes de desactivarlo.",
        )

    for key, value in changes.items():
        if key == "employee_code" and value:
            value = value.strip().upper()
        elif key == "full_name" and value:
            value = " ".join(value.split())
        elif key == "email" and value:
            value = value.strip().lower()
        elif isinstance(value, str):
            value = value.strip() or None
        setattr(user, key, value)

    user.updated_at = utcnow()
    try:
        await user.save()
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Ese código de trabajador ya está registrado.")

    # Mantener la copia legible de nombre sincronizada en los equipos asignados.
    await Equipment.get_pymongo_collection().update_many(
        {"responsable_id": user.id},
        {"$set": {"responsible_name": user.full_name, "updated_at": utcnow()}},
    )

    await audit.record(
        request, "staff", "municipal_user.updated",
        actor_id=str(admin.id), actor_name=admin.full_name,
        target_type="municipal_user", target_id=str(user.id),
        fields=sorted(changes),
    )
    return (await _user_outs([user]))[0]
