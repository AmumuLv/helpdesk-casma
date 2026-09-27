import { Bell, BrainCircuit, Building2, ClipboardList, CloudUpload, Headset, KeyRound, LogOut, Menu, MonitorSmartphone, Monitor, Plus, ScrollText, Search, Settings, UserRound, Users, WifiOff, X, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useToast } from "../../components/Toasts";
import { cx, Input } from "../../components/ui";
import { useLiveEvents, useLogout, useMe, type LiveEvent } from "../../lib/session";
import { useDevices } from "./hooks";

type NavItem = { to: string; label: string; icon: LucideIcon; admin?: boolean; end?: boolean; section: "Operación" | "Administración" };
type PanelNotification = { id: string; title: string; body?: string; tone: "info" | "danger" | "success"; createdAt: number };

const NAV: NavItem[] = [
  { to: "/soporte", label: "Incidencias", icon: ClipboardList, end: true, section: "Operación" },
  { to: "/soporte/equipos", label: "Equipos", icon: Monitor, section: "Operación" },
  { to: "/soporte/ia", label: "Análisis IA", icon: BrainCircuit, section: "Operación" },
  { to: "/soporte/dispositivos", label: "Dispositivos", icon: MonitorSmartphone, admin: true, section: "Administración" },
  { to: "/soporte/oficinas", label: "Oficinas", icon: Building2, admin: true, section: "Administración" },
  { to: "/soporte/organizacion", label: "Organización", icon: Users, section: "Administración" },
  { to: "/soporte/personal", label: "Personal TI", icon: Users, admin: true, section: "Administración" },
  { to: "/soporte/auditoria", label: "Auditoría", icon: ScrollText, admin: true, section: "Administración" },
];

const readSetting = (key: string, fallback = true) => {
  const value = localStorage.getItem(key);
  if (value === null) return fallback;
  return value !== "false";
};

