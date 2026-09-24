import io
import ipaddress
import re
import unicodedata
from datetime import date, datetime
from zipfile import BadZipFile

import pytesseract
import qrcode
from PIL import Image, ImageOps, UnidentifiedImageError
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from openpyxl import load_workbook
from openpyxl.utils.exceptions import InvalidFileException
from pydantic import BaseModel, ValidationError
from pymongo.errors import DuplicateKeyError

from app.ai.engine import equipment_row, get_engine, load_ticket_rows
from app.api.deps import parse_id, require_admin, require_staff
from app.core.config import get_settings
from app.core.timeutil import utcnow
from app.db import next_sequence
from app.models import Device, Equipment, Office, StaffUser, Ticket
from app.models.enums import EquipmentStatus, EquipmentType
from app.schemas.admin import EquipmentIn, EquipmentOut
from app.schemas.common import Message
from app.services import audit
from app.services.serializers import equipment_out, ticket_out
from app.schemas.ticket import TicketOut

router = APIRouter(prefix="/equipment", tags=["equipos"])


class EquipmentDetailOut(BaseModel):
    equipment: EquipmentOut
    risk: float | None
    risk_factors: list[str]
    tickets: list[TicketOut]


class EquipmentImportError(BaseModel):
    row: int
    patrimonial_code: str | None = None
    message: str


class EquipmentImportResult(BaseModel):
    processed: int
    imported: int
    rejected: int
    errors: list[EquipmentImportError]
    more_errors: int = 0


class EquipmentImportOfficeRef(BaseModel):
    office_code: str
    office_name: str
    zone_id: str | None
    zone_name: str | None
    head_name: str | None
    import_enabled: bool


class EquipmentOcrOut(BaseModel):
    detected_code: str | None
    matched: bool
    equipment_id: str | None = None
    candidates: list[str] = []
    raw_text: str = ""


_HEADER_ALIASES = {
    "zona": "zona",
    "nombre_zona": "zona",
    "zona_id": "zona_id",
    "id_zona": "zona_id",
    "oficina": "oficina",
    "oficina_codigo": "oficina",
    "codigo_oficina": "oficina",
    "codigo_patrimonial": "codigo_patrimonial",
    "cod_patrimonial": "codigo_patrimonial",
    "patrimonial_code": "codigo_patrimonial",
    "tipo": "tipo",
    "tipo_equipo": "tipo",
    "area": "area",
    "dispositivo": "dispositivo",
    "marca": "marca",
    "modelo": "modelo",
    "tamano_pantalla": "tamano_pantalla",
    "tamaño_pantalla": "tamano_pantalla",
    "nombre_equipo": "nombre_equipo",
    "ip": "ip",
    "direccion_ip": "ip",
    "hostname": "hostname",
    "mac": "mac",
    "direccion_mac": "mac",
    "cpu": "cpu",
    "procesador": "cpu",
    "ram_gb": "ram_gb",
    "ram": "ram_gb",
    "almacenamiento_gb": "almacenamiento_gb",
    "almacenamiento": "almacenamiento_gb",
    "disco_gb": "almacenamiento_gb",
    "sistema_operativo": "sistema_operativo",
    "so": "sistema_operativo",
    "fecha_adquisicion": "fecha_adquisicion",
    "garantia_hasta": "garantia_hasta",
    "estado": "estado",
    "propiedad": "propiedad",
    "responsable": "responsable",
    "responsable_tipo": "responsable_tipo",
    "tipo_responsable": "responsable_tipo",
    "criticidad": "criticidad",
    "notas": "notas",
}

_SUPPORTED_EQUIPMENT_TYPES = {
    EquipmentType.CPU,
    EquipmentType.MONITOR,
    EquipmentType.MOUSE,
    EquipmentType.TECLADO,
    EquipmentType.IMPRESORA,
    EquipmentType.LAPTOP,
}

_EQUIPMENT_TYPE_ALIASES = {
    "CPU": EquipmentType.CPU,
    "COMPUTADORA": EquipmentType.CPU,
    "COMPUTADOR": EquipmentType.CPU,
    "DESKTOP": EquipmentType.CPU,
    "PC": EquipmentType.CPU,
    "LAPTOP": EquipmentType.LAPTOP,
    "PORTATIL": EquipmentType.LAPTOP,
    "IMPRESORA": EquipmentType.IMPRESORA,
    "MONITOR": EquipmentType.MONITOR,
    "MOUSE": EquipmentType.MOUSE,
    "RATON": EquipmentType.MOUSE,
    "TECLADO": EquipmentType.TECLADO,
}

