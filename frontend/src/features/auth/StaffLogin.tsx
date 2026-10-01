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
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-casma-oscuro px-4 py-10">
      <div className="pointer-events-none absolute -left-24 top-10 size-80 rounded-full bg-white/[0.05]" aria-hidden />
      <div className="pointer-events-none absolute -right-20 bottom-0 size-72 rounded-full bg-sol/[0.08]" aria-hidden />
      <div className="relative w-full max-w-md rounded-xl border border-white/10 bg-white p-5 shadow-[0_28px_80px_rgba(15,23,42,0.3)] sm:rounded-xl sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-sol text-tinta shadow-sm"><KeyRound className="size-6" /></span>
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-casma-oscuro">Help Desk Municipal</p>
            <h1 className="mt-0.5 text-2xl font-bold tracking-[-0.025em] text-tinta">Personal de Soporte TI</h1>
            <p className="mt-0.5 text-sm text-tenue">Acceso seguro con verificación en dos pasos</p>
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
              <div className="flex flex-col gap-3 rounded-xl border border-casma/15 bg-casma-claro p-4">
                <p className="flex items-center gap-2 font-bold text-casma-oscuro"><ShieldCheck className="size-5" /> Configure su app autenticadora</p>
                <p className="text-sm leading-5 text-tenue">Escanee el código con Google Authenticator, Microsoft Authenticator o una app compatible.</p>
                {stage.qr && <img src={stage.qr} alt="Código QR para la verificación en dos pasos" className="mx-auto size-48 rounded-lg border border-linea bg-white p-2" />}
                <p className="break-all text-center text-sm text-tinta">Clave manual: <strong>{stage.secret}</strong></p>
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
        <Link to="/ingresar" className="mt-6 flex min-h-10 items-center justify-center text-center text-sm font-semibold text-casma-oscuro underline decoration-casma/40 underline-offset-4">Acceso de oficinas</Link>
      </div>
    </main>
  );
}
