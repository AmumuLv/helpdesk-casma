from dataclasses import dataclass
from difflib import SequenceMatcher
import re
import unicodedata

from app.models.enums import EquipmentType


@dataclass(frozen=True)
class NormalizationChange:
    field: str
    original: str
    normalized: str
    method: str


@dataclass(frozen=True)
class InventoryNormalization:
    equipment_type: EquipmentType
    brand: str | None
    device_label: str
    changes: list[NormalizationChange]


_TYPE_TERMS: dict[EquipmentType, tuple[str, ...]] = {
    EquipmentType.CPU: (
        "cpu", "pc", "computadora", "computador", "desktop", "torre",
        "unidad central", "case", "computer",
    ),
    EquipmentType.LAPTOP: (
        "laptop", "notebook", "portatil", "portable", "ultrabook",
    ),
    EquipmentType.IMPRESORA: (
        "impresora", "printer", "print", "multifuncional", "multifunction",
    ),
    EquipmentType.MONITOR: (
        "monitor", "display", "pantalla",
    ),
    EquipmentType.MOUSE: (
        "mouse", "raton",
    ),
    EquipmentType.TECLADO: (
        "teclado", "keyboard",
    ),
}

_TYPE_LABEL = {
    EquipmentType.CPU: "CPU",
    EquipmentType.LAPTOP: "Laptop",
    EquipmentType.IMPRESORA: "Impresora",
    EquipmentType.MONITOR: "Monitor",
    EquipmentType.MOUSE: "Mouse",
    EquipmentType.TECLADO: "Teclado",
}

_BRAND_ALIASES: dict[str, tuple[str, ...]] = {
    "HP": ("hp", "hewlett packard", "hewlett-packard", "hewlettpackard"),
    "Lenovo": ("lenovo",),
    "Dell": ("dell",),
    "Epson": ("epson",),
    "Canon": ("canon",),
    "Brother": ("brother",),
    "Logitech": ("logitech",),
    "Microsoft": ("microsoft",),
    "Acer": ("acer",),
    "ASUS": ("asus",),
    "Samsung": ("samsung",),
    "LG": ("lg",),
    "Xerox": ("xerox",),
}


def _fold(value: str | None) -> str:
    text = unicodedata.normalize("NFKD", str(value or "").strip())
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[^a-zA-Z0-9]+", " ", text).lower()
    return " ".join(text.split())


def _detect_type(raw_type: str | None, device: str | None, brand: str | None, model: str | None) -> tuple[EquipmentType, str]:
    raw = _fold(raw_type)
    combined = _fold(" ".join(x for x in (str(raw_type or ""), str(device or ""), str(brand or ""), str(model or "")) if x))

    # Exactos y alias explícitos primero.
    for equipment_type, terms in _TYPE_TERMS.items():
        if raw == equipment_type.value.lower() or raw in terms:
            return equipment_type, "alias"

    # Después, términos presentes en el conjunto de campos de la fila.
    scored: list[tuple[int, EquipmentType]] = []
    for equipment_type, terms in _TYPE_TERMS.items():
        score = sum(2 if combined == term else 1 for term in terms if re.search(rf"\b{re.escape(term)}\b", combined))
        if score:
            scored.append((score, equipment_type))
    if scored:
        scored.sort(key=lambda item: item[0], reverse=True)
        return scored[0][1], "contexto"

    # Último recurso: similitud contra nombres conocidos. Umbral alto para evitar falsos positivos.
    candidates: list[tuple[float, EquipmentType]] = []
    for equipment_type, terms in _TYPE_TERMS.items():
        for term in (equipment_type.value.lower(), *terms):
            candidates.append((SequenceMatcher(None, raw, term).ratio(), equipment_type))
    best_score, best_type = max(candidates, key=lambda item: item[0])
    if best_score >= 0.82:
        return best_type, "similitud"

    allowed = ", ".join(item.value for item in _TYPE_LABEL)
    raise ValueError(f"Tipo de equipo no reconocido. Valores permitidos: {allowed}.")


def _normalize_brand(raw_brand: str | None, context: str) -> tuple[str | None, str | None]:
    raw = _fold(raw_brand)
    folded_context = _fold(context)

    # Si la marca está vacía, solo inferimos una marca cuando aparece inequívocamente en el contexto.
    if not raw:
        hits = [
            canonical
            for canonical, aliases in _BRAND_ALIASES.items()
            if any(re.search(rf"\b{re.escape(_fold(alias))}\b", folded_context) for alias in aliases)
        ]
        if len(set(hits)) == 1:
            return hits[0], "contexto"
        return None, None

    for canonical, aliases in _BRAND_ALIASES.items():
        alias_values = {_fold(canonical), *(_fold(alias) for alias in aliases)}
        if raw in alias_values:
            return canonical, "alias"
        if any(re.search(rf"\b{re.escape(alias)}\b", raw) for alias in alias_values if alias):
            return canonical, "contexto"

    candidates: list[tuple[float, str]] = []
    for canonical, aliases in _BRAND_ALIASES.items():
        for alias in (canonical, *aliases):
            candidates.append((SequenceMatcher(None, raw, _fold(alias)).ratio(), canonical))
    score, canonical = max(candidates, key=lambda item: item[0])
    if score >= 0.88:
        return canonical, "similitud"

    # Marca desconocida: se conserva, no se inventa una nueva.
    cleaned = " ".join(str(raw_brand or "").split())
    return cleaned or None, None


def normalize_inventory_fields(
    raw_type: str | None,
    device: str | None,
    brand: str | None,
    model: str | None,
) -> InventoryNormalization:
    equipment_type, type_method = _detect_type(raw_type, device, brand, model)
    changes: list[NormalizationChange] = []

    original_type = " ".join(str(raw_type or "").split())
    canonical_type = equipment_type.value
    if _fold(original_type) != _fold(canonical_type):
        changes.append(
            NormalizationChange(
                field="tipo",
                original=original_type,
                normalized=canonical_type,
                method=type_method,
            )
        )

    context = " ".join(x for x in (str(raw_type or ""), str(device or ""), str(brand or ""), str(model or "")) if x)
    normalized_brand, brand_method = _normalize_brand(brand, context)
    original_brand = " ".join(str(brand or "").split())
    if normalized_brand and _fold(original_brand) != _fold(normalized_brand):
        changes.append(
            NormalizationChange(
                field="marca",
                original=original_brand or "(vacío)",
                normalized=normalized_brand,
                method=brand_method or "normalización",
            )
        )

    original_device = " ".join(str(device or "").split())
    # Solo reemplaza etiquetas genéricas o que mezclan tipo/marca. Descripciones específicas se conservan.
    generic_tokens = {
        "", "equipo", "dispositivo", "pc", "computadora", "computador", "desktop",
        "printer", "print", "impresora", "monitor", "mouse", "raton", "teclado",
        "keyboard", "laptop", "notebook", "portatil",
    }
    folded_device = _fold(original_device)
    device_label = original_device
    if folded_device in generic_tokens or any(
        folded_device == _fold(alias)
        for aliases in _BRAND_ALIASES.values()
        for alias in aliases
    ):
        device_label = _TYPE_LABEL[equipment_type]

    if not device_label:
        device_label = _TYPE_LABEL[equipment_type]

    if _fold(original_device) != _fold(device_label):
        changes.append(
            NormalizationChange(
                field="dispositivo",
                original=original_device or "(vacío)",
                normalized=device_label,
                method="categoría canónica",
            )
        )

    return InventoryNormalization(
        equipment_type=equipment_type,
        brand=normalized_brand,
        device_label=device_label,
        changes=changes,
    )