_STATUS_ALIASES = {
    "OPERATIVO": EquipmentStatus.OPERATIVO,
    "EN_REPARACION": EquipmentStatus.EN_REPARACION,
    "EN REPARACION": EquipmentStatus.EN_REPARACION,
    "BAJA": EquipmentStatus.BAJA,
}


def _normal(value) -> str:
    text = unicodedata.normalize("NFKD", str(value or "").strip())
    return "".join(ch for ch in text if not unicodedata.combining(ch)).lower().replace(" ", "_")


def _cell_text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def _ocr_normalize(value: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (value or "").upper())


def _ocr_candidates(text: str) -> list[str]:
    lines = [line.strip().upper() for line in text.splitlines() if line.strip()]
    prioritized = [line for line in lines if "PATRIMON" in line or "CODIGO" in line or "CÓDIGO" in line]
    pool = prioritized + lines
    found: list[str] = []
    for line in pool:
        for token in re.findall(r"[A-Z0-9][A-Z0-9._/-]{3,39}", line):
            cleaned = token.strip("._/-")
            compact = _ocr_normalize(cleaned)
            if 4 <= len(compact) <= 40 and compact not in {"PATRIMONIAL", "CODIGO", "MUNICIPALIDAD", "PROVINCIAL", "CASMA"}:
                if cleaned not in found:
                    found.append(cleaned)
    return found[:12]


def _prepare_ocr_image(raw: bytes) -> Image.Image:
    try:
        image = Image.open(io.BytesIO(raw))
        image.load()
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(status_code=422, detail="No se pudo leer la imagen.")

    if image.width < 40 or image.height < 40:
        raise HTTPException(status_code=422, detail="La imagen es demasiado pequeña para leer la etiqueta.")

    image = image.convert("RGB")
    max_side = 3200
    if max(image.size) > max_side:
        image.thumbnail((max_side, max_side))

    gray = ImageOps.grayscale(image)
    gray = ImageOps.autocontrast(gray)
    if max(gray.size) < 1800:
        gray = gray.resize((gray.width * 2, gray.height * 2))
    return gray


def _parse_excel_date(value, field: str) -> datetime | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time())
    text = _cell_text(value)
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            pass
    raise ValueError(f"{field}: use AAAA-MM-DD o DD/MM/AAAA.")


def _optional_float(value, field: str) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{field}: debe ser numérico.")


def _equipment_type(value) -> EquipmentType:
    key = _normal(value).upper()
    if key in _EQUIPMENT_TYPE_ALIASES:
        return _EQUIPMENT_TYPE_ALIASES[key]
    try:
        equipment_type = EquipmentType(key)
    except ValueError:
        equipment_type = None
    if equipment_type not in _SUPPORTED_EQUIPMENT_TYPES:
        allowed = ", ".join(t.value for t in sorted(_SUPPORTED_EQUIPMENT_TYPES, key=lambda item: item.value))
        raise ValueError(f"Tipo de equipo no válido para el Área TI. Valores permitidos: {allowed}.")
    return equipment_type


def _ensure_supported_type(equipment_type: EquipmentType) -> None:
    if equipment_type not in _SUPPORTED_EQUIPMENT_TYPES:
        allowed = ", ".join(t.value for t in sorted(_SUPPORTED_EQUIPMENT_TYPES, key=lambda item: item.value))
        raise HTTPException(status_code=422, detail=f"Tipo de equipo no permitido. Use: {allowed}.")


async def _next_inventory_id() -> str:
    seq = await next_sequence("equipment-ti")
    return f"TI-{seq:06d}"


def _equipment_status(value) -> EquipmentStatus:
    if value in (None, ""):
        return EquipmentStatus.OPERATIVO
    key = _normal(value).upper()
    if key in _STATUS_ALIASES:
        return _STATUS_ALIASES[key]
    try:
        return EquipmentStatus(key)
    except ValueError:
        raise ValueError("Estado no válido. Use OPERATIVO, EN_REPARACION o BAJA.")


async def _get(equipment_id: str) -> Equipment:
    eid = parse_id(equipment_id)
    eq = await Equipment.get(eid) if eid else None
    if not eq:
        raise HTTPException(status_code=404, detail="Equipo no encontrado.")
    if not eq.inventory_id:
        eq.inventory_id = await _next_inventory_id()
        await eq.save()
    return eq


