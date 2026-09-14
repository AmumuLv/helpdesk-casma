import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router";
import { Button, ErrorBox, Field, Input, Spinner } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { useMe } from "../../lib/session";

export function ChangePassword() {
  const { data: me, isLoading } = useMe();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();

  if (isLoading) return <Spinner />;
  if (me?.kind !== "staff") return <Navigate to="/soporte/ingresar" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== repeat) return setError("Las contraseñas no coinciden.");
    setError(null);
    setLoading(true);
    try {
      await api("/auth/staff/password", { json: { current_password: current, new_password: next } });
      await qc.invalidateQueries({ queryKey: ["me"] });
      navigate("/soporte", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-tinta px-4">
      <form onSubmit={submit} className="flex w-full max-w-md flex-col gap-4 rounded-3xl bg-white p-6 sm:p-8">
        <h1 className="text-2xl font-bold">Cambie su contraseña</h1>
        <p className="text-tenue">Mínimo 12 caracteres con mayúsculas, minúsculas, números y símbolos.</p>
        <Field label="Contraseña actual">{(id) => <Input id={id} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />}</Field>
        <Field label="Nueva contraseña">{(id) => <Input id={id} type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={12} required />}</Field>
        <Field label="Repita la nueva contraseña">{(id) => <Input id={id} type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" required />}</Field>
        {error && <ErrorBox message={error} />}
        <Button type="submit" size="lg" loading={loading}>Guardar contraseña</Button>
      </form>
    </main>
  );
}
