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
    <main className="flex min-h-dvh flex-col">
      <div className="bg-tinta px-6 pb-16 pt-10 text-white">
        <div className="mx-auto flex max-w-md items-center gap-4">
          <span className="grid size-14 place-items-center rounded-2xl bg-casma"><Headset className="size-8" aria-hidden /></span>
          <div>
            <p className="text-lg text-white/75">Municipalidad Provincial de Casma</p>
            <h1 className="text-3xl font-bold">Soporte TI</h1>
          </div>
        </div>
      </div>
      <div className="-mt-10 flex-1 px-4">
        <form onSubmit={submit} className="mx-auto flex max-w-md flex-col gap-6 rounded-3xl border border-linea bg-white p-6 text-lg shadow-sm sm:p-8">
          <p className="text-xl">Ingrese con el usuario de su oficina.</p>
          <Field label="Usuario de la oficina">
            {(id) => <Input id={id} value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoComplete="username" required className="h-14 text-xl" />}
          </Field>
          <Field label="Contraseña">
            {(id) => (
              <div className="flex flex-col gap-2">
                <Input id={id} type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required className="h-14 text-xl" />
                <label className="flex items-center gap-3 text-base">
                  <input type="checkbox" className="size-6 accent-casma" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} />
                  Mostrar contraseña
                </label>
              </div>
            )}
          </Field>
          {error && <ErrorBox message={error} />}
          <Button type="submit" size="xl" loading={loading}><LogIn className="size-7" /> Ingresar</Button>
        </form>
        <p className="mx-auto mt-6 max-w-md text-center text-tenue">
          ¿Olvidó el usuario? Llame a Soporte TI.
          <br />
          <Link to="/soporte/ingresar" className="mt-4 inline-block text-sm underline">Acceso del personal de soporte</Link>
        </p>
      </div>
    </main>
  );
}