async def _validate_office(office_id: str | None) -> Office:
    if not office_id:
        raise HTTPException(status_code=422, detail="Debe seleccionar una oficina.")
    oid = parse_id(office_id)
    office = await Office.get(oid) if oid else None
    if not office:
        raise HTTPException(status_code=422, detail="Oficina no válida.")
    return office


def _assignment_data(data: dict, office: Office) -> dict:
    result = dict(data)
    result["office_id"] = office.id
    result["area"] = (result.get("area") or office.name).strip()
    result["device_label"] = (result.get("device_label") or result.get("type").value).strip()
    result["property_type"] = (result.get("property_type") or "MUNICIPALIDAD PROVINCIAL DE CASMA").strip()

    responsible_type = str(result.get("responsible_type") or "USUARIO").upper().strip()
    responsible_name = (result.get("responsible_name") or "").strip()
    if responsible_type == "OFICINA":
        responsible_name = responsible_name or office.name
    elif responsible_type == "JEFE":
        responsible_name = responsible_name or office.head_name or office.name
    elif responsible_type == "USUARIO":
        if not responsible_name:
            raise HTTPException(status_code=422, detail="Debe indicar el nombre del usuario responsable.")
    else:
        raise HTTPException(status_code=422, detail="Tipo de responsable no válido.")

    result["responsible_type"] = responsible_type
    result["responsible_name"] = responsible_name
    return result


@router.get("", response_model=list[EquipmentOut])
async def list_equipment(
    office_id: str | None = None, type: EquipmentType | None = None, q: str | None = Query(None, max_length=60),
    _: StaffUser = Depends(require_staff),
):
    import re

    query: dict = {}
    if office_id and (oid := parse_id(office_id)):
        query["office_id"] = oid
    if type:
        query["type"] = type.value
    if q and q.strip():
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        query["$or"] = [
            {"inventory_id": rx},
            {"patrimonial_code": rx},
            {"mac_address": rx},
            {"ip_address": rx},
            {"responsible_name": rx},
            {"hostname": rx},
            {"device_label": rx},
            {"area": rx},
            {"brand": rx},
            {"model": rx},
        ]
    offices = {o.id: o for o in await Office.find_all().to_list()}
    items = await Equipment.find(query).sort("patrimonial_code").limit(1000).to_list()
    for equipment in items:
        if not equipment.inventory_id:
            equipment.inventory_id = await _next_inventory_id()
            await equipment.save()
    return [
        equipment_out(
            e,
            offices[e.office_id].name if e.office_id in offices else None,
            str(offices[e.office_id].zone_id) if e.office_id in offices and offices[e.office_id].zone_id else None,
            offices[e.office_id].zone_name if e.office_id in offices else None,
        )
        for e in items
    ]


@router.post("", response_model=EquipmentOut, status_code=201)
async def create_equipment(request: Request, body: EquipmentIn, user: StaffUser = Depends(require_staff)):
    _ensure_supported_type(body.type)
    office = await _validate_office(body.office_id)
    data = _assignment_data(body.model_dump(), office)
    data["inventory_id"] = await _next_inventory_id()
    eq = Equipment(**data)
    try:
        await eq.insert()
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Ya existe un equipo con ese código patrimonial.")
    await audit.record(request, "staff", "equipment.created", actor_id=str(user.id), actor_name=user.full_name, target_type="equipment", target_id=str(eq.id))
    return equipment_out(
        eq,
        office.name,
        str(office.zone_id) if office.zone_id else None,
        office.zone_name,
    )


