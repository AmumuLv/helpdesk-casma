import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Button, ErrorBox, Field, Input } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import type { Me } from "../../lib/types";

type Stage = { kind: "password" } | { kind: "verify"; token: string } | { kind: "setup"; token: string; qr?: string; secret?: string };

export function StaffLogin() {
  const [stage, setStage] = useState<Stage>({ kind: "password" });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setLoading(true);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const res = await api<{ mfa_token: string; mfa_setup_required: boolean }>("/auth/staff/login", { json: { username, password } });
      setPassword("");
      if (!res.mfa_setup_required) return setStage({ kind: "verify", token: res.mfa_token });
      const setup = await api<{ qr_data_uri: string; secret: string }>("/auth/staff/mfa/setup", { json: { mfa_token: res.mfa_token } });
      setStage({ kind: "setup", token: res.mfa_token, qr: setup.qr_data_uri, secret: setup.secret });
    });
  };

  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    if (stage.kind === "password") return;
    run(async () => {
      const me = await api<Me>("/auth/staff/mfa/verify", { json: { mfa_token: stage.token, code } });
      qc.setQueryData(["me"], me);
      navigate(me.staff?.must_change_password ? "/soporte/clave" : "/soporte", { replace: true });
    });
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-tinta px-4 py-10">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-xl bg-tinta text-white"><KeyRound className="size-6" /></span>
          <div>
            <h1 className="text-2xl font-bold">Personal de Soporte TI</h1>
            <p className="text-tenue">Acceso con verificación en dos pasos</p>
          </div>
        </div>

        {stage.kind === "password" ? (
          <form onSubmit={submitPassword} className="flex flex-col gap-4">
            <Field label="Usuario">{(id) => <Input id={id} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" required />}</Field>
            <Field label="Contraseña">{(id) => <Input id={id} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />}</Field>
            {error && <ErrorBox message={error} />}
            <Button type="submit" size="lg" loading={loading}>Continuar</Button>
          </form>
        ) : (
          <form onSubmit={submitCode} className="flex flex-col gap-4">
            {stage.kind === "setup" && (
              <div className="flex flex-col gap-3 rounded-2xl bg-papel p-4">
                <p className="flex items-center gap-2 font-bold"><ShieldCheck className="size-5 text-casma" /> Configure su app autenticadora</p>
                <p className="text-sm text-tenue">Escanee el código con Google Authenticator, Microsoft Authenticator o similar.</p>
                {stage.qr && <img src={stage.qr} alt="Código QR para la verificación en dos pasos" className="mx-auto size-48 rounded-lg bg-white p-2" />}
                <p className="break-all text-center text-sm">Clave manual: <strong>{stage.secret}</strong></p>
              </div>
            )}
            <Field label="Código de 6 dígitos">
              {(id) => <Input id={id} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" required className="h-14 text-center text-2xl tracking-[0.4em]" autoFocus />}
            </Field>
            {error && <ErrorBox message={error} />}
            <Button type="submit" size="lg" loading={loading} disabled={code.length !== 6}>Verificar</Button>
            <Button type="button" variant="ghost" onClick={() => { setStage({ kind: "password" }); setCode(""); }}>Volver</Button>
          </form>
        )}
        <Link to="/ingresar" className="mt-6 block text-center text-sm text-tenue underline">Acceso de oficinas</Link>
      </div>
    </main>
  );
}
