import { useQueryClient } from "@tanstack/react-query";
import { Phone, ShieldCheck } from "lucide-react";
import { useEffect } from "react";
import { Navigate } from "react-router";
import { Button, Spinner } from "../../components/ui";
import { useLogout, useMe } from "../../lib/session";

export function DevicePending() {
  const { data: me, isLoading } = useMe();
  const qc = useQueryClient();
  const logout = useLogout();

  useEffect(() => {
    const timer = setInterval(() => qc.invalidateQueries({ queryKey: ["me"] }), 5000);
    return () => clearInterval(timer);
  }, [qc]);

  if (isLoading) return <Spinner />;
  if (me?.kind !== "office" || !me.office) return <Navigate to="/ingresar" replace />;
  if (me.office.device_status === "APROBADO") return <Navigate to="/oficina" replace />;

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-8 px-5 py-10 text-center text-lg">
      <ShieldCheck className="mx-auto size-20 text-casma" aria-hidden />
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold">Falta un paso</h1>
        <p className="text-xl">Soporte TI debe autorizar este equipo antes de usarlo. Llame y dicte este código:</p>
      </div>
      <p className="rounded-3xl border-4 border-dashed border-casma bg-white whitespace-nowrap py-8 text-5xl font-bold tracking-widest text-tinta sm:text-6xl" aria-label={`Código ${me.office.pair_code?.split("").join(" ")}`}>
        {me.office.pair_code}
      </p>
      <p className="flex items-center justify-center gap-2 text-tenue"><Phone className="size-5" /> Esta pantalla se actualizará sola cuando lo autoricen.</p>
      <Button variant="ghost" onClick={logout}>Salir</Button>
    </main>
  );
}