@router.post("/ocr-patrimonial", response_model=EquipmentOcrOut)
async def ocr_patrimonial(
    file: UploadFile = File(...),
    _: StaffUser = Depends(require_staff),
):
    content_type = (file.content_type or "").lower()
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=422, detail="Debe enviar una imagen de la etiqueta patrimonial.")

    max_bytes = get_settings().max_upload_mb * 1024 * 1024
    raw = await file.read(max_bytes + 1)
    if len(raw) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"La imagen no puede superar {get_settings().max_upload_mb} MB.",
        )
    if not raw:
        raise HTTPException(status_code=422, detail="La imagen está vacía.")

    image = _prepare_ocr_image(raw)
    try:
        text = await __import__("asyncio").to_thread(
            pytesseract.image_to_string,
            image,
            lang="spa+eng",
            config="--psm 6",
        )
    except pytesseract.pytesseract.TesseractNotFoundError:
        raise HTTPException(status_code=503, detail="El motor OCR no está disponible en el servidor.")
    except pytesseract.TesseractError:
        raise HTTPException(status_code=422, detail="No se pudo reconocer texto en la etiqueta.")

    text = (text or "").strip()
    candidates = _ocr_candidates(text)
    compact_text = _ocr_normalize(text)

    equipment_docs = await Equipment.get_pymongo_collection().find(
        {},
        {"patrimonial_code": 1},
    ).to_list(None)

    matched_code = None
    matched_id = None
    for doc in equipment_docs:
        code = str(doc.get("patrimonial_code") or "").strip().upper()
        normalized = _ocr_normalize(code)
        if normalized and normalized in compact_text:
            matched_code = code
            matched_id = str(doc["_id"])
            break

    if not matched_code:
        candidate_norms = [(_ocr_normalize(candidate), candidate) for candidate in candidates]
        for doc in equipment_docs:
            code = str(doc.get("patrimonial_code") or "").strip().upper()
            normalized = _ocr_normalize(code)
            if normalized and any(normalized == norm for norm, _ in candidate_norms):
                matched_code = code
                matched_id = str(doc["_id"])
                break

    detected = matched_code or (candidates[0].upper() if candidates else None)
    return EquipmentOcrOut(
        detected_code=detected,
        matched=bool(matched_code),
        equipment_id=matched_id,
        candidates=[candidate.upper() for candidate in candidates],
        raw_text=text[:1200],
    )


@router.get("/import-references", response_model=list[EquipmentImportOfficeRef])
async def import_references(_: StaffUser = Depends(require_admin)):
    offices = await Office.find({"active": True}).sort("name").to_list()
    return [
        EquipmentImportOfficeRef(
            office_code=o.code,
            office_name=o.name,
            zone_id=str(o.zone_id) if o.zone_id else None,
            zone_name=o.zone_name,
            head_name=o.head_name,
            import_enabled=bool(o.zone_id or o.zone_name),
        )
        for o in offices
    ]


