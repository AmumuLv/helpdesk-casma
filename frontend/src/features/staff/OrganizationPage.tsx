import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Building2, Pencil, Plus, UserRound, Users } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useToast } from "../../components/Toasts";
import { Badge, Button, Card, ErrorBox, Field, Input, Modal, Select, Spinner } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import type { MunicipalUser, Zone } from "../../lib/types";
import { PageHeader } from "./PageHeader";
import { useIsAdmin, useMunicipalUsers, useOfficeLookup, useZones } from "./hooks";

type ZoneForm = { code: string; name: string; description: string; active: boolean };
type UserForm = {
  employee_code: string; full_name: string; office_id: string; job_title: string;
  email: string; phone: string; active: boolean;
};

const EMPTY_ZONE: ZoneForm = { code: "", name: "", description: "", active: true };
const EMPTY_USER: UserForm = {
  employee_code: "", full_name: "", office_id: "", job_title: "", email: "", phone: "", active: true,
};

export function OrganizationPage() {
  const zones = useZones();
  const users = useMunicipalUsers(undefined, true);
  const offices = useOfficeLookup();
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const [zoneEdit, setZoneEdit] = useState<Zone | "new" | null>(null);
  const [userEdit, setUserEdit] = useState<MunicipalUser | "new" | null>(null);
  const [zoneFilter, setZoneFilter] = useState("");
  const [officeFilter, setOfficeFilter] = useState("");
  const [q, setQ] = useState("");

  const filteredUsers = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (users.data ?? []).filter((user) => {
      if (zoneFilter && user.zone_id !== zoneFilter) return false;
      if (officeFilter && user.office_id !== officeFilter) return false;
      if (!needle) return true;
      return [user.full_name, user.employee_code, user.job_title, user.office_name, user.zone_name]
        .some((value) => value?.toLowerCase().includes(needle));
    });
  }, [users.data, zoneFilter, officeFilter, q]);

  const officesForFilter = useMemo(
    () => (offices.data ?? []).filter((office) => !zoneFilter || office.zone_id === zoneFilter),
    [offices.data, zoneFilter],
  );

  return (
    <div>
      <PageHeader
        title="Organización municipal"
        description="Jerarquía formal Zona → Oficina → Usuario para inventario y soporte TI."
        actions={isAdmin ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setZoneEdit("new")}><Building2 className="size-4" /> Nueva zona</Button>
            <Button onClick={() => setUserEdit("new")}><UserRound className="size-4" /> Nuevo usuario municipal</Button>
          </div>
        ) : undefined}
      />

      <section className="mb-6">
        <h2 className="mb-3 text-lg font-bold">Zonas</h2>
        {zones.isLoading ? <Spinner /> : zones.error ? <ErrorBox message={errorMessage(zones.error)} /> : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(zones.data ?? []).map((zone) => (
              <Card key={zone.id} className={zone.active ? "p-4" : "p-4 opacity-60"}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-bold">{zone.name}</h3>
                      {!zone.active && <Badge className="border-linea bg-papel text-tenue">Inactiva</Badge>}
                    </div>
                    <p className="text-sm text-tenue">{zone.code}</p>
                  </div>
                  {isAdmin && (
                    <Button size="sm" variant="ghost" onClick={() => setZoneEdit(zone)} aria-label={`Editar ${zone.name}`}>
                      <Pencil className="size-4" />
                    </Button>
                  )}
                </div>
                {zone.description && <p className="mt-2 text-sm">{zone.description}</p>}
                <div className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
                  <div className="rounded-lg bg-papel p-2"><strong className="block text-lg">{zone.office_count}</strong>Oficinas</div>
                  <div className="rounded-lg bg-papel p-2"><strong className="block text-lg">{zone.user_count}</strong>Usuarios</div>
                  <div className="rounded-lg bg-papel p-2"><strong className="block text-lg">{zone.equipment_count}</strong>Equipos</div>
                </div>
                <Button className="mt-3 w-full" variant="secondary" onClick={() => navigate(`/soporte/organizacion/zona/${zone.id}`)}>
                  Ver perfil <ArrowRight className="size-4" />
                </Button>
              </Card>
            ))}
            {!zones.data?.length && <Card className="p-6 text-center text-tenue">Aún no hay zonas formales registradas.</Card>}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-bold"><Users className="size-5" /> Usuarios municipales</h2>
          <span className="text-sm text-tenue">{filteredUsers.length} resultado{filteredUsers.length === 1 ? "" : "s"}</span>
        </div>

        <Card className="mb-3 grid gap-3 p-3 md:grid-cols-3">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nombre, código, cargo u oficina" />
          <Select
            value={zoneFilter}
            onChange={(e) => {
              setZoneFilter(e.target.value);
              setOfficeFilter("");
            }}
          >
            <option value="">Todas las zonas</option>
            {zones.data?.filter((z) => z.active).map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
          </Select>
          <Select value={officeFilter} onChange={(e) => setOfficeFilter(e.target.value)}>
            <option value="">Todas las oficinas</option>
            {officesForFilter.map((office) => <option key={office.id} value={office.id}>{office.name}</option>)}
          </Select>
        </Card>

        {users.isLoading ? <Spinner /> : users.error ? <ErrorBox message={errorMessage(users.error)} /> : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="border-b border-linea bg-papel text-tenue">
                  <tr>
                    <th className="p-3">Usuario</th>
                    <th className="p-3">Cargo</th>
                    <th className="p-3">Zona / Oficina</th>
                    <th className="p-3">Contacto</th>
                    <th className="p-3">Equipos</th>
                    <th className="p-3">Estado</th>
                    <th className="p-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-linea">
                  {filteredUsers.map((user) => (
                    <tr key={user.id} className={user.active ? "" : "opacity-55"}>
                      <td className="p-3">
                        <div className="flex items-center gap-3">
                          {user.photo_url ? (
                            <img src={user.photo_url} alt="" className="size-10 rounded-xl border border-linea object-cover" />
                          ) : (
                            <div className="flex size-10 items-center justify-center rounded-xl bg-casma-claro font-bold text-casma">
                              {user.full_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}
                            </div>
                          )}
                          <div>
                            <p className="font-bold">{user.full_name}</p>
                            <p className="text-tenue">{user.employee_code ?? "Sin código interno"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-3">{user.job_title ?? "–"}</td>
                      <td className="p-3">
                        <p className="font-bold">{user.zone_name ?? "Sin zona"}</p>
                        <p className="text-tenue">{user.office_name}</p>
                      </td>
                      <td className="p-3">
                        <p>{user.email ?? "–"}</p>
                        <p className="text-tenue">{user.phone ?? "–"}</p>
                      </td>
                      <td className="p-3 font-bold">{user.equipment_count}</td>
                      <td className="p-3">{user.active ? <Badge className="border-hecho/30 bg-hecho-claro text-hecho">Activo</Badge> : <Badge className="border-linea bg-papel text-tenue">Inactivo</Badge>}</td>
                      <td className="p-3 text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="secondary" onClick={() => navigate(`/soporte/organizacion/usuario/${user.id}`)}>
                            Ver <ArrowRight className="size-4" />
                          </Button>
                          {isAdmin && (
                            <Button size="sm" variant="ghost" onClick={() => setUserEdit(user)} aria-label={`Editar ${user.full_name}`}>
                              <Pencil className="size-4" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!filteredUsers.length && <tr><td colSpan={7} className="p-8 text-center text-tenue">No se encontraron usuarios municipales.</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </section>

      {zoneEdit && <ZoneModal zone={zoneEdit === "new" ? null : zoneEdit} onClose={() => setZoneEdit(null)} />}
      {userEdit && <MunicipalUserModal user={userEdit === "new" ? null : userEdit} onClose={() => setUserEdit(null)} />}
    </div>
  );
}

function ZoneModal({ zone, onClose }: { zone: Zone | null; onClose: () => void }) {
  const [form, setForm] = useState<ZoneForm>(zone ? {
    code: zone.code, name: zone.name, description: zone.description ?? "", active: zone.active,
  } : EMPTY_ZONE);
  const qc = useQueryClient();
  const toast = useToast();
  const save = useMutation({
    mutationFn: () => {
      if (zone) {
        return api<Zone>(`/organization/zones/${zone.id}`, {
          method: "PATCH",
          json: { name: form.name, description: form.description.trim() || null, active: form.active },
        });
      }
      return api<Zone>("/organization/zones", {
        json: { code: form.code, name: form.name, description: form.description.trim() || null },
      });
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ["organization", "zones"] });
      qc.invalidateQueries({ queryKey: ["offices"] });
      toast({ tone: "success", title: zone ? "Zona actualizada" : "Zona creada", body: saved.name });
      onClose();
    },
  });

  return (
    <Modal open onClose={onClose} title={zone ? `Editar ${zone.name}` : "Nueva zona"}>
      <form className="flex flex-col gap-4" onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}>
        <Field label="Código">{(id) => <Input id={id} value={form.code} disabled={!!zone} onChange={(e) => setForm((s) => ({ ...s, code: e.target.value }))} required maxLength={30} />}</Field>
        <Field label="Nombre">{(id) => <Input id={id} value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} required maxLength={120} placeholder="Ej. Complejo Municipal" />}</Field>
        <Field label="Descripción">{(id) => <Input id={id} value={form.description} onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))} maxLength={300} />}</Field>
        {zone && <label className="flex items-center gap-2 font-bold"><input type="checkbox" checked={form.active} onChange={(e) => setForm((s) => ({ ...s, active: e.target.checked }))} className="size-5 accent-casma" /> Zona activa</label>}
        {save.error && <ErrorBox message={errorMessage(save.error)} />}
        <Button type="submit" loading={save.isPending}>Guardar</Button>
      </form>
    </Modal>
  );
}

