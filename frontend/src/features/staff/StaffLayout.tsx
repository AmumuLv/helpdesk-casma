import { useQuery } from "@tanstack/react-query";
import {
  Bell, BrainCircuit, Building2, CheckCheck, ChevronsLeft, ChevronsRight, ClipboardList, Headset, KeyRound,
  LogOut, Menu, Monitor, MonitorSmartphone, Plus, Radar, ScrollText, Search, Settings, ShieldCheck, Trash2,
  UserRound, Users, X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useToast } from "../../components/Toasts";
import { Input, cx } from "../../components/ui";
import { api } from "../../lib/api";
import { useLiveEvents, useLogout, useMe, type LiveEvent } from "../../lib/session";
import type { Page, Ticket } from "../../lib/types";
import { useDevices } from "./hooks";

/* ------------------------------------------------------------- Navegación */

type NavItem = { to: string; label: string; icon: LucideIcon; admin?: boolean; end?: boolean; group: NavGroup };
type NavGroup = "Mesa de trabajo" | "Inventario" | "Administración";

const NAV: NavItem[] = [
  { to: "/soporte", label: "Incidencias", icon: ClipboardList, end: true, group: "Mesa de trabajo" },
  { to: "/soporte/equipos", label: "Equipos", icon: Monitor, group: "Inventario" },
  { to: "/soporte/ia", label: "Análisis IA", icon: BrainCircuit, group: "Mesa de trabajo" },
  { to: "/soporte/espacios", label: "Espacios", icon: Building2, group: "Inventario" },
  { to: "/soporte/dispositivos", label: "Dispositivos", icon: MonitorSmartphone, admin: true, group: "Administración" },
  { to: "/soporte/personal", label: "Personal TI", icon: Users, admin: true, group: "Administración" },
  { to: "/soporte/auditoria", label: "Auditoría", icon: ScrollText, admin: true, group: "Administración" },
];

const GROUPS: NavGroup[] = ["Mesa de trabajo", "Inventario", "Administración"];

/* Preferencia de la barra lateral recordada entre sesiones. */
const COLLAPSE_KEY = "helpdesk_sidebar_collapsed";

/* -------------------------------------------------------- Notificaciones */

type NotificationTone = "info" | "danger";
type NotificationKind = "new" | "assigned" | "update";
type NotificationView = "activity" | "assigned";

type PanelNotification = {
  id: string;
  title: string;
  body?: string;
  tone: NotificationTone;
  kind: NotificationKind;
  createdAt: number;
  read: boolean;
  target?: string;
  dedupeKey?: string;
};

const MAX_NOTIFICATIONS = 30;
const STORAGE_PREFIX = "helpdesk_staff_notifications_";
const DEDUPE_MS = 10 * 60_000;

const readSetting = (key: string, fallback = true) => {
  const value = localStorage.getItem(key);
  return value === null ? fallback : value !== "false";
};

function readStored(staffId: string): PanelNotification[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${staffId}`);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.id === "string" && typeof item.title === "string" && typeof item.createdAt === "number")
      .filter((item) => item.audience !== "system" && item.audience !== "pending")
      .map((item): PanelNotification => ({
        id: item.id,
        title: item.title,
        body: typeof item.body === "string" ? item.body : undefined,
        tone: item.tone === "danger" ? "danger" : "info",
        kind: item.kind === "assigned" ? "assigned" : item.kind === "update" ? "update" : "new",
        createdAt: item.createdAt,
        read: item.read === true,
        target: typeof item.target === "string" ? item.target : undefined,
        dedupeKey: typeof item.dedupeKey === "string" ? item.dedupeKey : undefined,
      }))
      .slice(0, MAX_NOTIFICATIONS);
  } catch {
    return [];
  }
}

function notificationTime(timestamp: number) {
  const minutes = Math.floor(Math.max(0, Date.now() - timestamp) / 60_000);
  if (minutes < 1) return "Ahora";
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours} h`;
  return new Date(timestamp).toLocaleDateString("es-PE", { day: "2-digit", month: "short" }).replace(".", "");
}

const KIND_LABEL: Record<NotificationKind, string> = { new: "Nueva", assigned: "Asignada a ti", update: "Seguimiento" };

