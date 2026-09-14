from app.ai.taxonomy import CATEGORY_LABELS
from app.models.enums import TicketCategory, TicketPriority

_CATEGORY_USER = {
    TicketCategory.RED_INTERNET: "el internet",
    TicketCategory.HARDWARE: "las computadoras",
    TicketCategory.IMPRESORA: "las impresoras",
    TicketCategory.SISTEMAS_MUNICIPALES: "un sistema municipal",
    TicketCategory.CUENTAS_CORREO: "el correo",
    TicketCategory.SOFTWARE: "los programas",
    TicketCategory.SEGURIDAD: "la seguridad de los equipos",
    TicketCategory.PERIFERICOS: "los accesorios",
    TicketCategory.OTRO: "los equipos",
}


def alert_texts(category: str, location: str | None, count: int) -> tuple[str, str, str]:
    cat = TicketCategory(category)
    where = f"en {location}" if location else "en varias oficinas"
    title = f"Problema con {_CATEGORY_USER[cat]} {where}"
    user = f"Ya sabemos que hay un problema con {_CATEGORY_USER[cat]} {where}. Estamos trabajando para solucionarlo."
    staff = f"Posible falla masiva de {CATEGORY_LABELS[cat]} {where}: {count} reportes en las últimas 2 horas."
    return title, user, staff


def user_message(priority: TicketPriority, related_alert: str | None) -> str:
    base = {
        TicketPriority.ALTA: "Recibimos su reporte. Lo atenderemos lo antes posible.",
        TicketPriority.MEDIA: "Recibimos su reporte. Un técnico lo atenderá pronto.",
        TicketPriority.BAJA: "Recibimos su reporte. Un técnico lo atenderá durante el día.",
    }[priority]
    return f"{base} {related_alert}" if related_alert else base


def briefing(
    category: TicketCategory,
    confidence: float,
    equipment_desc: str | None,
    incidents_90d: int,
    risk: float | None,
    similar_resolution: str | None,
    alert: str | None,
) -> str:
    parts = [f"Clasificado como {CATEGORY_LABELS[category]} ({confidence:.0%} de confianza)."]
    if equipment_desc:
        parts.append(f"Equipo: {equipment_desc}.")
    if incidents_90d:
        parts.append(f"Registra {incidents_90d} incidencias en los últimos 90 días.")
    if risk is not None and risk >= 0.5:
        parts.append(f"Riesgo de nueva falla en 30 días: {risk:.0%}. Considere mantenimiento preventivo.")
    if similar_resolution:
        parts.append(f"Un caso parecido se resolvió así: {similar_resolution}")
    if alert:
        parts.append(alert)
    return " ".join(parts)
