import { useQueryClient } from "@tanstack/react-query";
import { Headset, LogIn } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Button, ErrorBox, Field, Input } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";

export function OfficeLogin() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api<{ status: string }>("/auth/office/login", { json: { username, password } });
      qc.removeQueries({ queryKey: ["me"] });
      const back = params.get("volver");
      navigate(res.status === "APROBADO" ? (back?.startsWith("/") ? back : "/oficina") : "/esperando", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-dvh flex-col bg-papel">
      <div className="relative overflow-hidden border-b-4 border-sol bg-casma-oscuro px-5 pb-20 pt-10 text-white sm:px-6">
        <div className="pointer-events-none absolute -right-16 -top-20 size-72 rounded-full bg-white/[0.06]" aria-hidden />
        <div className="pointer-events-none absolute -left-24 bottom-0 size-56 rounded-full bg-sol/[0.08]" aria-hidden />
        <div className="relative mx-auto flex max-w-md items-center gap-4">
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-sol text-tinta shadow-[0_10px_24px_rgba(15,23,42,0.22)]"><Headset className="size-7" aria-hidden /></span>
          <div className="min-w-0">
            <p className="text-base font-semibold text-white/80 sm:text-lg">Municipalidad Provincial de Casma</p>
            <h1 className="mt-0.5 text-3xl font-bold tracking-[-0.03em]">Soporte TI</h1>
          </div>
        </div>
      </div>
      <div className="relative -mt-11 flex-1 px-4 pb-10">
        <form onSubmit={submit} className="mx-auto flex max-w-md flex-col gap-6 rounded-2xl border border-linea bg-white p-5 text-lg shadow-[0_18px_50px_rgba(15,23,42,0.12)] sm:rounded-3xl sm:p-8">
          <div>
            <div className="mb-2 flex items-center gap-2" aria-hidden>
              <span className="h-1.5 w-9 rounded-full bg-casma" />
              <span className="h-1.5 w-3 rounded-full bg-sol" />
            </div>
            <p className="text-xl font-bold text-tinta">Ingreso de oficina</p>
            <p className="mt-1 text-base text-tenue">Use las credenciales asignadas a su oficina.</p>
          </div>
          <Field label="Usuario de la oficina">
            {(id) => <Input id={id} value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoComplete="username" required className="h-14 text-lg sm:text-xl" />}
          </Field>
          <Field label="Contraseña">
            {(id) => (
              <div className="flex flex-col gap-2">
                <Input id={id} type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required className="h-14 text-lg sm:text-xl" />
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-1 text-base text-tinta">
                  <input type="checkbox" className="size-6 accent-casma" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} />
                  Mostrar contraseña
                </label>
              </div>
            )}
          </Field>
          {error && <ErrorBox message={error} />}
          <Button type="submit" size="xl" loading={loading}><LogIn className="size-6" /> Ingresar</Button>
        </form>
        <p className="mx-auto mt-6 max-w-md text-center text-sm leading-6 text-tenue sm:text-base">
          ¿Olvidó el usuario? Comuníquese con Soporte TI.
          <br />
          <Link to="/soporte/ingresar" className="mt-3 inline-flex min-h-10 items-center font-bold text-casma-oscuro underline decoration-casma/40 underline-offset-4">Acceso del personal de soporte</Link>
        </p>
      </div>
    </main>
  );
}
