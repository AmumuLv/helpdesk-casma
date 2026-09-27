import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, KeyRound, MapPin, Pencil, Plus, Users } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useToast } from "../../components/Toasts";
import { Badge, Button, Card, ErrorBox, Field, Input, Modal, Select, Spinner } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { fmtDateTime } from "../../lib/labels";
import type { Office, OfficeServiceLevel } from "../../lib/types";
import { useOffices, useZones } from "./hooks";
import { PageHeader } from "./PageHeader";

type OfficeForm = {
  code: string; name: string; username: string; zone_id: string; location: string; head_name: string; head_phone: string;
  service_level: OfficeServiceLevel; service_reason: string; priority_weight: number; active: boolean;
};
const blank: OfficeForm = {
  code: "", name: "", username: "", zone_id: "", location: "", head_name: "", head_phone: "",
  service_level: "NORMAL", service_reason: "", priority_weight: 1, active: true,
};

const SERVICE_LEVEL_LABEL: Record<OfficeServiceLevel, string> = {
  NORMAL: "Normal",
  ATENCION_PUBLICO: "Atención al público",
  SERVICIO_CRITICO: "Servicio crítico",
};

const SERVICE_LEVEL_WEIGHT: Record<OfficeServiceLevel, number> = {
  NORMAL: 1,
  ATENCION_PUBLICO: 1.25,
  SERVICIO_CRITICO: 1.5,
};

function serviceBadgeClass(level: OfficeServiceLevel) {
  if (level === "SERVICIO_CRITICO") return "border-alerta/30 bg-alerta-claro text-alerta";
  if (level === "ATENCION_PUBLICO") return "border-amber-300 bg-sol-claro text-amber-900";
  return "border-linea bg-papel text-tenue";
}

