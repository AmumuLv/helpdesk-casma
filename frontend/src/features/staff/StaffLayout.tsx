import { BrainCircuit, Building2, ClipboardList, CloudUpload, Headset, LogOut, MonitorSmartphone, Monitor, ScrollText, Users, WifiOff, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { useToast } from "../../components/Toasts";
import { cx } from "../../components/ui";
import { useLiveEvents, useLogout, useMe, type LiveEvent } from "../../lib/session";
import { useDevices } from "./hooks";

type NavItem = { to: string; label: string; icon: LucideIcon; admin?: boolean; end?: boolean };
const NAV: NavItem[] = [
  { to: "/soporte", label: "Incidencias", icon: ClipboardList, end: true },
  { to: "/soporte/equipos", label: "Equipos", icon: Monitor },
  { to: "/soporte/ia", label: "Análisis IA", icon: BrainCircuit },
  { to: "/soporte/dispositivos", label: "Dispositivos", icon: MonitorSmartphone, admin: true },
  { to: "/soporte/oficinas", label: "Oficinas", icon: Building2, admin: true },
  { to: "/soporte/organizacion", label: "Organización", icon: Users },
  { to: "/soporte/personal", label: "Personal TI", icon: Users, admin: true },
  { to: "/soporte/auditoria", label: "Auditoría", icon: ScrollText, admin: true },
];

export function StaffLayout() {
  const { data: me } = useMe();
  const isAdmin = me?.staff?.role === "ADMIN";
  const pending = useDevices("PENDIENTE", isAdmin);
  const pendingCount = isAdmin ? pending.data?.length ?? 0 : 0;
  const logout = useLogout();
  const navigate = useNavigate();
  const toast = useToast();
  const [online, setOnline] = useState(() => navigator.onLine);
  const [offlinePending, setOfflinePending] = useState(0);
  const [offlineCachedAt, setOfflineCachedAt] = useState<number | null>(() => {
    const value = localStorage.getItem("helpdesk_offline_cached_at");
    const parsed = value ? Number(value) : 0;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  });

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
        toast({
          tone: "success",
          title: "Cambio sincronizado",
          body: detail.payload?.number ? `Se actualizó ${detail.payload.number}.` : "La acción pendiente se envió al servidor.",
        });
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

  const initials = me?.staff?.full_name
    ? me.staff.full_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()
    : "TI";

  return (
    <div className="min-h-dvh bg-papel/75">
      <header className="sticky top-0 z-30 border-b border-casma-oscuro bg-casma-oscuro text-white shadow-[0_12px_34px_rgba(20,83,45,0.18)]">
        <div className="border-b border-white/10 bg-gradient-to-r from-casma-oscuro via-[#176333] to-casma-oscuro">
          <div className="mx-auto flex max-w-[1500px] items-center gap-4 px-4 py-3 sm:px-5">
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-2xl border border-white/15 bg-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                <Headset className="size-5 text-sol" aria-hidden />
              </span>
              <div className="leading-tight">
                <p className="text-base font-extrabold tracking-[-0.02em]">Help Desk Municipal</p>
                <p className="mt-0.5 text-xs font-medium text-white/68">Municipalidad Provincial de Casma</p>
              </div>
            </div>

            <div className="ml-auto flex items-center gap-2 sm:gap-3">
              <div className="hidden items-center gap-2.5 rounded-2xl border border-white/10 bg-black/10 px-3 py-2 sm:flex">
                <span className="grid size-8 place-items-center rounded-xl bg-white/12 text-xs font-extrabold text-sol">{initials}</span>
                <div className="text-right leading-tight">
                  <p className="max-w-48 truncate text-sm font-bold">{me?.staff?.full_name}</p>
                  <p className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.08em] text-white/55">{isAdmin ? "Administrador" : "Técnico"}</p>
                </div>
              </div>
              <button
                onClick={async () => { await logout(); navigate("/soporte/ingresar"); }}
                className="flex items-center gap-2 rounded-xl border border-transparent px-3 py-2 text-sm font-bold text-white/82 transition hover:border-white/15 hover:bg-white/10 hover:text-white focus-visible:ring-4 focus-visible:ring-sol/25"
                aria-label="Cerrar sesión"
              >
                <LogOut className="size-4" /> <span className="hidden md:inline">Salir</span>
              </button>
            </div>
          </div>
        </div>

        <nav className="mx-auto flex max-w-[1500px] gap-1.5 overflow-x-auto px-3 py-2.5 sm:px-5" aria-label="Secciones">
          {NAV.filter((n) => !n.admin || isAdmin).map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => cx(
                "group relative flex shrink-0 items-center gap-2 rounded-xl px-2.5 py-2 text-sm font-bold transition-all duration-150",
                isActive
                  ? "bg-white text-casma-oscuro shadow-[0_5px_14px_rgba(0,0,0,0.13)] ring-1 ring-black/5"
                  : "text-white/72 hover:bg-white/10 hover:text-white",
              )}
            >
              {({ isActive }) => (
                <>
                  <span className={cx(
                    "grid size-7 place-items-center rounded-lg transition-all",
                    isActive ? "bg-casma-claro text-casma-oscuro" : "bg-white/7 text-white/75 group-hover:bg-white/12 group-hover:text-white",
                  )}>
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span>{label}</span>
                  {to === "/soporte/dispositivos" && pendingCount > 0 && (
                    <span className="rounded-full bg-sol px-1.5 py-0.5 text-[11px] font-extrabold leading-none text-tinta">{pendingCount}</span>
                  )}
                  {isActive && <span className="absolute inset-x-3 -bottom-2.5 h-0.5 rounded-full bg-sol" aria-hidden />}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {(!online || offlinePending > 0) && (
          <div className="border-t border-white/10 bg-black/10">
            <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-2 px-4 py-2 text-sm sm:px-5">
              {!online ? <WifiOff className="size-4 text-sol" /> : <CloudUpload className="size-4 text-sol" />}
              <span className="font-bold">{!online ? "Modo offline" : "Sincronizando cambios"}</span>
              <span className="text-white/70">
                {offlinePending > 0
                  ? `· ${offlinePending} acción${offlinePending === 1 ? "" : "es"} pendiente${offlinePending === 1 ? "" : "s"}`
                  : !online
                    ? "· los cambios nuevos se guardarán en este dispositivo"
                    : ""}
              </span>
              {!online && offlineCachedAt && (
                <span className="text-white/60">· mostrando copia local de {new Date(offlineCachedAt).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" })}</span>
              )}
            </div>
          </div>
        )}

        <div className="h-1 bg-gradient-to-r from-sol via-[#f6cf45] to-sol" aria-hidden />
      </header>

      <main className="mx-auto max-w-[1500px] px-3 py-6 sm:px-5 sm:py-7 lg:py-8">
        <Outlet />
      </main>
    </div>
  );
}
