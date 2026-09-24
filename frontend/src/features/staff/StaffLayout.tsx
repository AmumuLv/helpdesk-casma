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
  { to: "/soporte/organizacion", label: "Organización", icon: Users, admin: true },
  { to: "/soporte/personal", label: "Personal TI", icon: Users, admin: true },
  { to: "/soporte/auditoria", label: "Auditoría", icon: ScrollText, admin: true },
];

export function StaffLayout() {
  const { data: me } = useMe();
  const isAdmin = me?.staff?.role === "ADMIN";
  const pending = useDevices(isAdmin ? "PENDIENTE" : undefined);
  const pendingCount = isAdmin ? pending.data?.length ?? 0 : 0;
  const logout = useLogout();
  const navigate = useNavigate();
  const toast = useToast();
  const [online, setOnline] = useState(() => navigator.onLine);
  const [offlinePending, setOfflinePending] = useState(0);

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
        payload?: { number?: string };
      }>).detail;

      if (detail?.type === "OFFLINE_QUEUE_CHANGED") {
        setOfflinePending(Number(detail.pending ?? 0));
      }
      if (detail?.scope === "staff" && detail.type === "OFFLINE_REQUEST_SENT") {
        toast({
          tone: "success",
          title: "Cambio sincronizado",
          body: detail.payload?.number ? `Se actualizó ${detail.payload.number}.` : "La acción pendiente se envió al servidor.",
        });
      }
      if (detail?.scope === "staff" && detail.type === "OFFLINE_REQUEST_REJECTED") {
        toast({
          tone: "danger",
          title: "No se pudo sincronizar un cambio",
          body: "El servidor rechazó una acción guardada sin conexión. Revise el ticket.",
        });
      }
      if (detail?.scope === "staff" && detail.type === "OFFLINE_REQUEST_AUTH_REQUIRED") {
        toast({
          tone: "danger",
          title: "Sincronización detenida",
          body: "Debe volver a iniciar sesión para enviar los cambios pendientes.",
        });
      }
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("helpdesk-offline-sync", onSync);
    navigator.serviceWorker?.controller?.postMessage({ type: "GET_OFFLINE_QUEUE_COUNT" });

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("helpdesk-offline-sync", onSync);
    };
  }, [toast]);

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 bg-tinta text-white shadow">
        <div className="mx-auto flex max-w-[1500px] items-center gap-4 px-4 py-2.5">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-casma"><Headset className="size-5" aria-hidden /></span>
            <div className="leading-tight">
              <p className="font-bold">Help Desk Municipal</p>
              <p className="text-xs text-white/60">Municipalidad Provincial de Casma</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right leading-tight sm:block">
              <p className="font-bold">{me?.staff?.full_name}</p>
              <p className="text-xs text-white/60">{isAdmin ? "Administrador" : "Técnico"}</p>
            </div>
            <button onClick={async () => { await logout(); navigate("/soporte/ingresar"); }} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-white/80 hover:bg-white/10" aria-label="Cerrar sesión">
              <LogOut className="size-4" /> <span className="hidden md:inline">Salir</span>
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-[1500px] gap-1 overflow-x-auto px-3 pb-2" aria-label="Secciones">
          {NAV.filter((n) => !n.admin || isAdmin).map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) => cx("flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold", isActive ? "bg-white text-tinta" : "text-white/75 hover:bg-white/10 hover:text-white")}>
              <Icon className="size-4" aria-hidden /> {label}
              {to === "/soporte/dispositivos" && pendingCount > 0 && <span className="rounded-full bg-sol px-1.5 text-xs text-tinta">{pendingCount}</span>}
            </NavLink>
          ))}
        </nav>
        {(!online || offlinePending > 0) && (
          <div className="border-t border-white/10 bg-white/10">
            <div className="mx-auto flex max-w-[1500px] items-center gap-2 px-4 py-2 text-sm">
              {!online ? <WifiOff className="size-4 text-sol" /> : <CloudUpload className="size-4 text-sol" />}
              <span className="font-bold">
                {!online ? "Sin conexión" : "Sincronizando cambios"}
              </span>
              <span className="text-white/70">
                {offlinePending > 0
                  ? `· ${offlinePending} acción${offlinePending === 1 ? "" : "es"} pendiente${offlinePending === 1 ? "" : "s"}`
                  : "· los nuevos cambios se guardarán en este dispositivo"}
              </span>
            </div>
          </div>
        )}
      </header>
      <main className="mx-auto max-w-[1500px] px-3 py-5 sm:px-5">
        <Outlet />
      </main>
    </div>
  );
}