export function OfficesPage() {
  const offices = useOffices();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<Office | "new" | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [q, setQ] = useState("");
  const grouped = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = (offices.data ?? []).filter((office) => !needle || [
      office.zone_name, office.name, office.code, office.head_name, office.location,
    ].some((value) => value?.toLowerCase().includes(needle)));
    const map = new Map<string, Office[]>();
    for (const office of filtered) {
      const zone = office.zone_name || "Sin zona asignada";
      map.set(zone, [...(map.get(zone) ?? []), office]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, "es"));
  }, [offices.data, q]);
  const qc = useQueryClient();
  const toast = useToast();
  const revoke = useMutation({
    mutationFn: (o: Office) => api<{ message: string }>(`/admin/offices/${o.id}/revoke-sessions`, { method: "POST" }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["offices"] }); toast({ tone: "success", title: r.message }); },
    onError: (err) => toast({ tone: "danger", title: "No se pudo completar", body: errorMessage(err) }),
  });

  return (
    <div>
      <PageHeader title="Oficinas" description="Jerarquía organizacional: Zona → Oficina → Responsable."
        actions={<>
          <Button variant="secondary" onClick={() => setPasswordOpen(true)}><KeyRound className="size-4" /> Contraseña de oficinas</Button>
          <Button onClick={() => setEditing("new")}><Plus className="size-4" /> Nueva oficina</Button>
        </>} />
      <Card className="mb-4 p-3 sm:p-4">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar zona, oficina, código o responsable" aria-label="Buscar oficinas" />
      </Card>
      {offices.isLoading ? <Spinner /> : offices.error ? <ErrorBox message={errorMessage(offices.error)} /> : grouped.length === 0 ? (
        <Card className="p-8 text-center text-tenue">No se encontraron oficinas.</Card>
      ) : (
        <div className="flex flex-col gap-4">
          {grouped.map(([zone, zoneOffices]) => (
            <Card key={zone} className="overflow-hidden">
              <div className="border-b border-linea bg-papel px-4 py-3 sm:px-5">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.08em] text-tenue">Zona</p>
                    <h2 className="text-lg font-bold text-tinta">{zone}</h2>
                  </div>
                  <span className="text-sm font-medium text-tenue">{zoneOffices.length} oficina{zoneOffices.length === 1 ? "" : "s"}</span>
                </div>
              </div>

              <div className="divide-y divide-linea md:hidden">
                {zoneOffices.map((o) => (
                  <article key={o.id} className={o.active ? "bg-white p-4" : "bg-white p-4 opacity-60"}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-base font-bold text-tinta">{o.name}</h3>
                        <p className="mt-0.5 text-xs text-tenue">{o.code} · usuario: {o.username}</p>
                      </div>
                      <Badge className={serviceBadgeClass(o.service_level)}>{SERVICE_LEVEL_LABEL[o.service_level]}</Badge>
                    </div>

                    {o.service_reason && <p className="mt-2 text-sm leading-5 text-tenue">{o.service_reason}</p>}

                    <div className="mt-3 grid gap-2 rounded-xl bg-papel/80 p-3 text-sm">
                      <div className="flex items-start gap-2">
                        <Users className="mt-0.5 size-4 shrink-0 text-casma-oscuro" />
                        <div className="min-w-0"><span className="font-bold text-tinta">{o.head_name ?? "Sin responsable"}</span>{o.head_phone && <span className="text-tenue"> · {o.head_phone}</span>}</div>
                      </div>
                      <div className="flex items-start gap-2">
                        <MapPin className="mt-0.5 size-4 shrink-0 text-casma-oscuro" />
                        <span className="text-tenue">{o.location ?? "Sin ubicación registrada"}</span>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                      <span><strong>{o.devices_approved}</strong> autorizados</span>
                      {o.devices_pending > 0 && <Badge className="border-amber-300 bg-sol-claro text-amber-900">{o.devices_pending} pendientes</Badge>}
                    </div>

                    <div className="mt-3 grid grid-cols-1 gap-2 border-t border-linea/70 pt-3 sm:grid-cols-2">
                      <Button size="sm" variant="secondary" onClick={() => navigate(`/soporte/organizacion/oficina/${o.id}`)}>
                        Ver perfil <ArrowRight className="size-4" />
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setEditing(o)}><Pencil className="size-4" /> Editar</Button>
                      <Button size="sm" variant="ghost" className="sm:col-span-2" loading={revoke.isPending && revoke.variables?.id === o.id}
                        onClick={() => confirm(`Se cerrará la sesión en todos los equipos de «${o.name}». ¿Continuar?`) && revoke.mutate(o)}>Cerrar sesiones</Button>
                    </div>
                  </article>
                ))}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[820px] text-left text-sm">
                  <thead className="border-b border-linea bg-white text-tenue">
                    <tr><th className="p-3">Oficina</th><th className="p-3">Servicio</th><th className="p-3">Responsable</th><th className="p-3">Ubicación</th><th className="p-3">Dispositivos</th><th className="p-3">Acciones</th></tr>
                  </thead>
                  <tbody className="divide-y divide-linea">
                    {zoneOffices.map((o) => (
                      <tr key={o.id} className={o.active ? "transition hover:bg-casma-claro/25" : "opacity-55"}>
                        <td className="p-3">
                          <p className="font-bold">{o.name}</p>
                          <p className="text-tenue">{o.code} · usuario: {o.username}</p>
                        </td>
                        <td className="p-3">
                          <Badge className={serviceBadgeClass(o.service_level)}>{SERVICE_LEVEL_LABEL[o.service_level]}</Badge>
                          {o.service_reason && <p className="mt-1 max-w-52 text-xs text-tenue">{o.service_reason}</p>}
                        </td>
                        <td className="p-3"><p className="font-bold">{o.head_name ?? "Sin responsable"}</p><p className="text-tenue">{o.head_phone ?? "–"}</p></td>
                        <td className="p-3">{o.location ?? "–"}</td>
                        <td className="p-3">
                          <span className="font-bold">{o.devices_approved}</span> autorizados
                          {o.devices_pending > 0 && <Badge className="ml-2 border-amber-300 bg-sol-claro text-amber-900">{o.devices_pending} pendientes</Badge>}
                        </td>
                        <td className="p-3">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="secondary" onClick={() => navigate(`/soporte/organizacion/oficina/${o.id}`)}>
                              Ver perfil <ArrowRight className="size-4" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditing(o)} aria-label={`Editar ${o.name}`}><Pencil className="size-4" /></Button>
                            <Button size="sm" variant="ghost" loading={revoke.isPending && revoke.variables?.id === o.id}
                              onClick={() => confirm(`Se cerrará la sesión en todos los equipos de «${o.name}». ¿Continuar?`) && revoke.mutate(o)}>Cerrar sesiones</Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </div>
      )}
      {editing && <OfficeModal office={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      <OfficePasswordModal open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </div>
  );
}

function OfficeModal({ office, onClose }: { office: Office | null; onClose: () => void }) {
  const [f, setF] = useState<OfficeForm>(office ? {
    code: office.code, name: office.name, username: office.username, zone_id: office.zone_id ?? "",
    location: office.location ?? "", head_name: office.head_name ?? "",
    head_phone: office.head_phone ?? "", service_level: office.service_level ?? "NORMAL",
    service_reason: office.service_reason ?? "", priority_weight: office.priority_weight, active: office.active,
  } : blank);
  const zones = useZones();
  const qc = useQueryClient();
  const toast = useToast();
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...f,
        zone_id: f.zone_id || null,
        location: f.location || null,
        head_name: f.head_name || null,
        head_phone: f.head_phone || null,
        service_reason: f.service_reason.trim() || null,
      };
      if (office) {
        const { code: _code, ...patch } = body;
        return api<Office>(`/admin/offices/${office.id}`, { method: "PATCH", json: patch });
      }
      const { active: _active, ...create } = body;
      return api<Office>("/admin/offices", { json: create });
    },
    onSuccess: (o) => { qc.invalidateQueries({ queryKey: ["offices"] }); toast({ tone: "success", title: office ? "Oficina actualizada" : "Oficina creada", body: `Usuario: ${o.username}` }); onClose(); },
  });
  const bind = (k: keyof OfficeForm) => ({ value: String(f[k]), onChange: (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: k === "priority_weight" ? Number(e.target.value) : e.target.value })) });

  return (
    <Modal open onClose={onClose} title={office ? `Editar ${office.name}` : "Nueva oficina"}>
      <form className="flex flex-col gap-4" onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Código">{(id) => <Input id={id} {...bind("code")} disabled={!!office} required minLength={2} maxLength={20} />}</Field>
          <Field label="Usuario de acceso">{(id) => <Input id={id} {...bind("username")} required autoCapitalize="none" pattern="[a-z0-9][a-z0-9._\-]{2,39}" />}</Field>
        </div>
        <Field label="Nombre">{(id) => <Input id={id} {...bind("name")} required minLength={3} maxLength={120} />}</Field>
        <Field label="Zona" hint="Relación formal de la jerarquía Zona → Oficina.">
          {(id) => (
            <Select id={id} {...bind("zone_id")} required>
              <option value="">Seleccione una zona</option>
              {zones.data?.filter((zone) => zone.active).map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Ubicación" hint="Se usa para detectar fallas masivas por piso o local.">{(id) => <Input id={id} {...bind("location")} placeholder="Piso 2, Palacio municipal" maxLength={120} />}</Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Jefe / responsable">{(id) => <Input id={id} {...bind("head_name")} maxLength={120} />}</Field>
          <Field label="Teléfono / anexo">{(id) => <Input id={id} {...bind("head_phone")} maxLength={20} />}</Field>
        </div>
        <Field label="Perfil de servicio" hint="El triaje local usa este valor para elevar la prioridad de oficinas sensibles.">
          {(id) => (
            <Select
              id={id}
              value={f.service_level}
              onChange={(e) => {
                const level = e.target.value as OfficeServiceLevel;
                setF((s) => ({ ...s, service_level: level, priority_weight: SERVICE_LEVEL_WEIGHT[level] }));
              }}
            >
              <option value="NORMAL">Normal</option>
              <option value="ATENCION_PUBLICO">Atención al público</option>
              <option value="SERVICIO_CRITICO">Servicio crítico</option>
            </Select>
          )}
        </Field>
        <Field label="Motivo / función" hint="Ejemplos: Mesa de Partes, Caja, atención tributaria, continuidad de servicio.">
          {(id) => <Input id={id} {...bind("service_reason")} maxLength={160} placeholder="Ej. Mesa de Partes - recepción de expedientes" />}
        </Field>
        <Field label={`Peso de prioridad IA: ${f.priority_weight.toFixed(2)}`} hint="Se ajusta al elegir el perfil; puede afinarse manualmente si TI lo necesita.">
          {(id) => <input id={id} type="range" min={0.5} max={2} step={0.1} {...bind("priority_weight")} className="w-full accent-casma" />}
        </Field>
        {office && (
          <label className="flex min-h-11 items-center gap-2 font-bold"><input type="checkbox" className="size-5 accent-casma" checked={f.active} onChange={(e) => setF((s) => ({ ...s, active: e.target.checked }))} /> Oficina activa</label>
        )}
        {save.error && <ErrorBox message={errorMessage(save.error)} />}
        <Button type="submit" loading={save.isPending}>Guardar</Button>
      </form>
    </Modal>
  );
}

function OfficePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const status = useQuery({ queryKey: ["office-password"], queryFn: () => api<{ configured: boolean; updated_at: string | null }>("/admin/settings/office-password"), enabled: open });
  const [password, setPassword] = useState("");
  const toast = useToast();
  const save = useMutation({
    mutationFn: () => api<{ message: string }>("/admin/settings/office-password", { method: "PUT", json: { new_password: password } }),
    onSuccess: (r) => { toast({ tone: "success", title: r.message }); setPassword(""); status.refetch(); onClose(); },
  });
  return (
    <Modal open={open} onClose={onClose} title="Contraseña común de oficinas">
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (confirm("Todas las oficinas deberán volver a ingresar. ¿Continuar?")) save.mutate(); }}>
        <p className="leading-6 text-tenue">
          {status.data?.configured ? `Última actualización: ${status.data.updated_at ? fmtDateTime(status.data.updated_at) : "sin fecha"}.` : "Aún no se ha definido la contraseña."}
          {" "}Al cambiarla se cierra la sesión en todos los equipos de oficina; los dispositivos autorizados no necesitan volver a aprobarse.
        </p>
        <Field label="Nueva contraseña" hint="Mínimo 10 caracteres, con letras y números.">
          {(id) => <Input id={id} type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" required minLength={10} />}
        </Field>
        {save.error && <ErrorBox message={errorMessage(save.error)} />}
        <Button type="submit" loading={save.isPending}>Cambiar contraseña</Button>
      </form>
    </Modal>
  );
}
