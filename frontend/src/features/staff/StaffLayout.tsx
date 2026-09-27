import { useQuery } from "@tanstack/react-query";
import { Bell, BrainCircuit, Building2, CheckCheck, ClipboardList, CloudUpload, Headset, Inbox, KeyRound, LogOut, Menu, MonitorSmartphone, Monitor, Plus, ScrollText, Search, Settings, Trash2, UserCheck, UserRound, Users, WifiOff, X, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useToast } from "../../components/Toasts";
import { cx, Input } from "../../components/ui";
import { api } from "../../lib/api";
import { useLiveEvents, useLogout, useMe, type LiveEvent } from "../../lib/session";
import type { Page, Ticket } from "../../lib/types";
import { useDevices } from "./hooks";

type NavItem = { to: string; label: string; icon: LucideIcon; admin?: boolean; end?: boolean; section: "Operación" | "Administración" };
type NotificationTone = "info" | "danger";
type NotificationKind = "new" | "assigned";
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
  ticketId?: string;
};

const NAV: NavItem[] = [
  { to: "/soporte", label: "Incidencias", icon: ClipboardList, end: true, section: "Operación" },
  { to: "/soporte/mis-incidencias", label: "Mis incidencias", icon: UserCheck, section: "Operación" },
  { to: "/soporte/equipos", label: "Equipos", icon: Monitor, section: "Operación" },
  { to: "/soporte/ia", label: "Análisis IA", icon: BrainCircuit, section: "Operación" },
  { to: "/soporte/dispositivos", label: "Dispositivos", icon: MonitorSmartphone, admin: true, section: "Administración" },
  { to: "/soporte/oficinas", label: "Oficinas", icon: Building2, admin: true, section: "Administración" },
  { to: "/soporte/organizacion", label: "Organización", icon: Users, section: "Administración" },
  { to: "/soporte/personal", label: "Personal TI", icon: Users, admin: true, section: "Administración" },
  { to: "/soporte/auditoria", label: "Auditoría", icon: ScrollText, admin: true, section: "Administración" },
];

const MAX_NOTIFICATIONS = 30;
const NOTIFICATION_STORAGE_PREFIX = "helpdesk_staff_notifications_";

const readSetting = (key: string, fallback = true) => {
  const value = localStorage.getItem(key);
  if (value === null) return fallback;
  return value !== "false";
};

const readStoredNotifications = (staffId: string): PanelNotification[] => {
  try {
    const raw = localStorage.getItem(`${NOTIFICATION_STORAGE_PREFIX}${staffId}`);
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
        kind: item.kind === "assigned" || item.audience === "mine" ? "assigned" : "new",
        createdAt: item.createdAt,
        read: item.read === true,
        target: typeof item.target === "string" ? item.target : undefined,
        ticketId: typeof item.ticketId === "string" ? item.ticketId : undefined,
      }))
      .slice(0, MAX_NOTIFICATIONS);
  } catch {
    return [];
  }
};