export function StaffLayout() {
  const { data: me } = useMe();
  const isAdmin = me?.staff?.role === "ADMIN";
  const pending = useDevices("PENDIENTE", isAdmin);
  const pendingCount = isAdmin ? pending.data?.length ?? 0 : 0;
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
  const [panelNotifications, setPanelNotifications] = useState<PanelNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => readSetting("helpdesk_notifications_enabled"));
  const [showConnection, setShowConnection] = useState(() => readSetting("helpdesk_show_connection"));

  const addPanelNotification = useCallback((notification: Omit<PanelNotification, "id" | "createdAt">) => {
    const item: PanelNotification = {
      ...notification,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      createdAt: Date.now(),
    };
    setPanelNotifications((current) => [item, ...current].slice(0, 6));
    setUnreadCount((current) => Math.min(current + 1, 99));
  }, []);

  const onEvent = useCallback((e: LiveEvent) => {
    if (!notificationsEnabled) return;

    if (e.type === "ticket.created") {
      const tone = e.priority === "ALTA" ? "danger" : "info";
      toast({ tone, title: `Nueva incidencia ${e.number ?? ""}`, body: `${e.office}: ${e.subject}` });
      addPanelNotification({ tone, title: `Nueva incidencia ${e.number ?? ""}`, body: `${e.office}: ${e.subject}` });
    }
    if (e.type === "ticket.assigned") {
      toast({ tone: "info", title: `Se le asignó ${e.number}`, body: `${e.office}: ${e.subject}` });
      addPanelNotification({ tone: "info", title: `Incidencia asignada ${e.number}`, body: `${e.office}: ${e.subject}` });
    }
    if (e.type === "device.pending" && isAdmin) {
      toast({ tone: "info", title: "Equipo esperando autorización", body: `${e.office} con el código ${e.pair_code}` });
      addPanelNotification({ tone: "info", title: "Dispositivo pendiente", body: `${e.office} · código ${e.pair_code}` });
    }
    if (e.type === "alert.created") {
      toast({ tone: "danger", title: e.title ?? "Alerta", body: e.message });
      addPanelNotification({ tone: "danger", title: e.title ?? "Alerta", body: e.message });
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
  const notificationBadge = Math.min(99, unreadCount + pendingCount + (offlinePending > 0 ? 1 : 0));

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
                          {to === "/soporte/dispositivos" && pendingCount > 0 && (
                            <span className="rounded-full bg-[#EAB308] px-2 py-1 text-xs font-bold leading-none text-[#111827]">{pendingCount}</span>
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
                  className="relative grid size-10 place-items-center rounded-lg text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                  aria-label="Abrir notificaciones"
                  aria-expanded={notificationsOpen}
                  aria-controls="notifications-menu"
                  title="Notificaciones"
                  onClick={() => {
                    const next = !notificationsOpen;
                    setNotificationsOpen(next);
                    setSettingsOpen(false);
                    if (next) setUnreadCount(0);
                  }}
                >
                  <Bell className="size-5" aria-hidden />
                  {notificationBadge > 0 && (
                    <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-amber-500 px-1 text-center text-[11px] font-bold leading-5 text-[#111827] ring-2 ring-white" aria-label={`${notificationBadge} notificaciones`}>
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
                  <div id="notifications-menu" className="absolute right-0 top-[calc(100%+0.65rem)] z-50 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_20px_55px_rgba(15,23,42,0.18)]">
                    <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                      <div>
                        <p className="font-bold text-tinta">Notificaciones</p>
                        <p className="text-xs text-tenue">Actividad importante del Help Desk</p>
                      </div>
                      {panelNotifications.length > 0 && (
                        <button type="button" className="text-xs font-bold text-casma-oscuro hover:underline" onClick={() => setPanelNotifications([])}>
                          Limpiar
                        </button>
                      )}
                    </div>
                    <div className="max-h-[26rem] overflow-y-auto p-2">
                      {pendingCount > 0 && (
                        <button
                          type="button"
                          onClick={() => navigate("/soporte/dispositivos")}
                          className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-amber-50"
                        >
                          <span className="mt-1.5 size-2.5 shrink-0 rounded-full bg-amber-500" />
                          <span>
                            <span className="block text-sm font-bold text-tinta">{pendingCount} dispositivo{pendingCount === 1 ? "" : "s"} pendiente{pendingCount === 1 ? "" : "s"}</span>
                            <span className="mt-0.5 block text-xs leading-5 text-tenue">Requiere autorización del administrador.</span>
                          </span>
                        </button>
                      )}
                      {offlinePending > 0 && (
                        <div className="flex items-start gap-3 rounded-xl px-3 py-3">
                          <span className="mt-1.5 size-2.5 shrink-0 rounded-full bg-sky-500" />
                          <span>
                            <span className="block text-sm font-bold text-tinta">{offlinePending} cambio{offlinePending === 1 ? "" : "s"} por sincronizar</span>
                            <span className="mt-0.5 block text-xs leading-5 text-tenue">Se enviará al servidor cuando haya conexión.</span>
                          </span>
                        </div>
                      )}
                      {panelNotifications.map((notification) => (
                        <div key={notification.id} className="flex items-start gap-3 rounded-xl px-3 py-3 hover:bg-slate-50">
                          <span className={cx("mt-1.5 size-2.5 shrink-0 rounded-full", notification.tone === "danger" ? "bg-red-500" : notification.tone === "success" ? "bg-emerald-500" : "bg-sky-500")} />
                          <span className="min-w-0">
                            <span className="block text-sm font-bold text-tinta">{notification.title}</span>
                            {notification.body && <span className="mt-0.5 block text-xs leading-5 text-tenue">{notification.body}</span>}
                            <span className="mt-1 block text-[11px] font-medium text-slate-400">{new Date(notification.createdAt).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}</span>
                          </span>
                        </div>
                      ))}
                      {pendingCount === 0 && offlinePending === 0 && panelNotifications.length === 0 && (
                        <div className="px-4 py-8 text-center">
                          <Bell className="mx-auto size-6 text-slate-400" aria-hidden />
                          <p className="mt-2 text-sm font-bold text-tinta">Sin novedades</p>
                          <p className="mt-1 text-xs leading-5 text-tenue">Las nuevas incidencias y alertas aparecerán aquí.</p>
                        </div>
                      )}
                    </div>
                    <div className="border-t border-slate-200 p-2">
                      <button type="button" onClick={() => navigate("/soporte")} className="min-h-10 w-full rounded-lg text-sm font-bold text-casma-oscuro transition hover:bg-casma-claro">
                        Ver incidencias
                      </button>
                    </div>
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
