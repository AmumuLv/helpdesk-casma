import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Plus, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useToast } from "../../components/Toasts";
import { Badge, Button, Card, cx, ErrorBox, Field, Input, Modal, Select, Spinner } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { CATEGORIES, CATEGORY_LABEL, fmtAgo } from "../../lib/labels";
import { useMe } from "../../lib/session";
import type { StaffMember, StaffRole, TicketCategory } from "../../lib/types";
import { PageHeader } from "./PageHeader";

export function StaffPage() {
  const staff = useQuery({ queryKey: ["staff"], queryFn: () => api<StaffMember[]>("/admin/staff") });
  const [editing, setEditing] = useState<StaffMember | "new" | null>(null);
  const [secret, setSecret] = useState<{ username: string; password: string } | null>(null);

  return (
    <div>
      <PageHeader
        title="Personal TI"
        description="Cuentas del área de soporte. Cada usuario tiene su propia clave y debe activar la verificación en dos pasos."
        actions={<Button variant="primary" onClick={() => setEditing("new")}><Plus className="size-4" /> Nuevo integrante</Button>}
      />
      {staff.isLoading ? <Spinner /> : staff.error ? <ErrorBox message={errorMessage(staff.error)} /> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {staff.data?.map((s) => <StaffCard key={s.id} member={s} onEdit={() => setEditing(s)} onSecret={setSecret} />)}
        </div>
      )}
      {editing && <StaffModal member={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSecret={setSecret} />}
      <Modal open={!!secret} onClose={() => setSecret(null)} title="Contraseña temporal">
        {secret && (
          <div className="flex flex-col gap-3.5">
            <p className="text-[0.85rem] leading-6 text-tinta-2">Entréguela en persona a <strong>{secret.username}</strong>. Solo se muestra una vez: deberá cambiarla y configurar su app autenticadora al ingresar.</p>
            <p className="select-all break-all rounded-lg border border-linea bg-papel-2 p-3.5 text-center text-lg font-bold tracking-wider">{secret.password}</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setSecret(null)}>Cerrar</Button>
              <Button onClick={() => navigator.clipboard.writeText(secret.password)} variant="primary">Copiar contraseña</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function StaffCard({ member: s, onEdit, onSecret }: { member: StaffMember; onEdit: () => void; onSecret: (v: { username: string; password: string }) => void }) {
  const me = useMe().data?.staff;
  const qc = useQueryClient();
  const toast = useToast();
  const action = useMutation({
    mutationFn: (op: "reset-password" | "reset-mfa" | "unlock") => api<{ temporary_password?: string }>(`/admin/staff/${s.id}/${op}`, { method: "POST" }),
    onSuccess: (r, op) => {
      qc.invalidateQueries({ queryKey: ["staff"] });
      if (op === "reset-password" && r.temporary_password) onSecret({ username: s.username, password: r.temporary_password });
      else toast({ tone: "success", title: op === "unlock" ? "Cuenta desbloqueada" : "2FA reiniciado", body: s.full_name });
    },
    onError: (err) => toast({ tone: "danger", title: "No se pudo completar", body: errorMessage(err) }),
  });
  const self = me?.id === s.id;

  return (
    <Card className={cx("flex flex-col gap-3 p-4", !s.active && "opacity-60")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[0.95rem] font-bold text-tinta">{s.full_name}</p>
          <p className="truncate text-[0.78rem] text-tenue">{s.username}{s.phone ? ` · ${s.phone}` : ""}</p>
        </div>
        <Badge className={s.role === "ADMIN" ? "border-casma/30 bg-casma-claro text-casma-oscuro" : "border-linea bg-papel-2 text-tenue"}>{s.role === "ADMIN" ? "Administrador" : "Técnico"}</Badge>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {s.specialties.map((c) => <Badge key={c} className="border-linea bg-papel-2 text-tinta-2">{CATEGORY_LABEL[c]}</Badge>)}
        {!s.specialties.length && <span className="text-[0.78rem] text-tenue">Sin especialidades registradas</span>}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.78rem] text-tenue">
        <span className={cx("inline-flex items-center gap-1 font-semibold", s.totp_enabled ? "text-emerald-700" : "text-amber-700")}>
          <ShieldCheck className="size-3.5" aria-hidden />{s.totp_enabled ? "2FA activo" : "2FA pendiente"}
        </span>
        {s.locked && <span className="inline-flex items-center gap-1 font-bold text-alerta"><Lock className="size-3.5" aria-hidden /> Bloqueado</span>}
        <span><strong className="font-bold text-tinta">{s.open_tickets}</strong> casos abiertos</span>
        <span className="text-tenue-2">{s.last_login_at ? `Ingresó ${fmtAgo(s.last_login_at)}` : "Nunca ingresó"}</span>
      </div>

      <div className="mt-auto flex flex-wrap gap-1.5 border-t border-linea pt-3">
        <Button size="sm" variant="secondary" onClick={onEdit}>Editar</Button>
        {!self && <>
          <Button size="sm" variant="ghost" loading={action.isPending && action.variables === "reset-password"}
            onClick={() => confirm(`¿Generar nueva contraseña temporal para ${s.full_name}?`) && action.mutate("reset-password")}>Nueva contraseña</Button>
          {s.totp_enabled && <Button size="sm" variant="ghost" onClick={() => confirm("Deberá volver a escanear el código QR. ¿Continuar?") && action.mutate("reset-mfa")}>Reiniciar 2FA</Button>}
          {s.locked && <Button size="sm" variant="ghost" onClick={() => action.mutate("unlock")}>Desbloquear</Button>}
        </>}
      </div>
    </Card>
  );
}

function StaffModal({ member, onClose, onSecret }: { member: StaffMember | null; onClose: () => void; onSecret: (v: { username: string; password: string }) => void }) {
  const me = useMe().data?.staff;
  const [f, setF] = useState({
    username: member?.username ?? "", full_name: member?.full_name ?? "", email: member?.email ?? "", phone: member?.phone ?? "",
    role: (member?.role ?? "TECNICO") as StaffRole, specialties: member?.specialties ?? ([] as TicketCategory[]), active: member?.active ?? true,
  });
  const qc = useQueryClient();
  const toast = useToast();
  const save = useMutation<StaffMember | { staff: StaffMember; temporary_password: string }>({
    mutationFn: () => {
      const body = { full_name: f.full_name, email: f.email || null, phone: f.phone || null, role: f.role, specialties: f.specialties };
      return member
        ? api<StaffMember>(`/admin/staff/${member.id}`, { method: "PATCH", json: { ...body, active: f.active } })
        : api<{ staff: StaffMember; temporary_password: string }>("/admin/staff", { json: { ...body, username: f.username } });
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["staff"] });
      qc.invalidateQueries({ queryKey: ["technicians"] });
      if ("temporary_password" in r) onSecret({ username: r.staff.username, password: r.temporary_password });
      else toast({ tone: "success", title: "Datos actualizados" });
      onClose();
    },
  });
  const toggle = (c: TicketCategory) => setF((s) => ({ ...s, specialties: s.specialties.includes(c) ? s.specialties.filter((x) => x !== c) : [...s.specialties, c] }));
  const self = member?.id === me?.id;

  return (
    <Modal open onClose={onClose} title={member ? `Editar ${member.full_name}` : "Nuevo integrante"}>
      <form className="flex flex-col gap-4" onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Usuario">{(id) => <Input id={id} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} disabled={!!member} required autoCapitalize="none" />}</Field>
          <Field label="Rol">
            {(id) => <Select id={id} value={f.role} disabled={self} onChange={(e) => setF({ ...f, role: e.target.value as StaffRole })}><option value="TECNICO">Técnico</option><option value="ADMIN">Administrador</option></Select>}
          </Field>
        </div>
        <Field label="Nombre completo">{(id) => <Input id={id} value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} required minLength={3} />}</Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Correo">{(id) => <Input id={id} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
          <Field label="Teléfono">{(id) => <Input id={id} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} maxLength={20} />}</Field>
        </div>
        <fieldset>
          <legend className="mb-2 font-bold">Especialidades <span className="font-normal text-tenue">(la IA las usa para sugerir asignaciones)</span></legend>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <label key={c} className={cx("cursor-pointer rounded-full border px-3 py-1.5 text-sm font-bold transition", f.specialties.includes(c) ? "border-casma-oscuro bg-casma-oscuro text-white" : "border-linea bg-white text-tinta hover:border-casma/30 hover:bg-casma-claro/50")}>
                <input type="checkbox" className="sr-only" checked={f.specialties.includes(c)} onChange={() => toggle(c)} />{CATEGORY_LABEL[c]}
              </label>
            ))}
          </div>
        </fieldset>
        {member && !self && (
          <label className="flex min-h-11 items-center gap-2 font-bold"><input type="checkbox" className="size-5 accent-casma" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Cuenta activa</label>
        )}
        {save.error && <ErrorBox message={errorMessage(save.error)} />}
        <Button type="submit" loading={save.isPending}>{member ? "Guardar" : "Crear y generar contraseña temporal"}</Button>
      </form>
    </Modal>
  );
}
