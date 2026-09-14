from enum import StrEnum


class StaffRole(StrEnum):
    ADMIN = "ADMIN"
    TECNICO = "TECNICO"


class DeviceStatus(StrEnum):
    PENDIENTE = "PENDIENTE"
    APROBADO = "APROBADO"
    RECHAZADO = "RECHAZADO"
    REVOCADO = "REVOCADO"


class DeviceKind(StrEnum):
    PC = "PC"
    LAPTOP = "LAPTOP"
    CELULAR = "CELULAR"
    TABLET = "TABLET"
    OTRO = "OTRO"


class EquipmentType(StrEnum):
    PC = "PC"
    LAPTOP = "LAPTOP"
    IMPRESORA = "IMPRESORA"
    MONITOR = "MONITOR"
    ESCANER = "ESCANER"
    SWITCH_ROUTER = "SWITCH_ROUTER"
    SERVIDOR = "SERVIDOR"
    TELEFONO_IP = "TELEFONO_IP"
    OTRO = "OTRO"


class EquipmentStatus(StrEnum):
    OPERATIVO = "OPERATIVO"
    EN_REPARACION = "EN_REPARACION"
    BAJA = "BAJA"


class TicketStatus(StrEnum):
    PENDIENTE = "PENDIENTE"
    EN_PROCESO = "EN_PROCESO"
    RESUELTO = "RESUELTO"


class TicketPriority(StrEnum):
    BAJA = "BAJA"
    MEDIA = "MEDIA"
    ALTA = "ALTA"


class TicketCategory(StrEnum):
    HARDWARE = "HARDWARE"
    RED_INTERNET = "RED_INTERNET"
    IMPRESORA = "IMPRESORA"
    SOFTWARE = "SOFTWARE"
    SISTEMAS_MUNICIPALES = "SISTEMAS_MUNICIPALES"
    CUENTAS_CORREO = "CUENTAS_CORREO"
    SEGURIDAD = "SEGURIDAD"
    PERIFERICOS = "PERIFERICOS"
    OTRO = "OTRO"


class QuickIssue(StrEnum):
    NO_ENCIENDE = "NO_ENCIENDE"
    SIN_INTERNET = "SIN_INTERNET"
    IMPRESORA = "IMPRESORA"
    LENTA = "LENTA"
    SISTEMA = "SISTEMA"
    OTRO = "OTRO"


class TicketChannel(StrEnum):
    WEB = "WEB"
    MOVIL = "MOVIL"
    TELEFONO = "TELEFONO"
    QR = "QR"


class TimelineKind(StrEnum):
    CREADO = "CREADO"
    ASIGNADO = "ASIGNADO"
    ESTADO = "ESTADO"
    PRIORIDAD = "PRIORIDAD"
    CATEGORIA = "CATEGORIA"
    NOTA = "NOTA"
    IA = "IA"
    CONFIRMACION = "CONFIRMACION"
    REPORTE_REPETIDO = "REPORTE_REPETIDO"
