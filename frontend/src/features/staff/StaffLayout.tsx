import { BrainCircuit, Building2, ClipboardList, CloudUpload, Headset, LogOut, MonitorSmartphone, Monitor, ScrollText, ShieldCheck, Users, WifiOff, type LucideIcon } from "lucide-react";
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
    <div className="min-h-dvh bg-papel">
      <header className="sticky top-0 z-30 shadow-[0_10px_30px_rgba(23,32,51,0.08)]">
        <div className="bg-tinta text-white">
          <div className="mx-auto flex max-w-[1540px] items-center gap-4 px-4 py-3.5 sm:px-6">
            <div className="flex min-w-0 items-center gap-3.5">
              <span className="relative grid size-11 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.07] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                <Headset className="size-5 text-white" aria-hidden />
                <span className="absolute -bottom-1 -right-1 size-3 rounded-full border-2 border-tinta bg-sol" aria-hidden />
              </span>
              <div className="min-w-0 leading-tight">
                <p className="truncate text-[15px] font-extrabold tracking-[-0.02em] sm:text-base">Help Desk Municipal</p>
                <p className="mt-1 truncate text-[11px] font-medium text-white/58 sm:text-xs">Municipalidad Provincial de Casma</p>
              </div>
            </div>

            <div className="ml-auto flex items-center gap-2.5">
              <div className="hidden items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.055] px-3 py-2 shadow-sm sm:flex">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-casma text-xs font-extrabold text-white shadow-sm">{initials}</span>
                <div className="min-w-0 leading-tight">
                  <p className="max-w-52 truncate text-sm font-bold text-white">{me?.staff?.full_name}</p>
                  <div className="mt-1 flex items-center gap-1.5">
                    <ShieldCheck className="size-3 text-sol" aria-hidden />
                    <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/50">{isAdmin ? "Administrador" : "Técnico"}</span>
                  </div>
                </div>
              </div>

              <button
                onClick={async () => { await logout(); navigate("/soporte/ingresar"); }}
                className="flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm font-bold text-white/78 transition-all hover:border-white/20 hover:bg-white/10 hover:text-white focus-visible:ring-4 focus-visible:ring-casma/20"
                aria-label="Cerrar sesión"
                title="Cerrar sesión"
              >
                <LogOut className="size-4" />
                <span className="hidden md:inline">Salir</span>
              </button>
            </div>
          </div>
        </div>

        <div className="border-b border-linea bg-white/95 backdrop-blur-sm">
          <nav className="mx-auto flex max-w-[1540px] gap-1 overflow-x-auto px-3 py-2.5 sm:px-5" aria-label="Secciones">
            {NAV.filter((n) => !n.admin || isAdmin).map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) => cx(
                  "group relative flex shrink-0 items-center gap-2 rounded-xl border px-2.5 py-2 text-sm font-bold transition-all duration-150",
                  isActive
                    ? "border-casma/20 bg-casma-claro text-casma-oscuro shadow-[0_3px_10px_rgba(23,32,51,0.06)]"
                    : "border-transparent text-tenue hover:border-linea hover:bg-papel hover:text-tinta",
                )}
              >
                {({ isActive }) => (
                  <>
                    <span className={cx(
                      "grid size-7 place-items-center rounded-lg transition-all",
                      isActive
                        ? "bg-white text-casma-oscuro shadow-sm ring-1 ring-casma/10"
                        : "bg-papel text-tenue group-hover:bg-white group-hover:text-casma-oscuro",
                    )}>
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <span>{label}</span>
                    {to === "/soporte/dispositivos" && pendingCount > 0 && (
                      <span className="rounded-full bg-sol-claro px-1.5 py-0.5 text-[11px] font-extrabold leading-none text-[#765b00] ring-1 ring-sol/20">{pendingCount}</span>
                    )}
                    {isActive && <span className="absolute inset-x-3 -bottom-2.5 h-0.5 rounded-full bg-casma" aria-hidden />}
                  </>
                )}
              </NavLink>
            ))}
          </nav>
        </div>

        {(!online || offlinePending > 0) && (
          <div className="border-b border-linea bg-sol-claro/80 text-tinta">
            <div className="mx-auto flex max-w-[1540px] flex-wrap items-center gap-2 px-4 py-2 text-sm sm:px-6">
              {!online ? <WifiOff className="size-4 text-[#806000]" /> : <CloudUpload className="size-4 text-[#806000]" />}
              <span className="font-bold">{!online ? "Modo offline" : "Sincronizando cambios"}</span>
              <span className="text-tenue">
                {offlinePending > 0
                  ? `· ${offlinePending} acción${offlinePending === 1 ? "" : "es"} pendiente${offlinePending === 1 ? "" : "s"}`
                  : !online
                    ? "· los cambios nuevos se guardarán en este dispositivo"
                    : ""}
              </span>
              {!online && offlineCachedAt && (
                <span className="text-tenue">· mostrando copia local de {new Date(offlineCachedAt).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" })}</span>
              )}
            </div>
          </div>
        )}

        <div className="h-[3px] bg-gradient-to-r from-casma via-casma to-sol" aria-hidden />
      </header>

      <main className="mx-auto max-w-[1540px] px-3 py-6 sm:px-5 sm:py-7 lg:px-6 lg:py-8">
        <Outlet />
      </main>
    </div>
  );
}
