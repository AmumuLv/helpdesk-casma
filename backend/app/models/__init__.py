from app.models.device import Device
from app.models.equipment import Equipment
from app.models.office import Office
from app.models.zone import Zone
from app.models.municipal_user import MunicipalUser
from app.models.staff import StaffUser
from app.models.system import AIModelRecord, Announcement, AuditLog, SystemSetting
from app.models.ticket import Ticket

DOCUMENT_MODELS = [Zone, Office, MunicipalUser, StaffUser, Device, Equipment, Ticket, SystemSetting, AuditLog, Announcement, AIModelRecord]

__all__ = ["Zone", "Office", "MunicipalUser", "StaffUser", "Device", "Equipment", "Ticket", "SystemSetting", "AuditLog", "Announcement", "AIModelRecord", "DOCUMENT_MODELS"]
