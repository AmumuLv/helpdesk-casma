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
      <PageHeader title="Personal de soporte" description="Cuentas individuales con contraseña robusta y verificación en dos pasos obligatoria."
        actions={<Button onClick={() => setEditing("new")}><Plus className="size-4" /> Nuevo integrante</Button>} />
      {staff.isLoading ? <Spinner /> : staff.error ? <ErrorBox message={errorMessage(staff.error)} /> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {staff.data?.map((s) => <StaffCard key={s.id} member={s} onEdit={() => setEditing(s)} onSecret={setSecret} />)}
        </div>
      )}
      {editing && <StaffModal member={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSecret={setSecret} />}
      <Modal open={!!secret} onClose={() => setSecret(null)} title="Contraseña temporal">
        {secret && (
          <div className="flex flex-col gap-4">
            <p>Entréguela en persona a <strong>{secret.username}</strong>. Solo se muestra esta vez; deberá cambiarla y configurar su app autenticadora al ingresar.</p>
            <p className="select-all break-all rounded-xl bg-papel p-4 text-center text-xl font-bold">{secret.password}</p>
            <Button onClick={() => navigator.clipboard.writeText(secret.password)} variant="secondary">Copiar</Button>
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
        <div>
          <p className="text-lg font-bold">{s.full_name}</p>
          <p className="text-sm text-tenue">{s.username}{s.phone && `, ${s.phone}`}</p>
        </div>
        <Badge className={s.role === "ADMIN" ? "border-tinta bg-tinta text-white" : "border-linea bg-papel"}>{s.role === "ADMIN" ? "Admin" : "Técnico"}</Badge>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {s.specialties.map((c) => <Badge key={c} className="border-casma/30 bg-casma-claro text-casma-oscuro">{CATEGORY_LABEL[c]}</Badge>)}
        {!s.specialties.length && <span className="text-sm text-tenue">Sin especialidades</span>}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span className="flex items-center gap-1"><ShieldCheck className={cx("size-4", s.totp_enabled ? "text-hecho" : "text-sol")} />{s.totp_enabled ? "2FA activo" : "2FA pendiente"}</span>
        {s.locked && <span className="flex items-center gap-1 font-bold text-alerta"><Lock className="size-4" /> Bloqueado</span>}
        <span>{s.open_tickets} casos abiertos</span>
        <span className="text-tenue">{s.last_login_at ? `Ingresó ${fmtAgo(s.last_login_at)}` : "Nunca ingresó"}</span>
      </div>
      <div className="mt-auto flex flex-wrap gap-2 border-t border-linea pt-3">
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
        <div className="grid grid-cols-2 gap-3">
          <Field label="Usuario">{(id) => <Input id={id} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} disabled={!!member} required autoCapitalize="none" />}</Field>
          <Field label="Rol">
            {(id) => <Select id={id} value={f.role} disabled={self} onChange={(e) => setF({ ...f, role: e.target.value as StaffRole })}><option value="TECNICO">Técnico</option><option value="ADMIN">Administrador</option></Select>}
          </Field>
        </div>
        <Field label="Nombre completo">{(id) => <Input id={id} value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} required minLength={3} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Correo">{(id) => <Input id={id} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
          <Field label="Teléfono">{(id) => <Input id={id} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} maxLength={20} />}</Field>
        </div>
        <fieldset>
          <legend className="mb-2 font-bold">Especialidades <span className="font-normal text-tenue">(la IA las usa para sugerir asignaciones)</span></legend>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <label key={c} className={cx("cursor-pointer rounded-full border px-3 py-1 text-sm font-bold", f.specialties.includes(c) ? "border-casma bg-casma text-white" : "border-linea bg-white")}>
                <input type="checkbox" className="sr-only" checked={f.specialties.includes(c)} onChange={() => toggle(c)} />{CATEGORY_LABEL[c]}
              </label>
            ))}
          </div>
        </fieldset>
        {member && !self && (
          <label className="flex items-center gap-2 font-bold"><input type="checkbox" className="size-5 accent-casma" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Cuenta activa</label>
        )}
        {save.error && <ErrorBox message={errorMessage(save.error)} />}
        <Button type="submit" loading={save.isPending}>{member ? "Guardar" : "Crear y generar contraseña temporal"}</Button>
      </form>
    </Modal>
  );
}