/* ---------------------------------------------------------------- Layout */

export function StaffLayout() {
  const { data: me } = useMe();
  const isAdmin = me?.staff?.role === "ADMIN";
  const staffId = me?.staff?.id;

  const pendingDevices = useDevices("PENDIENTE", isAdmin);
  const pendingDeviceCount = isAdmin ? pendingDevices.data?.length ?? 0 : 0;

  const assigned = useQuery<Page<Ticket>>({
    queryKey: ["tickets", "notification-panel", "assigned-to-me"],
    queryFn: () => api<Page<Ticket>>("/tickets?active=true&assigned=me&page=1&page_size=6"),
    enabled: !!staffId,
    staleTime: 15_000,
  });

  const logout = useLogout();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const utilityRef = useRef<HTMLDivElement>(null);

  const [online, setOnline] = useState(() => navigator.onLine);
  const [offlinePending, setOfflinePending] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [search, setSearch] = useState(() => new URLSearchParams(location.search).get("q") ?? "");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notificationView, setNotificationView] = useState<NotificationView>("activity");
  const [items, setItems] = useState<PanelNotification[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => readSetting("helpdesk_notifications_enabled"));
  const [showConnection, setShowConnection] = useState(() => readSetting("helpdesk_show_connection"));

  /* --- Barra lateral: plegada a solo iconos, con preferencia recordada --- */
  const [collapsed, setCollapsed] = useState(() => readSetting(COLLAPSE_KEY));
  const toggleCollapsed = useCallback(() => setCollapsed((v) => !v), []);

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, String(collapsed));
  }, [collapsed]);

  /* --- Notificaciones: persistencia --- */
  useEffect(() => {
    if (!staffId) return;
    setItems(readStored(staffId));
    setHydrated(true);
  }, [staffId]);

  useEffect(() => {
    if (!hydrated || !staffId) return;
    localStorage.setItem(`${STORAGE_PREFIX}${staffId}`, JSON.stringify(items.slice(0, MAX_NOTIFICATIONS)));
  }, [items, hydrated, staffId]);

  useEffect(() => {
    if (notificationsOpen && notificationView === "assigned") void assigned.refetch();
  }, [notificationsOpen, notificationView]);

  const addNotification = useCallback((notification: Omit<PanelNotification, "id" | "createdAt" | "read">) => {
    const now = Date.now();
    const item: PanelNotification = { ...notification, id: `${now}-${Math.random().toString(36).slice(2)}`, createdAt: now, read: false };
    setItems((current) => {
      const duplicate = notification.dedupeKey
        ? current.find((entry) => entry.dedupeKey === notification.dedupeKey && now - entry.createdAt <= DEDUPE_MS)
        : undefined;
      const rest = duplicate ? current.filter((entry) => entry.id !== duplicate.id) : current;
      return [item, ...rest].slice(0, MAX_NOTIFICATIONS);
    });
  }, []);

  /* --- Eventos en vivo --- */
  const onEvent = useCallback((event: LiveEvent) => {
    if (!notificationsEnabled) return;
    const assignedToMe = !!staffId && event.assigned_to_id === staffId;
    const target = event.ticket_id ? `/soporte?ticket=${encodeURIComponent(event.ticket_id)}` : `/soporte?q=${encodeURIComponent(event.number ?? "")}`;
    const body = `${event.office ?? "Oficina"}: ${event.subject ?? "Incidencia"}`;
    const notify = assignedToMe || isAdmin;

    const push = (kind: NotificationKind, tone: NotificationTone, title: string, detail?: string, key?: string) => {
      addNotification({ kind, tone, title, body: detail ?? body, target, dedupeKey: key });
    };

    if (event.type === "ticket.created") {
      const tone: NotificationTone = event.priority === "ALTA" ? "danger" : "info";
      toast({ tone, title: `Nueva incidencia ${event.number ?? ""}`, body });
      push("new", tone, `Nueva incidencia ${event.number ?? ""}`, body, `${event.ticket_id}:created`);
    }
    if (event.type === "ticket.assigned" || event.type === "ticket.reassigned") {
      if (assignedToMe) {
        const title = `${event.type === "ticket.reassigned" ? "Reasignada a ti" : "Asignada a ti"} ${event.number ?? ""}`;
        toast({ tone: "info", title, body });
        push("assigned", "info", title, body, `${event.ticket_id}:assigned:${staffId}`);
      } else if (isAdmin) {
        push("update", "info", `Responsable actualizado · ${event.number ?? ""}`, event.assigned_to_name ? `${event.assigned_to_name} atenderá el caso.` : body, `${event.ticket_id}:assignment`);
      }
      void assigned.refetch();
    }
    if (event.type === "ticket.unassigned") {
      if (isAdmin) push("update", "danger", `Incidencia sin responsable · ${event.number ?? ""}`, body, `${event.ticket_id}:assignment`);
      void assigned.refetch();
    }
    if (event.type === "ticket.note" && notify) push("update", "info", `Nueva nota · ${event.number ?? ""}`, event.message || body, `${event.ticket_id}:note`);
    if (event.type === "ticket.waiting" && notify) push("update", "info", `En espera · ${event.number ?? ""}`, event.wait_reason_label || event.message || body, `${event.ticket_id}:waiting`);
    if (event.type === "ticket.resumed" && notify) push("update", "info", `Atención reanudada · ${event.number ?? ""}`, body, `${event.ticket_id}:waiting`);
    if (event.type === "ticket.resolved") { push("update", "info", `Incidencia cerrada · ${event.number ?? ""}`, body, `${event.ticket_id}:resolved`); void assigned.refetch(); }
    if (event.type === "ticket.reopened") {
      toast({ tone: "info", title: `Incidencia reabierta · ${event.number ?? ""}`, body });
      push("update", "info", `Incidencia reabierta · ${event.number ?? ""}`, body, `${event.ticket_id}:reopened`);
      void assigned.refetch();
    }
    if (event.type === "ticket.followup_due" && notify) {
      const title = `${event.follow_up_label ?? "Revisar seguimiento"} · ${event.number ?? ""}`;
      toast({ tone: "danger", title, body: event.message || body });
      push("update", "danger", title, event.message || body, `${event.ticket_id}:followup:${event.follow_up_state ?? "review"}`);
    }
    if (event.type === "device.pending" && isAdmin) toast({ tone: "info", title: "Equipo esperando autorización", body: `${event.office} con el código ${event.pair_code}` });
    if (event.type === "alert.created") toast({ tone: "danger", title: event.title ?? "Alerta", body: event.message });
  }, [toast, isAdmin, staffId, notificationsEnabled, addNotification, assigned]);

  useLiveEvents(true, onEvent);

  /* --- Conectividad y cola offline --- */
  useEffect(() => {
    const onSync = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string; pending?: number; scope?: string; payload?: { number?: string } }>).detail;
      if (detail?.type === "OFFLINE_QUEUE_CHANGED") setOfflinePending(Number(detail.pending ?? 0));
      if (detail?.scope !== "staff") return;
      if (detail.type === "OFFLINE_REQUEST_SENT") toast({ tone: "success", title: "Cambio sincronizado", body: detail.payload?.number ? `Se actualizó ${detail.payload.number}.` : "La acción pendiente se envió al servidor." });
      if (detail.type === "OFFLINE_REQUEST_REJECTED") toast({ tone: "danger", title: "No se pudo sincronizar un cambio", body: "El servidor rechazó una acción guardada sin conexión. Revise el ticket." });
      if (detail.type === "OFFLINE_REQUEST_AUTH_REQUIRED") toast({ tone: "danger", title: "Sincronización detenida", body: "Debe volver a iniciar sesión para enviar los cambios pendientes." });
    };
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    window.addEventListener("helpdesk-offline-sync", onSync);
    navigator.serviceWorker?.controller?.postMessage({ type: "GET_OFFLINE_QUEUE_COUNT" });
    if (navigator.onLine) navigator.serviceWorker?.controller?.postMessage({ type: "WARM_OFFLINE_DATA" });
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("helpdesk-offline-sync", onSync);
    };
  }, [toast]);

  useEffect(() => {
    const onSettingsChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ notificationsEnabled?: boolean; showConnection?: boolean }>).detail;
      if (typeof detail?.notificationsEnabled === "boolean") setNotificationsEnabled(detail.notificationsEnabled);
      if (typeof detail?.showConnection === "boolean") setShowConnection(detail.showConnection);
    };
    window.addEventListener("helpdesk-settings-changed", onSettingsChanged);
    return () => window.removeEventListener("helpdesk-settings-changed", onSettingsChanged);
  }, []);

  useEffect(() => {
    const closeMenus = (event: PointerEvent) => {
      if (utilityRef.current && !utilityRef.current.contains(event.target as Node)) {
        setNotificationsOpen(false);
        setSettingsOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeMenus);
    return () => document.removeEventListener("pointerdown", closeMenus);
  }, []);

  useEffect(() => {
    setSidebarOpen(false);
    setNotificationsOpen(false);
    setSettingsOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (location.pathname === "/soporte") setSearch(new URLSearchParams(location.search).get("q") ?? "");
  }, [location.pathname, location.search]);

  /* --- Derivados --- */
  const initials = me?.staff?.full_name ? me.staff.full_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() : "TI";
  const unread = items.filter((item) => !item.read).length;
  const read = items.length - unread;
  const assignedCount = assigned.data?.total ?? 0;

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const term = search.trim();
    navigate(term ? `/soporte?q=${encodeURIComponent(term)}` : "/soporte");
  };

  const closeSession = async () => {
    await logout();
    navigate("/soporte/ingresar");
  };

  const goTo = (target: string) => { setNotificationsOpen(false); navigate(target); };
  const openNotification = (item: PanelNotification) => {
    setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, read: true } : entry)));
    if (item.target) goTo(item.target);
  };

  return (
    <div className="min-h-dvh bg-papel text-tinta">
      <div className={cx("fixed inset-0 z-40 bg-tinta/45 backdrop-blur-[2px] transition lg:hidden", sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0")} onClick={() => setSidebarOpen(false)} />

      {/* ------------------------------------------------------- Menú lateral */}
      <aside
        data-collapsed={collapsed}
        className={cx(
          "barra fixed inset-y-0 left-0 z-50 flex flex-col border-r border-barra-linea text-slate-200 transition-[width,transform] duration-200 ease-out lg:translate-x-0",
          "w-[16.5rem]",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
          collapsed ? "lg:w-[4.75rem]" : "lg:w-[16.5rem]",
        )}
      >
        {/* Identidad */}
        <div className={cx("flex items-center gap-2.5 px-4 py-4", collapsed && "lg:justify-center lg:px-0")}>
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[linear-gradient(135deg,var(--color-vivo),var(--color-casma))] text-white shadow-[var(--glow-vivo)]">
            <Headset className="size-4.5" aria-hidden />
          </span>
          <div className={cx("min-w-0", collapsed && "lg:hidden")}>
            <p className="truncate text-[0.86rem] font-bold tracking-[-0.015em] text-white">Mesa de Ayuda TI</p>
            <p className="truncate text-[0.72rem] text-slate-400">Municipalidad de Casma</p>
          </div>
          <button className="ml-auto grid size-9 place-items-center rounded-lg text-slate-400 transition hover:bg-white/5 hover:text-white lg:hidden" onClick={() => setSidebarOpen(false)} aria-label="Cerrar menú"><X className="size-4.5" /></button>
        </div>
        <div className="barra-marca h-0.5 w-full shrink-0" aria-hidden />

        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 pb-4 pt-3" aria-label="Navegación principal">
          {GROUPS.map((group) => {
            const entries = NAV.filter((item) => item.group === group && (!item.admin || isAdmin));
            if (!entries.length) return null;
            return (
              <div key={group} className="mb-4">
                <p className={cx("mb-1 px-2.5 text-[0.65rem] font-bold uppercase tracking-[0.1em] text-slate-500", collapsed && "lg:text-center lg:text-[0.58rem]")}>
                  {collapsed ? group.split(" ")[0] : group}
                </p>
                <div className="space-y-0.5">
                  {entries.map(({ to, label, icon: Icon, end }) => (
                    <NavLink
                      key={to}
                      to={to}
                      end={end}
                      title={collapsed ? label : undefined}
                      className={({ isActive }) => cx("nav-item", isActive ? "text-white" : "text-slate-400 hover:text-white", collapsed && "lg:px-0")}
                    >
                      {({ isActive }) => (
                        <>
                          <Icon className={cx("size-4 shrink-0", isActive ? "text-vivo" : "text-slate-500")} aria-hidden />
                          <span className={cx("min-w-0 flex-1 truncate", collapsed && "lg:hidden")}>{label}</span>
                          {to === "/soporte/dispositivos" && pendingDeviceCount > 0 && (
                            <span className={cx("shrink-0 rounded-full bg-amber-400 px-1.5 text-[0.65rem] font-bold leading-5 text-[#0a1226]", collapsed && "lg:absolute lg:right-1.5 lg:top-1 lg:px-1.5 lg:text-[0.6rem]")}>
                              {pendingDeviceCount}
                            </span>
                          )}
                        </>
                      )}
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Pies: perfil y salida. En modo rail quedan como botones de icono. */}
        <div className="border-t border-white/[0.08] p-3">
          <button
            type="button"
            onClick={() => navigate("/soporte/perfil")}
            title={collapsed ? "Mi perfil" : undefined}
            className={cx("flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition hover:bg-white/[0.06]", collapsed && "lg:justify-center lg:px-0")}
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/10 text-[0.72rem] font-bold text-white">{initials}</span>
            <span className={cx("min-w-0 flex-1", collapsed && "lg:hidden")}>
              <span className="block truncate text-[0.8rem] font-semibold text-white">{me?.staff?.full_name ?? "Administrador TI"}</span>
              <span className="block text-[0.7rem] text-slate-400">{isAdmin ? "Administrador" : "Técnico"}</span>
            </span>
          </button>
          <button
            type="button"
            onClick={closeSession}
            title={collapsed ? "Cerrar sesión" : undefined}
            className={cx("mt-1 flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-[0.8rem] font-semibold text-slate-400 transition hover:bg-red-500/15 hover:text-red-300", collapsed && "lg:justify-center lg:px-0")}
          >
            <LogOut className="size-4 shrink-0" aria-hidden /> <span className={cx(collapsed && "lg:hidden")}>Cerrar sesión</span>
          </button>
        </div>
      </aside>

      {/* ------------------------------------------------------------- Main */}
      <div className={cx("transition-[padding] duration-200 ease-out", collapsed ? "lg:pl-[4.75rem]" : "lg:pl-[16.5rem]")}>
        <header className="sticky top-0 z-30 border-b border-linea bg-white/85 backdrop-blur-md">
          <div className="mx-auto flex max-w-[1560px] items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-5">
            <button className="grid size-10 shrink-0 place-items-center rounded-lg border border-linea bg-white text-tinta-2 transition hover:bg-papel-2 lg:hidden" onClick={() => setSidebarOpen(true)} aria-label="Abrir menú"><Menu className="size-4.5" /></button>

            {/* Plegar / desplegar la barra de navegación */}
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={collapsed ? "Desplegar el menú lateral" : "Plegar el menú lateral"}
              aria-pressed={collapsed}
              title={collapsed ? "Desplegar el menú lateral" : "Plegar el menú lateral"}
              className="hidden size-10 shrink-0 place-items-center rounded-lg border border-linea bg-white text-tenue transition hover:border-casma/40 hover:bg-casma-claro/50 hover:text-casma-oscuro lg:grid"
            >
              {collapsed ? <ChevronsRight className="size-4.5" aria-hidden /> : <ChevronsLeft className="size-4.5" aria-hidden />}
            </button>

            <form onSubmit={submitSearch} role="search" className="relative min-w-0 flex-1 sm:max-w-md">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-tenue-2" aria-hidden />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar incidencias, equipos, oficinas o personas" aria-label="Buscar en el sistema" className="pl-8" />
            </form>

            <div className="ml-auto flex shrink-0 items-center gap-1.5" ref={utilityRef}>
              <button type="button" onClick={() => navigate("/soporte?new=1")} className="hidden min-h-10 items-center gap-1.5 rounded-lg bg-[linear-gradient(135deg,var(--color-vivo),var(--color-casma)_60%,var(--color-casma-oscuro))] px-3 text-[0.83rem] font-semibold text-white shadow-[var(--glow-marca)] transition hover:brightness-110 sm:inline-flex">
                <Plus className="size-4" aria-hidden /> Nueva incidencia
              </button>
              <button type="button" onClick={() => navigate("/soporte?new=1")} className="grid size-10 place-items-center rounded-lg bg-casma text-white shadow-[var(--glow-marca)] transition hover:brightness-110 sm:hidden" aria-label="Nueva incidencia"><Plus className="size-4" /></button>

              {showConnection && (
                <span className="hidden min-h-10 items-center gap-1.5 rounded-lg border border-linea px-2.5 text-[0.78rem] font-medium text-tenue md:inline-flex">
                  <span className={cx("size-1.5 rounded-full", online ? "bg-emerald-500" : "bg-amber-500")} aria-hidden />
                  {online ? "En línea" : "Offline"}
                </span>
              )}

              {/* Notificaciones */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => { setNotificationsOpen((v) => !v); setSettingsOpen(false); }}
                  className={cx("relative grid size-10 place-items-center rounded-lg border transition", notificationsOpen ? "border-tinta bg-tinta text-white" : "border-linea bg-white text-tenue hover:bg-papel-2 hover:text-tinta")}
                  aria-label={unread > 0 ? `Notificaciones, ${unread} sin leer` : "Notificaciones"}
                  aria-expanded={notificationsOpen}
                  aria-controls="notifications-menu"
                >
                  <Bell className="size-4.5" aria-hidden />
                  {unread > 0 && <span className="absolute -right-1 -top-1 grid min-w-[1.1rem] place-items-center rounded-full bg-amber-500 px-1 text-[0.62rem] font-bold leading-4 text-[#0a1226] ring-2 ring-white">{unread > 9 ? "9+" : unread}</span>}
                </button>

                {notificationsOpen && (
                  <div id="notifications-menu" className="popover animate-rise absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[min(24rem,calc(100vw-1.5rem))]">
                    <div className="flex items-center justify-between gap-2 border-b border-linea px-3 py-2.5">
                      <div className="segmented" role="tablist" aria-label="Vista de notificaciones">
                        <button type="button" role="tab" aria-selected={notificationView === "activity"} onClick={() => setNotificationView("activity")}>Actividad{unread > 0 && <span className="ml-1.5 text-[0.68rem] opacity-70">{unread}</span>}</button>
                        <button type="button" role="tab" aria-selected={notificationView === "assigned"} onClick={() => setNotificationView("assigned")}>Asignadas a mí{assignedCount > 0 && <span className="ml-1.5 text-[0.68rem] opacity-70">{assignedCount}</span>}</button>
                      </div>
                      <div className="notif-bar border-0 bg-transparent p-0">
                        {unread > 0 && <button type="button" onClick={() => setItems((c) => c.map((i) => ({ ...i, read: true })))} aria-label="Marcar todas como leídas" title="Marcar leídas"><CheckCheck className="size-4" /></button>}
                        {read > 0 && <button type="button" onClick={() => setItems((c) => c.filter((i) => !i.read))} aria-label="Limpiar leídas" title="Limpiar leídas"><Trash2 className="size-4" /></button>}
                      </div>
                    </div>

                    {notificationView === "activity" ? (
                      <ul className="max-h-[22rem] overflow-y-auto p-1.5">
                        {items.map((item) => (
                          <li key={item.id} className="group relative">
                            <button type="button" onClick={() => openNotification(item)} className={cx("flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 pr-9 text-left transition hover:bg-papel-2", item.read ? "opacity-70" : "bg-casma-claro/45")}>
                              <span className={cx("mt-0.5 grid size-6 shrink-0 place-items-center rounded-md", item.kind === "assigned" ? "bg-emerald-100 text-emerald-700" : item.tone === "danger" ? "bg-red-100 text-red-700" : item.kind === "update" ? "bg-amber-100 text-amber-700" : "bg-sky-100 text-sky-700")}>
                                {item.kind === "assigned" ? <UserRound className="size-3.5" /> : item.kind === "update" ? <CheckCheck className="size-3.5" /> : <ClipboardList className="size-3.5" />}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[0.82rem] font-semibold text-tinta">{item.title}</span>
                                {item.body && <span className="mt-0.5 line-clamp-2 block text-[0.75rem] leading-4 text-tenue">{item.body}</span>}
                                <span className="mt-1 block text-[0.68rem] font-medium text-tenue-2">{KIND_LABEL[item.kind]} · {notificationTime(item.createdAt)}</span>
                              </span>
                            </button>
                            <button type="button" onClick={() => setItems((c) => c.filter((n) => n.id !== item.id))} className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-md text-tenue-2 opacity-0 transition hover:bg-red-50 hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100" aria-label={`Descartar ${item.title}`}>
                              <X className="size-3.5" />
                            </button>
                          </li>
                        ))}
                        {!items.length && (
                          <li className="px-4 py-10 text-center">
                            <Bell className="mx-auto size-5 text-tenue-2" aria-hidden />
                            <p className="mt-2 text-[0.82rem] font-semibold text-tinta">Sin novedades</p>
                            <p className="mt-0.5 text-[0.75rem] text-tenue">Aquí verá las incidencias nuevas, asignaciones y cierres.</p>
                          </li>
                        )}
                      </ul>
                    ) : (
                      <ul className="max-h-[22rem] overflow-y-auto p-1.5">
                        {(assigned.data?.items ?? []).map((ticket) => (
                          <li key={ticket.id}>
                            <button type="button" onClick={() => goTo(`/soporte?ticket=${encodeURIComponent(ticket.id)}`)} className="w-full rounded-lg px-2.5 py-2 text-left transition hover:bg-papel-2">
                              <span className="block truncate text-[0.82rem] font-semibold text-tinta">{ticket.subject}</span>
                              <span className="mt-0.5 block truncate text-[0.75rem] text-tenue">{ticket.number} · {ticket.office_name}</span>
                            </button>
                          </li>
                        ))}
                        {assignedCount === 0 && <li className="px-4 py-10 text-center text-[0.78rem] text-tenue">No tienes incidencias asignadas.</li>}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              {/* Ajustes rápidos */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => { setSettingsOpen((v) => !v); setNotificationsOpen(false); }}
                  className={cx("grid size-10 place-items-center rounded-lg border transition", settingsOpen ? "border-tinta bg-tinta text-white" : "border-linea bg-white text-tenue hover:bg-papel-2 hover:text-tinta")}
                  aria-label="Abrir configuración" aria-expanded={settingsOpen} aria-controls="settings-menu"
                >
                  <Settings className="size-4.5" aria-hidden />
                </button>

                {settingsOpen && (
                  <div id="settings-menu" className="popover animate-rise absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[min(15rem,calc(100vw-1.5rem))] p-1.5">
                    <p className="px-2.5 py-2 text-[0.68rem] font-bold uppercase tracking-[0.09em] text-tenue-2">Cuenta</p>
                    <MenuLink icon={<UserRound className="size-4" />} onClick={() => navigate("/soporte/perfil")}>Mi perfil</MenuLink>
                    <MenuLink icon={<KeyRound className="size-4" />} onClick={() => navigate("/soporte/clave")}>Cambiar contraseña</MenuLink>
                    <MenuLink icon={<ShieldCheck className="size-4" />} onClick={() => navigate("/soporte/configuracion")}>Preferencias</MenuLink>
                    {isAdmin && <MenuLink icon={<Radar className="size-4" />} onClick={() => navigate("/soporte/ia")}>Análisis con IA</MenuLink>}
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {!online && (
          <div className="border-b border-linea bg-amber-50">
            <p className="mx-auto flex max-w-[1560px] items-center gap-2 px-4 py-2 text-[0.78rem] font-semibold text-amber-900 sm:px-6">
              Modo offline · los cambios nuevos se guardarán en este dispositivo
              {offlinePending > 0 && <span className="font-normal">· {offlinePending} pendiente{offlinePending === 1 ? "" : "s"}</span>}
            </p>
          </div>
        )}

        <main className="mx-auto max-w-[1560px] px-3 py-4 sm:px-5 sm:py-5 lg:py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function MenuLink({ icon, onClick, children }: { icon: React.ReactNode; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[0.82rem] font-medium text-tinta-2 transition hover:bg-papel-2">
      <span className="text-tenue-2" aria-hidden>{icon}</span>
      {children}
    </button>
  );
}