@router.post("/import-xlsx", response_model=EquipmentImportResult)
async def import_equipment_xlsx(
    request: Request,
    file: UploadFile = File(...),
    admin: StaffUser = Depends(require_admin),
):
    filename = (file.filename or "").lower()
    if not filename.endswith(".xlsx"):
        raise HTTPException(status_code=422, detail="El archivo debe tener extensión .xlsx.")

    raw = await file.read(10 * 1024 * 1024 + 1)
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="El archivo Excel no puede superar 10 MB.")
    if not raw:
        raise HTTPException(status_code=422, detail="El archivo Excel está vacío.")

    try:
        workbook = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    except (InvalidFileException, BadZipFile, OSError, ValueError):
        raise HTTPException(status_code=422, detail="No se pudo leer el archivo .xlsx.")

    sheet = workbook.active
    rows = sheet.iter_rows(values_only=True)
    first = next(rows, None)
    if not first:
        workbook.close()
        raise HTTPException(status_code=422, detail="El archivo no contiene filas.")

    headers: dict[str, int] = {}
    for index, value in enumerate(first):
        normalized = _normal(value)
        canonical = _HEADER_ALIASES.get(normalized)
        if canonical and canonical not in headers:
            headers[canonical] = index

    required = {"oficina", "codigo_patrimonial", "tipo"}
    missing = sorted(required - set(headers))
    if missing or ("zona_id" not in headers and "zona" not in headers):
        workbook.close()
        missing_text = ", ".join(missing) if missing else ""
        zone_text = "zona o zona_id" if "zona_id" not in headers and "zona" not in headers else ""
        detail = ", ".join(x for x in (missing_text, zone_text) if x)
        raise HTTPException(status_code=422, detail="Faltan columnas obligatorias: " + detail + ".")

    offices = await Office.find({"active": True}).to_list()
    by_code = {_normal(o.code): o for o in offices}
    by_name: dict[str, list[Office]] = {}
    for office in offices:
        by_name.setdefault(_normal(office.name), []).append(office)

    existing_codes = {
        str(doc.get("patrimonial_code", "")).upper()
        for doc in await Equipment.get_pymongo_collection().find(
            {}, {"patrimonial_code": 1}
        ).to_list(None)
    }
    seen_codes: set[str] = set()
    processed = imported = rejected = 0
    all_errors: list[EquipmentImportError] = []

    def value_at(row, key: str):
        idx = headers.get(key)
        return row[idx] if idx is not None and idx < len(row) else None

    try:
        for row_number, row in enumerate(rows, start=2):
            if row_number > 5001:
                all_errors.append(
                    EquipmentImportError(row=row_number, message="Se alcanzó el máximo de 5000 filas por importación.")
                )
                break
            if not any(value not in (None, "") for value in row):
                continue

            processed += 1
            code = _cell_text(value_at(row, "codigo_patrimonial")).upper()
            try:
                if len(code) < 3 or len(code) > 40:
                    raise ValueError("Código patrimonial: debe tener entre 3 y 40 caracteres.")
                if code in seen_codes:
                    raise ValueError("Código patrimonial duplicado dentro del Excel.")
                seen_codes.add(code)
                if code in existing_codes:
                    raise ValueError("El código patrimonial ya existe en el inventario.")

                zone_id_text = _cell_text(value_at(row, "zona_id"))
                zone_name_text = _cell_text(value_at(row, "zona"))
                zone_id = parse_id(zone_id_text) if zone_id_text else None

                office_text = _cell_text(value_at(row, "oficina"))
                office = by_code.get(_normal(office_text))
                if not office:
                    matches = by_name.get(_normal(office_text), [])
                    if len(matches) == 1:
                        office = matches[0]
                    elif len(matches) > 1:
                        raise ValueError("El nombre de oficina es ambiguo; use su código.")
                if not office:
                    raise ValueError("La oficina indicada no existe o está inactiva.")
                if zone_id:
                    if not office.zone_id or office.zone_id != zone_id:
                        raise ValueError("La oficina no pertenece al zona_id indicado en el Excel.")
                elif zone_name_text:
                    if not office.zone_name or _normal(office.zone_name) != _normal(zone_name_text):
                        raise ValueError("La oficina no pertenece a la zona indicada en el Excel.")
                else:
                    raise ValueError("Debe indicar zona o zona_id.")

                ip_value = _cell_text(value_at(row, "ip")) or None
                if ip_value:
                    ipaddress.ip_address(ip_value)

                criticality_raw = value_at(row, "criticidad")
                criticality = 1 if criticality_raw in (None, "") else int(float(criticality_raw))
                if criticality not in (1, 2, 3):
                    raise ValueError("Criticidad: use 1, 2 o 3.")

                responsible_type = (_cell_text(value_at(row, "responsable_tipo")) or "OFICINA").upper()
                responsible_name = _cell_text(value_at(row, "responsable"))
                if responsible_type == "OFICINA":
                    responsible_name = responsible_name or office.name
                elif responsible_type == "JEFE":
                    responsible_name = responsible_name or office.head_name or office.name
                elif responsible_type == "USUARIO":
                    if not responsible_name:
                        raise ValueError("Responsable: indique el nombre del usuario.")
                else:
                    raise ValueError("responsable_tipo debe ser USUARIO, JEFE u OFICINA.")

                equipment = Equipment(
                    inventory_id=await _next_inventory_id(),
                    patrimonial_code=code,
                    codigo_patrimonial=code,
                    type=_equipment_type(value_at(row, "tipo")),
                    area=_cell_text(value_at(row, "area")) or office.name,
                    device_label=_cell_text(value_at(row, "dispositivo")) or _cell_text(value_at(row, "tipo")),
                    brand=_cell_text(value_at(row, "marca")) or None,
                    model=_cell_text(value_at(row, "modelo")) or None,
                    hostname=_cell_text(value_at(row, "nombre_equipo")) or _cell_text(value_at(row, "hostname")) or None,
                    ip_address=ip_value,
                    mac_address=_cell_text(value_at(row, "mac")) or None,
                    office_id=office.id,
                    responsible_name=responsible_name,
                    responsible_type=responsible_type,
                    property_type=_cell_text(value_at(row, "propiedad")) or "MUNICIPALIDAD PROVINCIAL DE CASMA",
                    specs={
                        "cpu": _cell_text(value_at(row, "cpu")) or None,
                        "ram_gb": _optional_float(value_at(row, "ram_gb"), "RAM"),
                        "storage_gb": _optional_float(value_at(row, "almacenamiento_gb"), "Almacenamiento"),
                        "screen_size_inches": _optional_float(value_at(row, "tamano_pantalla"), "Tamaño de pantalla"),
                        "os": _cell_text(value_at(row, "sistema_operativo")) or None,
                    },
                    acquired_on=_parse_excel_date(value_at(row, "fecha_adquisicion"), "Fecha de adquisición"),
                    warranty_until=_parse_excel_date(value_at(row, "garantia_hasta"), "Garantía"),
                    status=_equipment_status(value_at(row, "estado")),
                    criticality=criticality,
                    notes=_cell_text(value_at(row, "notas")) or None,
                )
                await equipment.insert()
                existing_codes.add(code)
                imported += 1
            except (ValueError, ValidationError, DuplicateKeyError) as exc:
                rejected += 1
                if isinstance(exc, ValidationError):
                    message = "; ".join(error["msg"].replace("Value error, ", "") for error in exc.errors())
                elif isinstance(exc, DuplicateKeyError):
                    message = "El código patrimonial ya existe en el inventario."
                else:
                    message = str(exc)
                all_errors.append(
                    EquipmentImportError(
                        row=row_number,
                        patrimonial_code=code or None,
                        message=message,
                    )
                )
    finally:
        workbook.close()

    await audit.record(
        request,
        "staff",
        "equipment.imported_xlsx",
        actor_id=str(admin.id),
        actor_name=admin.full_name,
        target_type="equipment",
        target_id="bulk",
        processed=processed,
        imported=imported,
        rejected=rejected,
        filename=(file.filename or "")[:120],
    )

    visible_errors = all_errors[:200]
    return EquipmentImportResult(
        processed=processed,
        imported=imported,
        rejected=rejected,
        errors=visible_errors,
        more_errors=max(0, len(all_errors) - len(visible_errors)),
    )


