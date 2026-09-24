export type TicketStatus = "PENDIENTE" | "EN_PROCESO" | "RESUELTO";
export type ResolutionType = "SOLUCIONADO" | "REPARADO" | "REEMPLAZADO" | "OBSOLETO" | "IRREPARABLE" | "BAJA_PATRIMONIAL" | "DERIVADO";
export type TicketPriority = "BAJA" | "MEDIA" | "ALTA";
export type TicketCategory =
  | "HARDWARE" | "RED_INTERNET" | "IMPRESORA" | "SOFTWARE" | "SISTEMAS_MUNICIPALES"
  | "CUENTAS_CORREO" | "SEGURIDAD" | "PERIFERICOS" | "OTRO";
export type QuickIssue = "NO_ENCIENDE" | "SIN_INTERNET" | "IMPRESORA" | "LENTA" | "SISTEMA" | "OTRO";
export type DeviceStatus = "PENDIENTE" | "APROBADO" | "RECHAZADO" | "REVOCADO";
export type DeviceKind = "PC" | "LAPTOP" | "CELULAR" | "TABLET" | "OTRO";
export type StaffRole = "ADMIN" | "TECNICO";
export type EquipmentType =
  | "CPU" | "MONITOR" | "MOUSE" | "TECLADO" | "IMPRESORA" | "LAPTOP"
  | "PC" | "ESCANER" | "SWITCH_ROUTER" | "SERVIDOR" | "TELEFONO_IP" | "OTRO";
export type EquipmentStatus = "OPERATIVO" | "EN_REPARACION" | "BAJA";

export interface Me {
  kind: "staff" | "office";
  staff: { id: string; username: string; full_name: string; role: StaffRole; specialties: TicketCategory[]; must_change_password: boolean } | null;
  office: { id: string; name: string; location: string | null; head_name: string | null; device_id: string; device_status: DeviceStatus; pair_code: string | null; equipment_id: string | null } | null;
}

export interface Attachment { id: string; url: string; width: number; height: number }
export interface TimelineEntry { at: string; kind: string; actor: string; text: string; internal: boolean }
export interface SimilarCase { ticket_id: string; number: string; subject: string; score: number; resolution: string | null }

export interface AIAnalysis {
  category: TicketCategory;
  category_confidence: number;
  priority: TicketPriority;
  priority_score: number;
  priority_reasons: string[];
  suggested_technician_id: string | null;
  suggested_technician_name: string | null;
  technician_reasons: string[];
  similar_cases: SimilarCase[];
  equipment_risk: number | null;
  equipment_risk_factors: string[];
  equipment_incidents_90d: number;
  related_alert: string | null;
  briefing: string;
  user_message: string;
  user_tips: string[];
  model_version: string;
}

export interface EquipmentSnapshot {
  id: string; patrimonial_code: string; type: EquipmentType; brand: string | null; model: string | null; ip_address: string | null; hostname: string | null;
}

export interface Ticket {
  id: string; number: string; office_id: string; office_name: string; office_location: string | null;
  equipment: EquipmentSnapshot | null; channel: string; quick_issue: QuickIssue | null; subject: string; description: string;
  reporter_name: string | null; contact_phone: string | null; category: TicketCategory; category_source: string;
  priority: TicketPriority; status: TicketStatus; assigned_to_id: string | null; assigned_to_name: string | null;
  attachments: Attachment[]; ai: AIAnalysis | null;
  resolution: { notes: string; resolved_by_name: string; tipo_resolucion: ResolutionType; resolved_at: string; confirmed_by_user: boolean | null } | null;
  timeline: TimelineEntry[]; first_response_at: string | null; created_at: string; updated_at: string;
}

export interface OfficeTicket {
  id: string; number: string; subject: string; description: string; status: TicketStatus; priority: TicketPriority;
  equipment_code: string | null; assigned_to_name: string | null; attachments: Attachment[]; user_message: string;
  user_tips: string[]; resolution_notes: string | null; confirmed_by_user: boolean | null;
  timeline: { at: string; actor: string; text: string }[]; created_at: string; updated_at: string;
}