function notificationTime(timestamp: number) {
  const diff = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "Ahora";
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours} h`;
  return new Date(timestamp).toLocaleDateString("es-PE", { day: "2-digit", month: "short" }).replace(".", "");
}

export function StaffLayout() {
  const { data: me } = useMe();
  const isAdmin = me?.staff?.role === "ADMIN";
  const pendingDevices = useDevices("PENDIENTE", isAdmin);
  const pendingDeviceCount = isAdmin ? pendingDevices.data?.length ?? 0 : 0;
  const assignedQuery = useQuery<Page<Ticket>>({
    queryKey: ["tickets", "notification-panel", "assigned-to-me"],
    queryFn: () => api<Page<Ticket>>("/tickets?active=true&assigned=me&page=1&page_size=6"),
    enabled: !!me?.staff,
    staleTime: 15_000,
  });

  const logout = useLogout();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const utilityRef = useRef<HTMLDivElement>(null);

  const [online, setOnline] = useState(() => navigator.onLine);
  const [offlinePending, setOfflinePending] = useState(0);
  const [offlineCachedAt, setOfflineCachedAt] = useState<number | null>(() => {
    const value = localStorage.getItem("helpdesk_offline_cached_at");
    const parsed = value ? Number(value) : 0;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [headerSearch, setHeaderSearch] = useState(() => new URLSearchParams(location.search).get("q") ?? "");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notificationView, setNotificationView] = useState<NotificationView>("activity");
  const [panelNotifications, setPanelNotifications] = useState<PanelNotification[]>([]);
  const [notificationsHydrated, setNotificationsHydrated] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => readSetting("helpdesk_notifications_enabled"));
  const [showConnection, setShowConnection] = useState(() => readSetting("helpdesk_show_connection"));

  useEffect(() => {
    if (!me?.staff?.id) return;
    setPanelNotifications(readStoredNotifications(me.staff.id));
    setNotificationsHydrated(true);
  }, [me?.staff?.id]);

  useEffect(() => {
    if (!notificationsHydrated || !me?.staff?.id) return;
    localStorage.setItem(`${NOTIFICATION_STORAGE_PREFIX}${me.staff.id}`, JSON.stringify(panelNotifications.slice(0, MAX_NOTIFICATIONS)));
  }, [panelNotifications, notificationsHydrated, me?.staff?.id]);

  useEffect(() => {
    if (notificationsOpen && notificationView === "assigned") void assignedQuery.refetch();
  }, [notificationsOpen, notificationView]);

  const addPanelNotification = useCallback((notification: Omit<PanelNotification, "id" | "createdAt" | "read">) => {
    const item: PanelNotification = {
      ...notification,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      createdAt: Date.now(),
      read: false,
    };
    setPanelNotifications((current) => [item, ...current].slice(0, MAX_NOTIFICATIONS));
  }, []);

  const onEvent = useCallback((event: LiveEvent) => {
    if (!notificationsEnabled) return;

    if (event.type === "ticket.created") {
      const tone: NotificationTone = event.priority === "ALTA" ? "danger" : "info";
      const target = event.ticket_id
        ? `/soporte?source=notifications&ticket=${encodeURIComponent(event.ticket_id)}`
        : `/soporte?q=${encodeURIComponent(event.number ?? "")}`;

      toast({ tone, title: `Nueva incidencia ${event.number ?? ""}`, body: `${event.office}: ${event.subject}` });
      addPanelNotification({
        tone,
        kind: "new",
        title: `Nueva incidencia ${event.number ?? ""}`,
        body: `${event.office}: ${event.subject}`,
        target,
        ticketId: event.ticket_id,
      });
    }

    if (event.type === "ticket.assigned") {
      const target = event.ticket_id
        ? `/soporte?source=notifications&ticket=${encodeURIComponent(event.ticket_id)}`
        : "/soporte/mis-incidencias";

      toast({ tone: "info", title: `Se te asignó ${event.number}`, body: `${event.office}: ${event.subject}` });
      addPanelNotification({
        tone: "info",
        kind: "assigned",
        title: `Asignada a ti ${event.number}`,
        body: `${event.office}: ${event.subject}`,
        target,
        ticketId: event.ticket_id,
      });
      void assignedQuery.refetch();
    }

    if (event.type === "device.pending" && isAdmin) {
      toast({ tone: "info", title: "Equipo esperando autorización", body: `${event.office} con el código ${event.pair_code}` });
    }

    if (event.type === "alert.created") {
      toast({ tone: "danger", title: event.title ?? "Alerta", body: event.message });
    }
  }, [toast, isAdmin, notificationsEnabled, addPanelNotification]);
  useLiveEvents(true, onEvent);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    const onSync = (event: Event) => {
      const detail = (event as CustomEvent<{
        type?: string;
        pending?: number;
        scope?: string;
        cachedAt?: number;
        payload?: { number?: string };
      }>).detail;

      if (detail?.type === "OFFLINE_QUEUE_CHANGED") setOfflinePending(Number(detail.pending ?? 0));
      if ((detail?.type === "OFFLINE_READ_USED" || detail?.type === "OFFLINE_READ_CACHE_READY") && detail.cachedAt) setOfflineCachedAt(Number(detail.cachedAt));
      if (detail?.type === "OFFLINE_READ_CACHE_CLEARED") setOfflineCachedAt(null);
      if (detail?.scope === "staff" && detail.type === "OFFLINE_REQUEST_SENT") {
        toast({ tone: "success", title: "Cambio sincronizado", body: detail.payload?.number ? `Se actualizó ${detail.payload.number}.` : "La acción pendiente se envió al servidor." });
      }
      if (detail?.scope === "staff" && detail.type === "OFFLINE_REQUEST_REJECTED") {
        toast({ tone: "danger", title: "No se pudo sincronizar un cambio", body: "El servidor rechazó una acción guardada sin conexión. Revise el ticket." });
      }
      if (detail?.scope === "staff" && detail.type === "OFFLINE_REQUEST_AUTH_REQUIRED") {
        toast({ tone: "danger", title: "Sincronización detenida", body: "Debe volver a iniciar sesión para enviar los cambios pendientes." });
      }
      if (detail?.scope === "staff" && detail.type === "OFFLINE_REQUEST_USER_MISMATCH") {
        toast({ tone: "danger", title: "Cambios pendientes de otro técnico", body: "Estas acciones solo se sincronizarán cuando vuelva a iniciar sesión el técnico que las realizó." });
      }
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("helpdesk-offline-sync", onSync);
    navigator.serviceWorker?.controller?.postMessage({ type: "GET_OFFLINE_QUEUE_COUNT" });
    if (navigator.onLine) navigator.serviceWorker?.controller?.postMessage({ type: "WARM_OFFLINE_DATA" });

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
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
    if (location.pathname === "/soporte") {
      setHeaderSearch(new URLSearchParams(location.search).get("q") ?? "");
    }
  }, [location.pathname, location.search]);

  const initials = me?.staff?.full_name
    ? me.staff.full_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()
    : "TI";

  const unreadCount = panelNotifications.filter((notification) => !notification.read).length;
  const readCount = panelNotifications.length - unreadCount;
  const assignedTickets = assignedQuery.data?.items ?? [];
  const assignedCount = assignedQuery.data?.total ?? 0;
  const notificationBadge = Math.min(99, unreadCount);

  const openNewTicket = () => navigate("/soporte?new=1");
  const groups = ["Operación", "Administración"] as const;

  const closeSession = async () => {
    await logout();
    navigate("/soporte/ingresar");
  };

  const submitHeaderSearch = (event: FormEvent) => {
    event.preventDefault();
    const term = headerSearch.trim();
    navigate(term ? `/soporte?q=${encodeURIComponent(term)}` : "/soporte");
  };

  const goFromNotifications = (target: string) => {
    setNotificationsOpen(false);
    navigate(target);
  };

  const openPanelNotification = (notification: PanelNotification) => {
    setPanelNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, read: true } : item));
    if (notification.target) goFromNotifications(notification.target);
  };

  const removePanelNotification = (id: string) => {
    setPanelNotifications((current) => current.filter((notification) => notification.id !== id));
  };

  const markAllRead = () => {
    setPanelNotifications((current) => current.map((notification) => ({ ...notification, read: true })));
  };

  const removeReadNotifications = () => {
    setPanelNotifications((current) => current.filter((notification) => !notification.read));
  };

  return (
    <div className="min-h-dvh bg-papel text-tinta">
      <div
        className={cx("fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-sm transition lg:hidden", sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0")}
        onClick={() => setSidebarOpen(false)}
      />

      <aside className={cx(
        "fixed inset-y-0 left-0 z-50 flex w-[17rem] flex-col bg-[#111827] text-white shadow-[12px_0_35px_rgba(2,6,23,0.24)] transition-transform duration-200 lg:w-64 lg:translate-x-0 xl:w-72",
        sidebarOpen ? "translate-x-0" : "-translate-x-full",
      )}>
        <div className="flex items-center justify-between px-5 py-5 shadow-[0_12px_26px_-20px_rgba(245,158,11,0.24)]">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#EAB308] text-[#111827] shadow-[0_8px_20px_rgba(234,179,8,0.16)]">
              <Headset className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="truncate text-base font-bold tracking-[-0.02em] text-white">Help Desk Municipal</p>
              <p className="mt-0.5 truncate text-xs font-medium text-[#94A3B8]">Municipalidad Provincial de Casma</p>
            </div>
          </div>
          <button className="grid size-11 shrink-0 place-items-center rounded-xl text-slate-400 transition hover:bg-slate-800 hover:text-white lg:hidden" onClick={() => setSidebarOpen(false)} aria-label="Cerrar menú">
            <X className="size-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-5 xl:px-4" aria-label="Navegación principal">
          {groups.map((group) => {
            const items = NAV.filter((item) => item.section === group && (!item.admin || isAdmin));
            if (!items.length) return null;
            return (
              <div key={group} className={cx("mb-6", group === "Administración" && "pt-5 shadow-[0_-12px_26px_-22px_rgba(245,158,11,0.18)]")}>
                <p className="mb-2 px-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{group}</p>
                <div className="space-y-1">
                  {items.map(({ to, label, icon: Icon, end }) => (
                    <NavLink
                      key={to}
                      to={to}
                      end={end}
                      className={({ isActive }) => cx(
                        "group relative flex min-h-12 items-center gap-3 overflow-hidden rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-all duration-150",
                        isActive
                          ? "bg-[#1F2937] pl-4 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                          : "text-[#94A3B8] hover:bg-white/[0.05] hover:text-white",
                      )}
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-[#D97706]" aria-hidden />}
                          <Icon className={cx("size-5 shrink-0 transition-colors", isActive ? "text-[#F59E0B]" : "text-[#94A3B8] group-hover:text-white")} aria-hidden />
                          <span className="min-w-0 flex-1 truncate">{label}</span>
                          {to === "/soporte/dispositivos" && pendingDeviceCount > 0 && (
                            <span className="rounded-full bg-[#EAB308] px-2 py-1 text-xs font-bold leading-none text-[#111827]">{pendingDeviceCount}</span>
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

        <div className="mt-auto px-4 py-4 shadow-[0_-14px_30px_-22px_rgba(245,158,11,0.24)] xl:px-5">
          <button
            type="button"
            onClick={() => navigate("/soporte/perfil")}
            className="flex min-h-14 w-full items-center gap-3 rounded-xl px-1 py-1 text-left transition hover:bg-white/[0.05] focus-visible:outline-amber-400"
            aria-label="Abrir mi perfil"
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#EAB308] font-bold text-[#111827] shadow-sm">{initials}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-white">{me?.staff?.full_name ?? "Administrador TI"}</span>
              <span className="mt-0.5 block text-xs font-medium text-[#94A3B8]">{isAdmin ? "Administrador TI" : "Técnico"}</span>
            </span>
            <UserRound className="size-4 shrink-0 text-slate-500" aria-hidden />
          </button>
          <button
            onClick={closeSession}
            className="mt-4 flex min-h-11 w-full items-center justify-start gap-2 rounded-xl border border-black bg-black px-3.5 py-2.5 text-sm font-semibold text-white transition hover:border-red-900/70 hover:bg-red-950/80 hover:text-white focus-visible:outline-red-400"
            aria-label="Cerrar sesión"
          >
            <LogOut className="size-4" aria-hidden /> Cerrar sesión
          </button>
        </div>
      </aside>

      <div className="lg:pl-64 xl:pl-72">
        <header className="sticky top-0 z-30 border-b border-linea bg-white/94 backdrop-blur-md">
          <div className="mx-auto flex max-w-[1600px] items-center gap-2 px-3 py-3 sm:gap-3 sm:px-6 sm:py-4">
            <button
              className="grid size-11 shrink-0 place-items-center rounded-xl border border-linea bg-white text-tinta shadow-sm hover:border-slate-400 hover:text-slate-900 lg:hidden"
              onClick={() => setSidebarOpen(true)}
              aria-label="Abrir menú"
            >
              <Menu className="size-5" />
            </button>

            <form onSubmit={submitHeaderSearch} role="search" className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-tenue" aria-hidden />
              <Input
                value={headerSearch}
                onChange={(event) => setHeaderSearch(event.target.value)}
                placeholder="Buscar incidencias, equipos, oficinas o usuarios"
                aria-label="Buscar en el sistema"
                className="h-12 bg-[#F3F4F6] pl-11 pr-4 shadow-none hover:border-slate-400 focus:bg-white"
              />
            </form>

            <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3" ref={utilityRef}>
              <button
                onClick={openNewTicket}
                className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-[#166534] bg-[#15803D] px-3.5 text-sm font-bold text-white shadow-[0_8px_20px_rgba(21,128,61,0.20)] transition hover:bg-[#166534] sm:px-4"
                aria-label="Nueva incidencia"
              >
                <Plus className="size-4" />
                <span className="hidden sm:inline">Nueva incidencia</span>
                <span className="sm:hidden">Nueva</span>
              </button>

              {showConnection && (
                <div className="hidden min-h-11 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm md:inline-flex">
                  <span className={cx("mr-2 inline-block size-2 rounded-full", online ? "bg-emerald-500" : "bg-amber-500")} aria-hidden />
                  {online ? "En línea" : "Offline"}
                </div>
              )}

              <div className="relative flex items-center rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
                <button
                  type="button"
                  className={cx(
                    "relative grid size-10 place-items-center rounded-lg transition",
                    notificationsOpen ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                  )}
                  aria-label="Abrir notificaciones"
                  aria-expanded={notificationsOpen}
                  aria-controls="notifications-menu"
                  title="Notificaciones"
                  onClick={() => {
                    setNotificationsOpen((current) => !current);
                    setSettingsOpen(false);
                  }}
                >
                  <Bell className="size-5" aria-hidden />
                  {notificationBadge > 0 && (
                    <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-amber-500 px-1 text-center text-[11px] font-bold leading-5 text-[#111827] ring-2 ring-white" aria-label={`${notificationBadge} notificaciones sin leer`}>
                      {notificationBadge > 9 ? "9+" : notificationBadge}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  className="grid size-10 place-items-center rounded-lg text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                  aria-label="Abrir configuración"
                  aria-expanded={settingsOpen}
                  aria-controls="settings-menu"
                  title="Configuración"
                  onClick={() => {
                    setSettingsOpen((current) => !current);
                    setNotificationsOpen(false);
                  }}
                >
                  <Settings className="size-5" aria-hidden />
                </button>

                {notificationsOpen && (
                  <div id="notifications-menu" className="absolute right-0 top-[calc(100%+0.65rem)] z-50 w-[min(27rem,calc(100vw-1rem))] overflow-hidden rounded-[1.4rem] border border-slate-200 bg-white shadow-[0_28px_75px_rgba(15,23,42,0.24)]">
                    <div className="border-b border-slate-200 bg-white px-4 pb-0 pt-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-slate-900 text-white shadow-sm">
                            <Bell className="size-4" aria-hidden />
                          </span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-extrabold tracking-[-0.01em] text-slate-950">Notificaciones</p>
                              {unreadCount > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">{unreadCount} nuevas</span>}
                            </div>
                            <p className="mt-0.5 text-xs leading-5 text-slate-500">Actividad reciente de incidencias.</p>
                          </div>
                        </div>
                        <button type="button" className="grid size-9 shrink-0 place-items-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-900" onClick={() => setNotificationsOpen(false)} aria-label="Cerrar notificaciones">
                          <X className="size-4" />
                        </button>
                      </div>

                      <div className="mt-4 flex gap-5" role="tablist" aria-label="Vista de notificaciones">
                        <button
                          type="button"
                          role="tab"
                          aria-selected={notificationView === "activity"}
                          onClick={() => setNotificationView("activity")}
                          className={cx(
                            "relative min-h-10 pb-3 text-sm font-bold transition",
                            notificationView === "activity" ? "text-slate-950" : "text-slate-400 hover:text-slate-700",
                          )}
                        >
                          Actividad
                          {notificationView === "activity" && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-amber-500" aria-hidden />}
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={notificationView === "assigned"}
                          onClick={() => setNotificationView("assigned")}
                          className={cx(
                            "relative min-h-10 pb-3 text-sm font-bold transition",
                            notificationView === "assigned" ? "text-slate-950" : "text-slate-400 hover:text-slate-700",
                          )}
                        >
                          Asignadas a mí
                          {assignedCount > 0 && <span className="ml-1.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[11px] font-bold text-emerald-700">{assignedCount}</span>}
                          {notificationView === "assigned" && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-emerald-600" aria-hidden />}
                        </button>
                      </div>
                    </div>

                    {notificationView === "activity" ? (
                      <>
                        {(unreadCount > 0 || readCount > 0) && (
                          <div className="flex items-center justify-end gap-1 border-b border-slate-100 bg-slate-50/60 px-3 py-2">
                            {unreadCount > 0 && (
                              <button type="button" onClick={markAllRead} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-bold text-slate-500 transition hover:bg-white hover:text-slate-900">
                                <CheckCheck className="size-4" /> Marcar leídas
                              </button>
                            )}
                            {readCount > 0 && (
                              <button type="button" onClick={removeReadNotifications} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-bold text-slate-500 transition hover:bg-white hover:text-red-700">
                                <Trash2 className="size-4" /> Limpiar leídas
                              </button>
                            )}
                          </div>
                        )}

                        <div className="max-h-[25rem] overflow-y-auto p-2">
                          {panelNotifications.map((notification) => (
                            <div
                              key={notification.id}
                              className={cx(
                                "group relative mb-1 overflow-hidden rounded-2xl border transition",
                                notification.read ? "border-transparent bg-white hover:border-slate-100 hover:bg-slate-50" : "border-slate-200 bg-white shadow-[0_4px_14px_rgba(15,23,42,0.04)]",
                              )}
                            >
                              {!notification.read && <span className={cx("absolute inset-y-3 left-0 w-1 rounded-r-full", notification.kind === "assigned" ? "bg-emerald-500" : notification.tone === "danger" ? "bg-red-500" : "bg-sky-500")} aria-hidden />}
                              <button type="button" onClick={() => openPanelNotification(notification)} className="flex min-w-0 w-full items-start gap-3 px-3 py-3 pr-11 text-left">
                                <span className={cx(
                                  "mt-0.5 grid size-9 shrink-0 place-items-center rounded-2xl",
                                  notification.kind === "assigned"
                                    ? "bg-emerald-50 text-emerald-700"
                                    : notification.tone === "danger"
                                      ? "bg-red-50 text-red-700"
                                      : "bg-sky-50 text-sky-700",
                                )}>
                                  {notification.kind === "assigned" ? <UserCheck className="size-4" /> : <Inbox className="size-4" />}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="flex flex-wrap items-center gap-2">
                                    <span className="text-sm font-extrabold leading-5 text-slate-950">{notification.title}</span>
                                    <span className={cx(
                                      "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em]",
                                      notification.kind === "assigned" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600",
                                    )}>
                                      {notification.kind === "assigned" ? "Asignada a ti" : "Nueva"}
                                    </span>
                                  </span>
                                  {notification.body && <span className="mt-1 block line-clamp-2 text-xs leading-5 text-slate-600">{notification.body}</span>}
                                  <span className="mt-1.5 block text-[11px] font-semibold text-slate-400">{notificationTime(notification.createdAt)}</span>
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => removePanelNotification(notification.id)}
                                className="absolute right-2 top-2 grid size-8 place-items-center rounded-xl text-slate-300 transition hover:bg-red-50 hover:text-red-700 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                                aria-label={`Eliminar ${notification.title}`}
                                title="Eliminar notificación"
                              >
                                <X className="size-4" />
                              </button>
                            </div>
                          ))}

                          {panelNotifications.length === 0 && (
                            <div className="px-5 py-10 text-center">
                              <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-slate-100 text-slate-400">
                                <Bell className="size-5" aria-hidden />
                              </span>
                              <p className="mt-3 text-sm font-bold text-slate-900">No hay notificaciones nuevas</p>
                              <p className="mx-auto mt-1 max-w-64 text-xs leading-5 text-slate-500">Cuando alguien cree una incidencia o una sea asignada a ti, aparecerá aquí.</p>
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="border-b border-slate-100 bg-emerald-50/40 px-4 py-3">
                          <p className="text-xs font-bold text-emerald-800">{assignedCount} {assignedCount === 1 ? "incidencia asignada" : "incidencias asignadas"} actualmente</p>
                          <p className="mt-0.5 text-[11px] leading-4 text-slate-500">Solo se muestran casos abiertos que están bajo tu responsabilidad.</p>
                        </div>
                        <div className="max-h-[23rem] overflow-y-auto p-2">
                          {assignedQuery.isLoading ? (
                            <div className="px-4 py-9 text-center text-sm text-slate-500">Cargando incidencias asignadas…</div>
                          ) : assignedQuery.error ? (
                            <div className="px-4 py-9 text-center">
                              <p className="text-sm font-bold text-red-700">No se pudieron cargar tus incidencias</p>
                              <button type="button" onClick={() => void assignedQuery.refetch()} className="mt-2 text-xs font-bold text-casma-oscuro hover:underline">Reintentar</button>
                            </div>
                          ) : assignedTickets.length === 0 ? (
                            <div className="px-5 py-10 text-center">
                              <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-600">
                                <UserCheck className="size-5" aria-hidden />
                              </span>
                              <p className="mt-3 text-sm font-bold text-slate-900">No tienes incidencias abiertas asignadas</p>
                              <p className="mx-auto mt-1 max-w-64 text-xs leading-5 text-slate-500">Cuando te asignen una incidencia, aparecerá aquí automáticamente.</p>
                            </div>
                          ) : (
                            assignedTickets.map((ticket) => (
                              <button
                                key={ticket.id}
                                type="button"
                                onClick={() => goFromNotifications(`/soporte?source=notifications&ticket=${encodeURIComponent(ticket.id)}`)}
                                className="mb-1 flex w-full items-start gap-3 rounded-2xl border border-transparent px-3 py-3 text-left transition hover:border-emerald-100 hover:bg-emerald-50/40"
                              >
                                <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
                                  <UserCheck className="size-4" aria-hidden />
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="flex items-center justify-between gap-2">
                                    <span className="truncate text-xs font-extrabold uppercase tracking-[0.06em] text-emerald-700">{ticket.number}</span>
                                    <span className={cx(
                                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                                      ticket.priority === "ALTA" ? "bg-red-50 text-red-700" : ticket.priority === "MEDIA" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600",
                                    )}>
                                      {ticket.priority === "ALTA" ? "Alta" : ticket.priority === "MEDIA" ? "Media" : "Baja"}
                                    </span>
                                  </span>
                                  <span className="mt-1 block line-clamp-2 text-sm font-bold leading-5 text-slate-950">{ticket.subject}</span>
                                  <span className="mt-1 block truncate text-xs text-slate-500">{ticket.office_name}</span>
                                </span>
                              </button>
                            ))
                          )}
                        </div>
                        <div className="border-t border-slate-100 bg-slate-50/60 p-2.5">
                          <button
                            type="button"
                            onClick={() => goFromNotifications("/soporte/mis-incidencias")}
                            className="min-h-10 w-full rounded-xl bg-white px-3 text-sm font-bold text-emerald-800 shadow-sm ring-1 ring-slate-200 transition hover:bg-emerald-50"
                          >
                            Abrir Mis incidencias
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {settingsOpen && (
                  <div id="settings-menu" className="absolute right-0 top-[calc(100%+0.65rem)] z-50 w-[min(19rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_20px_55px_rgba(15,23,42,0.18)]">
                    <div className="px-3 py-2">
                      <p className="font-bold text-tinta">Configuración</p>
                      <p className="text-xs text-tenue">Cuenta y accesos rápidos</p>
                    </div>
                    <button type="button" onClick={() => navigate("/soporte/perfil")} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-100 hover:text-slate-950">
                      <UserRound className="size-4 text-slate-500" aria-hidden /> Mi perfil
                    </button>
                    <button type="button" onClick={() => navigate("/soporte/clave")} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-100 hover:text-slate-950">
                      <KeyRound className="size-4 text-slate-500" aria-hidden /> Seguridad y contraseña
                    </button>
                    <button type="button" onClick={() => navigate("/soporte/configuracion")} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-100 hover:text-slate-950">
                      <Settings className="size-4 text-slate-500" aria-hidden /> Preferencias del sistema
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {(!online || offlinePending > 0) && (
          <div className="border-b border-linea bg-white/80">
            <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2 px-4 py-3 text-sm text-tenue sm:px-6">
              {!online ? <WifiOff className="size-4 text-casma-oscuro" /> : <CloudUpload className="size-4 text-casma-oscuro" />}
              <span className="font-bold text-tinta">{!online ? "Modo offline" : "Sincronizando cambios"}</span>
              <span>
                {offlinePending > 0
                  ? `· ${offlinePending} acción${offlinePending === 1 ? "" : "es"} pendiente${offlinePending === 1 ? "" : "s"}`
                  : !online
                    ? "· los cambios nuevos se guardarán en este dispositivo"
                    : ""}
              </span>
              {!online && offlineCachedAt && (
                <span>· mostrando copia local de {new Date(offlineCachedAt).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" })}</span>
              )}
            </div>
          </div>
        )}

        <main className="mx-auto max-w-[1600px] px-3 py-5 sm:px-6 sm:py-6 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