function MunicipalUserModal({ user, onClose }: { user: MunicipalUser | null; onClose: () => void }) {
  const offices = useOfficeLookup();
  const [form, setForm] = useState<UserForm>(user ? {
    employee_code: user.employee_code ?? "",
    full_name: user.full_name,
    office_id: user.office_id,
    job_title: user.job_title ?? "",
    email: user.email ?? "",
    phone: user.phone ?? "",
    active: user.active,
  } : EMPTY_USER);
  const qc = useQueryClient();
  const toast = useToast();
  const save = useMutation({
    mutationFn: () => {
      const body = {
        employee_code: form.employee_code.trim() || null,
        full_name: form.full_name,
        office_id: form.office_id,
        job_title: form.job_title.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        ...(user ? { active: form.active } : {}),
      };
      return user
        ? api<MunicipalUser>(`/organization/users/${user.id}`, { method: "PATCH", json: body })
        : api<MunicipalUser>("/organization/users", { json: body });
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ["organization", "users"] });
      qc.invalidateQueries({ queryKey: ["organization", "zones"] });
      qc.invalidateQueries({ queryKey: ["equipment"] });
      toast({ tone: "success", title: user ? "Usuario actualizado" : "Usuario registrado", body: saved.full_name });
      onClose();
    },
  });

  const selectedOffice = offices.data?.find((office) => office.id === form.office_id);

  return (
    <Modal open onClose={onClose} title={user ? `Editar ${user.full_name}` : "Nuevo usuario municipal"}>
      <form className="flex flex-col gap-4" onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Código de trabajador">{(id) => <Input id={id} value={form.employee_code} onChange={(e) => setForm((s) => ({ ...s, employee_code: e.target.value }))} maxLength={40} placeholder="Opcional" />}</Field>
          <Field label="Nombre completo">{(id) => <Input id={id} value={form.full_name} onChange={(e) => setForm((s) => ({ ...s, full_name: e.target.value }))} required maxLength={120} />}</Field>
        </div>
        <Field label="Oficina">
          {(id) => (
            <Select id={id} value={form.office_id} onChange={(e) => setForm((s) => ({ ...s, office_id: e.target.value }))} required>
              <option value="">Seleccione oficina</option>
              {offices.data?.map((office) => <option key={office.id} value={office.id}>{office.zone_name ? `${office.zone_name} › ${office.name}` : office.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Zona">{(id) => <Input id={id} value={selectedOffice?.zone_name ?? ""} readOnly placeholder="Se hereda de la oficina" />}</Field>
        <Field label="Cargo / función">{(id) => <Input id={id} value={form.job_title} onChange={(e) => setForm((s) => ({ ...s, job_title: e.target.value }))} maxLength={120} placeholder="Ej. Cajero, asistente, jefe de área" />}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Correo">{(id) => <Input id={id} type="email" value={form.email} onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))} maxLength={120} />}</Field>
          <Field label="Teléfono / anexo">{(id) => <Input id={id} value={form.phone} onChange={(e) => setForm((s) => ({ ...s, phone: e.target.value }))} maxLength={20} />}</Field>
        </div>
        {user && <label className="flex items-center gap-2 font-bold"><input type="checkbox" checked={form.active} onChange={(e) => setForm((s) => ({ ...s, active: e.target.checked }))} className="size-5 accent-casma" /> Usuario activo</label>}
        {save.error && <ErrorBox message={errorMessage(save.error)} />}
        <Button type="submit" loading={save.isPending}>Guardar</Button>
      </form>
    </Modal>
  );
}
