import type { DeviceKind, EquipmentStatus, EquipmentType, TicketCategory, TicketPriority, TicketStatus } from "./types";

export const STATUS_LABEL: Record<TicketStatus, string> = { PENDIENTE: "Pendiente", EN_PROCESO: "En atención", RESUELTO: "Resuelto" };
export const PRIORITY_LABEL: Record<TicketPriority, string> = { BAJA: "Baja", MEDIA: "Media", ALTA: "Urgente" };
export const CATEGORY_LABEL: Record<TicketCategory, string> = {
  HARDWARE: "Hardware", RED_INTERNET: "Red e internet", IMPRESORA: "Impresoras", SOFTWARE: "Software",
  SISTEMAS_MUNICIPALES: "Sistemas municipales", CUENTAS_CORREO: "Cuentas y correo", SEGURIDAD: "Seguridad",
  PERIFERICOS: "Periféricos", OTRO: "Otro",
};
export const EQUIPMENT_LABEL: Record<EquipmentType, string> = {
  PC: "Computadora", LAPTOP: "Laptop", IMPRESORA: "Impresora", MONITOR: "Monitor", ESCANER: "Escáner",
  SWITCH_ROUTER: "Switch / router", SERVIDOR: "Servidor", TELEFONO_IP: "Teléfono IP", OTRO: "Otro",
};
export const EQUIPMENT_STATUS_LABEL: Record<EquipmentStatus, string> = { OPERATIVO: "Operativo", EN_REPARACION: "En reparación", BAJA: "De baja" };
export const DEVICE_KIND_LABEL: Record<DeviceKind, string> = { PC: "Computadora", LAPTOP: "Laptop", CELULAR: "Celular", TABLET: "Tablet", OTRO: "Otro" };

export const CATEGORIES = Object.keys(CATEGORY_LABEL) as TicketCategory[];
export const EQUIPMENT_TYPES = Object.keys(EQUIPMENT_LABEL) as EquipmentType[];

const dateTime = new Intl.DateTimeFormat("es-PE", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Lima" });
const date = new Intl.DateTimeFormat("es-PE", { dateStyle: "medium", timeZone: "America/Lima" });
const relative = new Intl.RelativeTimeFormat("es", { numeric: "auto" });

export const fmtDateTime = (iso: string) => dateTime.format(new Date(iso));
export const fmtDate = (iso: string) => date.format(new Date(iso));

export function fmtAgo(iso: string): string {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return "hace un momento";
  if (abs < 3600) return relative.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return relative.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 7) return relative.format(Math.round(diff / 86400), "day");
  return fmtDate(iso);
}

export const pct = (v: number) => `${Math.round(v * 100)}%`;
