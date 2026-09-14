from dataclasses import dataclass, field

from app.models.enums import QuickIssue, TicketCategory


@dataclass(frozen=True)
class QuickIssueInfo:
    label: str
    category: TicketCategory
    subject: str
    tips: list[str] = field(default_factory=list)


QUICK_ISSUES: dict[QuickIssue, QuickIssueInfo] = {
    QuickIssue.NO_ENCIENDE: QuickIssueInfo(
        "La computadora no prende",
        TicketCategory.HARDWARE,
        "Equipo no enciende",
        [
            "Revise que el cable de corriente esté bien conectado a la pared y a la computadora.",
            "Si tiene estabilizador, verifique que su luz esté encendida.",
        ],
    ),
    QuickIssue.SIN_INTERNET: QuickIssueInfo(
        "No hay internet",
        TicketCategory.RED_INTERNET,
        "Sin conexión a internet o red",
        [
            "Revise que el cable de red esté conectado detrás de la computadora.",
            "Pregunte a un compañero si a él también le falla.",
        ],
    ),
    QuickIssue.IMPRESORA: QuickIssueInfo(
        "La impresora no funciona",
        TicketCategory.IMPRESORA,
        "Falla de impresora",
        [
            "Verifique que la impresora esté encendida y tenga papel.",
            "Si hay una hoja atascada, no la jale con fuerza. Espere al técnico.",
        ],
    ),
    QuickIssue.LENTA: QuickIssueInfo(
        "La computadora está lenta o se congela",
        TicketCategory.SOFTWARE,
        "Equipo lento o congelado",
        ["Guarde su trabajo y reinicie la computadora una sola vez."],
    ),
    QuickIssue.SISTEMA: QuickIssueInfo(
        "No puedo entrar a un sistema o al correo",
        TicketCategory.SISTEMAS_MUNICIPALES,
        "Problema de acceso a sistema o correo",
        ["Revise que la tecla Bloq Mayús no esté activada al escribir su clave."],
    ),
    QuickIssue.OTRO: QuickIssueInfo("Otro problema", TicketCategory.OTRO, "Solicitud de soporte", []),
}

CATEGORY_LABELS: dict[TicketCategory, str] = {
    TicketCategory.HARDWARE: "Hardware",
    TicketCategory.RED_INTERNET: "Red e internet",
    TicketCategory.IMPRESORA: "Impresoras",
    TicketCategory.SOFTWARE: "Software",
    TicketCategory.SISTEMAS_MUNICIPALES: "Sistemas municipales",
    TicketCategory.CUENTAS_CORREO: "Cuentas y correo",
    TicketCategory.SEGURIDAD: "Seguridad",
    TicketCategory.PERIFERICOS: "Periféricos",
    TicketCategory.OTRO: "Otro",
}

CATEGORY_BASE_PRIORITY: dict[TicketCategory, float] = {
    TicketCategory.HARDWARE: 0.55,
    TicketCategory.RED_INTERNET: 0.55,
    TicketCategory.IMPRESORA: 0.35,
    TicketCategory.SOFTWARE: 0.35,
    TicketCategory.SISTEMAS_MUNICIPALES: 0.55,
    TicketCategory.CUENTAS_CORREO: 0.4,
    TicketCategory.SEGURIDAD: 0.75,
    TicketCategory.PERIFERICOS: 0.25,
    TicketCategory.OTRO: 0.25,
}

URGENT_TERMS = [
    "humo", "chispa", "quemado", "corto circuito", "toda la oficina", "todos", "nadie", "ninguna",
    "caja", "cobrar", "cobro", "tesoreria", "siaf", "planilla", "urgente", "publico", "mesa de partes",
    "no puedo trabajar", "rescate", "encriptados", "hackeo", "servidor", "vencimiento", "plazo",
]

LOW_TERMS = ["cuando pueda", "no es urgente", "consulta", "fondo de pantalla", "sin apuro", "cuando tengan tiempo"]
