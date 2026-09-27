import { BrainCircuit, Building2, ClipboardList, CloudUpload, Headset, LogOut, Menu, MonitorSmartphone, Monitor, Plus, ScrollText, Search, ShieldCheck, Users, WifiOff, X, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useToast } from "../../components/Toasts";
import { cx, Input } from "../../components/ui";
import { useLiveEvents, useLogout, useMe, type LiveEvent } from "../../lib/session";
import { useDevices } from "./hooks";

type NavItem = { to: string; label: string; icon: LucideIcon; admin?: boolean; end?: boolean; section: "Operación" | "Administración" };
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

export function StaffLayout() {
  const { data: me } = useMe();
  const isAdmin = me?.staff?.role === "ADMIN";
  const pending = useDevices("PENDIENTE", isAdmin);
  const pendingCount = isAdmin ? pending.data?.length ?? 0 : 0;
  const logout = useLogout();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [online, setOnline] = useState(() => navigator.onLine);
  const [offlinePending, setOfflinePending] = useState(0);
  const [offlineCachedAt, setOfflineCachedAt] = useState<number | null>(() => {
    const value = localStorage.getItem("helpdesk_offline_cached_at");
    const parsed = value ? Number(value) : 0;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [headerSearch, setHeaderSearch] = useState(() => new URLSearchParams(location.search).get("q") ?? "");

  const onEvent = useCallback((e: LiveEvent) => {
    if (e.type === "ticket.created") toast({ tone: e.priority === "ALTA" ? "danger" : "info", title: `Nueva incidencia ${e.number ?? ""}`, body: `${e.office}: ${e.subject}` });
    if (e.type === "ticket.assigned") toast({ tone: "info", title: `Se le asignó ${e.number}`, body: `${e.office}: ${e.subject}` });
    if (e.type === "device.pending" && isAdmin) toast({ tone: "info", title: "Equipo esperando autorización", body: `${e.office} con el código ${e.pair_code}` });
    if (e.type === "alert.created") toast({ tone: "danger", title: e.title ?? "Alerta", body: e.message });
  }, [toast, isAdmin]);
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
    setSidebarOpen(false);
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

  return (
    <div className="min-h-dvh bg-papel text-tinta">
      <div
        className={cx("fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-sm transition lg:hidden", sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0")}
        onClick={() => setSidebarOpen(false)}
      />

      <aside className={cx(
        "fixed inset-y-0 left-0 z-50 flex w-[17rem] flex-col bg-casma-oscuro text-white shadow-2xl transition-transform duration-200 lg:w-64 lg:translate-x-0 xl:w-72",
        sidebarOpen ? "translate-x-0" : "-translate-x-full",
      )}>
        <div className="flex items-center justify-between border-b-2 border-sol/70 px-5 py-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-sol text-tinta shadow-[0_6px_16px_rgba(15,23,42,0.18)]">
              <Headset className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="truncate text-base font-bold tracking-[-0.02em]">Help Desk Municipal</p>
              <p className="mt-0.5 truncate text-xs font-medium text-white/75">Municipalidad Provincial de Casma</p>
            </div>
          </div>
          <button className="grid size-11 shrink-0 place-items-center rounded-xl text-white/80 hover:bg-white/10 hover:text-white lg:hidden" onClick={() => setSidebarOpen(false)} aria-label="Cerrar menú">
            <X className="size-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-5 xl:px-4" aria-label="Navegación principal">
          {groups.map((group) => {
            const items = NAV.filter((item) => item.section === group && (!item.admin || isAdmin));
            if (!items.length) return null;
            return (
              <div key={group} className="mb-6">
                <p className="mb-2 px-3 text-xs font-bold uppercase tracking-[0.12em] text-white/65">{group}</p>
                <div className="space-y-1.5">
                  {items.map(({ to, label, icon: Icon, end }) => (
                    <NavLink
                      key={to}
                      to={to}
                      end={end}
                      className={({ isActive }) => cx(
                        "group flex min-h-12 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all duration-150",
                        isActive
                          ? "bg-white text-casma-oscuro shadow-[0_8px_20px_rgba(15,23,42,0.18)]"
                          : "text-white/85 hover:bg-white/10 hover:text-white",
                      )}
                    >
                      {({ isActive }) => (
                        <>
                          <span className={cx(
                            "grid size-9 shrink-0 place-items-center rounded-lg transition-all",
                            isActive ? "bg-casma-claro text-casma-oscuro" : "bg-white/10 text-white/90 group-hover:bg-white/15 group-hover:text-white",
                          )}>
                            <Icon className="size-4.5" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1 truncate">{label}</span>
                          {to === "/soporte/dispositivos" && pendingCount > 0 && (
                            <span className="rounded-full bg-sol px-2 py-1 text-xs font-bold leading-none text-tinta">{pendingCount}</span>
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

        <div className="border-t border-white/15 p-3 xl:p-4">
          <div className="rounded-2xl border border-white/15 bg-white/10 p-3">
            <div className="flex items-center gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-sol font-bold text-tinta">{initials}</span>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-white">{me?.staff?.full_name ?? "Administrador TI"}</p>
                <div className="mt-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-white/75">
                  <ShieldCheck className="size-3.5 text-yellow-300" /> {isAdmin ? "Administrador TI" : "Técnico"}
                </div>
              </div>
            </div>
          </div>
          <button
            onClick={closeSession}
            className="mt-3 flex min-h-11 w-full items-center justify-start gap-2 rounded-xl border border-white/10 bg-black/5 px-3 text-sm font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
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
              className="grid size-11 shrink-0 place-items-center rounded-xl border border-linea bg-white text-tinta shadow-sm hover:border-casma/35 hover:text-casma-oscuro lg:hidden"
              onClick={() => setSidebarOpen(true)}
              aria-label="Abrir menú"
            >
              <Menu className="size-5" />
            </button>

            <form onSubmit={submitHeaderSearch} role="search" className="relative min-w-0 flex-1 lg:max-w-3xl">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-tenue" aria-hidden />
              <Input
                value={headerSearch}
                onChange={(event) => setHeaderSearch(event.target.value)}
                placeholder="Buscar incidencias, equipos, oficinas o usuarios"
                aria-label="Buscar en el sistema"
                className="h-12 bg-[#F3F4F6] pl-11 pr-4 shadow-none hover:border-slate-400 focus:bg-white"
              />
            </form>

            <button
              onClick={openNewTicket}
              className="inline-flex min-h-12 shrink-0 items-center gap-2 rounded-xl border border-[#0F766E] bg-[#0D9488] px-3.5 text-sm font-bold text-white shadow-[0_8px_20px_rgba(13,148,136,0.22)] transition hover:bg-[#0F766E] sm:px-4"
              aria-label="Nueva incidencia"
            >
              <Plus className="size-4" />
              <span className="hidden sm:inline">Nueva incidencia</span>
              <span className="sm:hidden">Nueva</span>
            </button>

            <div className="hidden items-center gap-3 rounded-xl border border-linea bg-white px-3 py-2 shadow-sm md:flex">
              <span className="grid size-10 place-items-center rounded-xl bg-[#CCFBF1] text-sm font-bold text-[#115E59]">{initials}</span>
              <div className="min-w-0">
                <p className="max-w-44 truncate text-sm font-bold text-tinta">{me?.staff?.full_name ?? "Administrador TI"}</p>
                <p className="text-xs font-medium text-tenue">{isAdmin ? "Administrador TI" : "Técnico"}</p>
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
