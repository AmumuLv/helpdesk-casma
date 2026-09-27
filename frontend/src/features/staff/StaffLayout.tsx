import { BrainCircuit, Building2, ClipboardList, CloudUpload, Headset, LogOut, Menu, MonitorSmartphone, Monitor, Plus, ScrollText, Search, ShieldCheck, Users, WifiOff, X, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useToast } from "../../components/Toasts";
import { cx } from "../../components/ui";
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

const PAGE_META: { match: string; title: string; description: string }[] = [
  { match: "/soporte/equipos", title: "Equipos", description: "Inventario, activos patrimoniales y seguimiento técnico." },
  { match: "/soporte/ia", title: "Análisis IA", description: "Riesgo de fallas, tendencias y alertas inteligentes." },
  { match: "/soporte/dispositivos", title: "Dispositivos", description: "Autorización de equipos y seguimiento de acceso." },
  { match: "/soporte/oficinas", title: "Oficinas", description: "Gestión de oficinas, perfiles de servicio y sesiones." },
  { match: "/soporte/organizacion", title: "Organización", description: "Zonas, oficinas y usuarios municipales." },
  { match: "/soporte/personal", title: "Personal TI", description: "Técnicos, roles, 2FA y control de acceso." },
  { match: "/soporte/auditoria", title: "Auditoría", description: "Actividad del sistema, trazabilidad y evidencias." },
  { match: "/soporte", title: "Incidencias", description: "Seguimiento y atención de tickets del soporte municipal." },
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

  const currentPage = useMemo(
    () => PAGE_META.find((item) => location.pathname.startsWith(item.match)) ?? PAGE_META[PAGE_META.length - 1],
    [location.pathname],
  );

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

  const initials = me?.staff?.full_name
    ? me.staff.full_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()
    : "TI";

  const openNewTicket = () => navigate("/soporte?new=1");
  const groups = ["Operación", "Administración"] as const;

  return (
    <div className="min-h-dvh bg-papel text-tinta">
      <div className={cx("fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-sm transition lg:hidden", sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0")} onClick={() => setSidebarOpen(false)} />

      <aside className={cx(
        "fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-[#111827] text-white shadow-2xl transition-transform duration-200 lg:translate-x-0",
        sidebarOpen ? "translate-x-0" : "-translate-x-full",
      )}>
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-5">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-2xl bg-white/10 text-[#5eead4] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              <Headset className="size-5" aria-hidden />
            </span>
            <div>
              <p className="text-base font-extrabold tracking-[-0.02em]">Help Desk Municipal</p>
              <p className="mt-0.5 text-xs text-white/55">Municipalidad Provincial de Casma</p>
            </div>
          </div>
          <button className="rounded-xl p-2 text-white/70 hover:bg-white/10 hover:text-white lg:hidden" onClick={() => setSidebarOpen(false)} aria-label="Cerrar menú">
            <X className="size-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-4 py-5" aria-label="Navegación principal">
          {groups.map((group) => {
            const items = NAV.filter((item) => item.section === group && (!item.admin || isAdmin));
            if (!items.length) return null;
            return (
              <div key={group} className="mb-6">
                <p className="mb-2 px-3 text-[11px] font-bold uppercase tracking-[0.14em] text-white/35">{group}</p>
                <div className="space-y-1.5">
                  {items.map(({ to, label, icon: Icon, end }) => (
                    <NavLink
                      key={to}
                      to={to}
                      end={end}
                      className={({ isActive }) => cx(
                        "group flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-semibold transition-all duration-150",
                        isActive
                          ? "bg-casma text-white shadow-[0_10px_22px_rgba(13,148,136,0.25)]"
                          : "text-white/70 hover:bg-white/[0.07] hover:text-white",
                      )}
                    >
                      {({ isActive }) => (
                        <>
                          <span className={cx(
                            "grid size-9 shrink-0 place-items-center rounded-xl transition-all",
                            isActive ? "bg-white/[0.14] text-white" : "bg-white/[0.08] text-white/75 group-hover:bg-white/10 group-hover:text-white",
                          )}>
                            <Icon className="size-4" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1 truncate">{label}</span>
                          {to === "/soporte/dispositivos" && pendingCount > 0 && (
                            <span className="rounded-full bg-white/[0.16] px-2 py-0.5 text-[11px] font-extrabold leading-none text-white">{pendingCount}</span>
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

        <div className="border-t border-white/10 p-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-2xl bg-casma font-extrabold text-white shadow-[0_8px_18px_rgba(13,148,136,0.24)]">{initials}</span>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-white">{me?.staff?.full_name ?? "Administrador TI"}</p>
                <div className="mt-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-white/55">
                  <ShieldCheck className="size-3.5 text-[#5eead4]" /> {isAdmin ? "Administrador TI" : "Técnico"}
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-30 border-b border-linea bg-white/90 backdrop-blur-sm">
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-4 py-4 sm:px-6">
            <button className="rounded-xl border border-linea bg-white p-2 text-tinta shadow-sm hover:border-casma/25 hover:text-casma lg:hidden" onClick={() => setSidebarOpen(true)} aria-label="Abrir menú">
              <Menu className="size-5" />
            </button>

            <div className="hidden min-w-72 flex-1 items-center gap-3 rounded-2xl border border-linea bg-papel px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] xl:flex xl:max-w-xl">
              <Search className="size-4 text-tenue" aria-hidden />
              <input className="w-full border-0 bg-transparent text-sm text-tinta placeholder:text-tenue/70 focus:outline-none" placeholder="Buscar incidencias, equipos, oficinas o usuarios" aria-label="Buscar" />
            </div>

            <div className="min-w-0 flex-1 xl:hidden">
              <p className="truncate text-lg font-extrabold tracking-[-0.02em] text-tinta">{currentPage.title}</p>
              <p className="hidden text-sm text-tenue sm:block">{currentPage.description}</p>
            </div>

            <button onClick={openNewTicket} className="inline-flex items-center gap-2 rounded-2xl bg-casma px-4 py-3 text-sm font-bold text-white shadow-[0_12px_24px_rgba(13,148,136,0.22)] transition hover:bg-casma-oscuro hover:shadow-[0_14px_28px_rgba(15,118,110,0.28)]">
              <Plus className="size-4" /> Nueva Incidencia
            </button>

            <div className="hidden items-center gap-3 rounded-2xl border border-linea bg-white px-3 py-2 shadow-sm md:flex">
              <span className="grid size-10 place-items-center rounded-2xl bg-casma-claro text-sm font-extrabold text-casma-oscuro">{initials}</span>
              <div className="min-w-0">
                <p className="max-w-44 truncate text-sm font-bold text-tinta">{me?.staff?.full_name ?? "Administrador TI"}</p>
                <p className="text-xs font-medium text-tenue">{isAdmin ? "Administrador TI" : "Técnico"}</p>
              </div>
            </div>

            <button
              onClick={async () => { await logout(); navigate("/soporte/ingresar"); }}
              className="inline-flex items-center gap-2 rounded-2xl border border-linea bg-white px-4 py-3 text-sm font-bold text-tinta shadow-sm transition hover:border-casma/20 hover:text-casma-oscuro"
              aria-label="Cerrar sesión"
            >
              <LogOut className="size-4" /> Salir
            </button>
          </div>
        </header>

        {(!online || offlinePending > 0) && (
          <div className="border-b border-linea bg-white/75">
            <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2 px-4 py-3 text-sm text-tenue sm:px-6">
              {!online ? <WifiOff className="size-4 text-casma" /> : <CloudUpload className="size-4 text-casma" />}
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

        <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