@router.get("/{equipment_id}", response_model=EquipmentDetailOut)
async def equipment_detail(equipment_id: str, _: StaffUser = Depends(require_staff)):
    eq = await _get(equipment_id)
    engine = get_engine()
    await engine.ensure_ready()
    history = await load_ticket_rows(utcnow().replace(year=utcnow().year - 2), {"equipment_id": eq.id})
    risk, factors = engine.state["risk"].score(equipment_row(eq), history, engine.state["model_rates"], utcnow())
    tickets = await Ticket.find({"equipment_id": eq.id, "deleted_at": None}).sort(-Ticket.created_at).limit(50).to_list()
    office = await Office.get(eq.office_id) if eq.office_id else None
    return EquipmentDetailOut(
        equipment=equipment_out(
            eq,
            office.name if office else None,
            str(office.zone_id) if office and office.zone_id else None,
            office.zone_name if office else None,
        ),
        risk=risk,
        risk_factors=factors,
        tickets=[ticket_out(t) for t in tickets],
    )


@router.put("/{equipment_id}", response_model=EquipmentOut)
async def update_equipment(request: Request, equipment_id: str, body: EquipmentIn, user: StaffUser = Depends(require_staff)):
    _ensure_supported_type(body.type)
    eq = await _get(equipment_id)
    office = await _validate_office(body.office_id)
    data = _assignment_data(body.model_dump(), office)
    for key, value in data.items():
        setattr(eq, key, value)
    eq.updated_at = utcnow()
    try:
        await eq.save()
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Ya existe un equipo con ese código patrimonial.")
    await audit.record(request, "staff", "equipment.updated", actor_id=str(user.id), actor_name=user.full_name, target_type="equipment", target_id=str(eq.id))
    return equipment_out(
        eq,
        office.name,
        str(office.zone_id) if office.zone_id else None,
        office.zone_name,
    )


@router.delete("/{equipment_id}", response_model=Message)
async def delete_equipment(request: Request, equipment_id: str, admin: StaffUser = Depends(require_admin)):
    eq = await _get(equipment_id)
    if await Ticket.find({"equipment_id": eq.id}).count():
        raise HTTPException(status_code=409, detail="El equipo tiene historial de incidencias. Márquelo como BAJA en lugar de eliminarlo.")
    await Device.get_pymongo_collection().update_many({"equipment_id": eq.id}, {"$set": {"equipment_id": None}})
    await eq.delete()
    await audit.record(request, "staff", "equipment.deleted", actor_id=str(admin.id), actor_name=admin.full_name, target_type="equipment", target_id=str(eq.id))
    return Message(message="Equipo eliminado.")


@router.get("/{equipment_id}/qr")
async def equipment_qr(equipment_id: str, _: StaffUser = Depends(require_staff)):
    eq = await _get(equipment_id)
    url = f"{get_settings().public_base_url.rstrip('/')}/reportar?equipo={eq.patrimonial_code}"
    buffer = io.BytesIO()
    qrcode.make(url, box_size=10, border=2).save(buffer, format="PNG")
    return Response(buffer.getvalue(), media_type="image/png", headers={"Content-Disposition": f'inline; filename="QR-{eq.patrimonial_code}.png"'})
