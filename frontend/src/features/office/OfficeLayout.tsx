import { Headset, LogOut } from "lucide-react";
import { useCallback } from "react";
import { Link, Outlet, useNavigate } from "react-router";
import { useToast } from "../../components/Toasts";
import { useLiveEvents, useLogout, useMe, type LiveEvent } from "../../lib/session";

export function OfficeLayout() {
  const { data: me } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const toast = useToast();

  const onEvent = useCallback((e: LiveEvent) => {
    if (e.type === "ticket.resolved") toast({ tone: "success", title: "Soporte TI terminó su reporte", body: "Díganos si ya funciona." });
    if (e.type === "alert.created" && e.title) toast({ tone: "info", title: e.title, body: e.message });
  }, [toast]);
  useLiveEvents(true, onEvent);

  return (
    <div className="min-h-dvh bg-papel">
      <header className="border-b border-linea bg-casma-oscuro text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/oficina" className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-white/10">
              <Headset className="size-5 text-amber-300" aria-hidden />
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block text-xs font-medium text-white/60">Soporte TI Municipal</span>
              <span className="block truncate text-[0.95rem] font-bold">{me?.office?.name}</span>
            </span>
          </Link>
          <button
            onClick={async () => { if (confirm("¿Desea salir? Tendrá que volver a ingresar la contraseña.")) { await logout(); navigate("/ingresar"); } }}
            className="flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white/80 transition hover:bg-white/10 hover:text-white"
          >
            <LogOut className="size-4" /> Salir
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 pb-16 pt-6">
        <Outlet />
      </main>
    </div>
  );
}
