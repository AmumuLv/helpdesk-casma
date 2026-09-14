from app.models.device import Device
from app.models.equipment import Equipment
from app.models.office import Office
from app.models.staff import StaffUser
from app.models.system import AIModelRecord, Announcement, AuditLog, SystemSetting
from app.models.ticket import Ticket

DOCUMENT_MODELS = [Office, StaffUser, Device, Equipment, Ticket, SystemSetting, AuditLog, Announcement, AIModelRecord]

__all__ = ["Office", "StaffUser", "Device", "Equipment", "Ticket", "SystemSetting", "AuditLog", "Announcement", "AIModelRecord", "DOCUMENT_MODELS"]