export interface EquipmentBrief { id: string; patrimonial_code: string; type: EquipmentType; name: string; hostname: string | null }

export interface OfficeHome {
  office_name: string; location: string | null; device_label: string | null; this_equipment: EquipmentBrief | null;
  equipment: EquipmentBrief[]; quick_issues: { key: QuickIssue; label: string }[]; open_tickets: OfficeTicket[];
  alerts: { title: string; message: string }[];
}

export interface Page<T> { items: T[]; total: number; page: number; page_size: number }

export interface Kpis {
  total: number; pendientes: number; en_proceso: number; resueltos: number; urgentes_abiertos: number;
  nuevos_hoy: number; sin_asignar: number; horas_primera_respuesta_30d: number | null;
}

export interface StaffMember {
  id: string; username: string; full_name: string; email: string | null; phone: string | null; role: StaffRole;
  specialties: TicketCategory[]; active: boolean; totp_enabled: boolean; locked: boolean; last_login_at: string | null; open_tickets: number;
}

export interface Office {
  id: string; code: string; name: string; username: string; zone_id: string | null; zone_name: string | null;
  location: string | null; head_name: string | null; head_phone: string | null; priority_weight: number;
  active: boolean; devices_approved: number; devices_pending: number; created_at: string;
}

export interface Zone {
  id: string; code: string; name: string; description: string | null; active: boolean;
  office_count: number; user_count: number; equipment_count: number; created_at: string; updated_at: string;
}

export interface MunicipalUser {
  id: string; employee_code: string | null; full_name: string; office_id: string; office_name: string;
  zone_id: string | null; zone_name: string | null; job_title: string | null; email: string | null; phone: string | null;
  photo_url: string | null; active: boolean; equipment_count: number; created_at: string; updated_at: string;
}

export interface Device {
  id: string; office_id: string; office_name: string; status: DeviceStatus; pair_code: string; kind: DeviceKind; label: string | null;
  user_agent: string | null; first_ip: string | null; last_ip: string | null; equipment_id: string | null; equipment_code: string | null;
  last_seen_at: string; created_at: string;
}

export interface Equipment {
  id: string; inventory_id: string | null; patrimonial_code: string; type: EquipmentType;
  area: string | null; device_label: string | null; brand: string | null; model: string | null;
  hostname: string | null; ip_address: string | null; mac_address: string | null;
  office_id: string | null; office_name: string | null; zone_id: string | null; zone_name: string | null;
  responsable_id: string | null; responsible_name: string | null; responsible_type: "USUARIO" | "JEFE" | "OFICINA"; property_type: string | null;
  specs: { cpu: string | null; ram_gb: number | null; storage_gb: number | null; screen_size_inches: number | null; os: string | null };
  acquired_on: string | null; warranty_until: string | null; status: EquipmentStatus; criticality: number; notes: string | null;
  created_at: string; updated_at: string;
}

export interface EquipmentImportError {
  row: number;
  patrimonial_code: string | null;
  message: string;
}

export interface EquipmentImportResult {
  processed: number;
  imported: number;
  rejected: number;
  errors: EquipmentImportError[];
  more_errors: number;
}

export interface EquipmentImportOfficeRef {
  office_code: string;
  office_name: string;
  zone_id: string | null;
  zone_name: string | null;
  head_name: string | null;
  import_enabled: boolean;
}

export interface Insights {
  equipment_risk: { equipment_id: string; patrimonial_code: string; type: string; name: string; office: string; risk: number; factors: string[]; incidents_90d: number }[];
  category_trend: { category: TicketCategory; label: string; last_30d: number; previous_30d: number }[];
  offices_30d: { office: string; count: number }[];
  live_bursts: { category: TicketCategory; location: string | null; count: number; expected: number }[];
  active_alerts: { id: string; title: string; message: string; until: string }[];
  model: { version: string; trained_at: string; backend: string; samples: Record<string, number>; metrics: Record<string, Record<string, unknown>> } | null;
}
