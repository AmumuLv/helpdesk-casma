import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, ChevronRight, KeyRound, Pencil, Plus, Search, ShieldCheck, Users } from "lucide-react";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { useToast } from "../../components/Toasts";
import { Badge, Button, ErrorBox, Field, Input, Modal, Segmented, Select, Spinner, Stat, cx } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { fmtDateTime } from "../../lib/labels";
import type { MunicipalUser, Office, OfficeServiceLevel, Zone } from "../../lib/types";
import { useIsAdmin, useMunicipalUsers, useOfficeLookup, useOffices, useZones, type OfficeLookup } from "./hooks";
import { PageHeader } from "./PageHeader";

type Section = "resumen" | "oficinas" | "usuarios";

/**
 * Oficina tal como la ve esta pantalla. Los campos de solo administrador
 * (usuario de acceso y conteo de dispositivos) llegan únicamente cuando el
 * usuario es ADMIN; el resto del árbol es visible para todo el personal.
 */
type Space = OfficeLookup & Partial<Pick<Office, "username" | "devices_approved" | "devices_pending">>;

const SERVICE_LEVEL: Record<OfficeServiceLevel, string> = {
  NORMAL: "Normal",
  ATENCION_PUBLICO: "Atención al público",
  SERVICIO_CRITICO: "Servicio crítico",
};

const SERVICE_TONE: Record<OfficeServiceLevel, string> = {
  NORMAL: "border-linea bg-papel-2 text-tenue",
  ATENCION_PUBLICO: "border-amber-200 bg-amber-50 text-amber-800",
  SERVICIO_CRITICO: "border-red-200 bg-red-50 text-red-700",
};

const SERVICE_WEIGHT: Record<OfficeServiceLevel, number> = { NORMAL: 1, ATENCION_PUBLICO: 1.25, SERVICIO_CRITICO: 1.5 };

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

/**
 * Espacios municipales: una única pantalla para la jerarquía
 * Zona › Oficina › Usuario. Cada elemento tiene su ficha y sus acciones,
 * de modo que el trabajo no se reparte entre varias pestañas redundantes.
 */
export function SpacesPage() {
  const zones = useZones();
  const isAdmin = useIsAdmin();
  const lookup = useOfficeLookup();
  const adminOffices = useOffices(isAdmin);
  const users = useMunicipalUsers(undefined, true);
  const navigate = useNavigate();

  const [selected, setSelected] = useState<string | null>(null);
  const [openZones, setOpenZones] = useState<Record<string, boolean>>({});
  const [openOffices, setOpenOffices] = useState<Record<string, boolean>>({});
  const [section, setSection] = useState<Section>("resumen");
  const [q, setQ] = useState("");

  const [zoneEdit, setZoneEdit] = useState<Zone | "new" | null>(null);
  const [officeEdit, setOfficeEdit] = useState<{ office: Office | null; zoneId: string } | null>(null);
  const [userEdit, setUserEdit] = useState<MunicipalUser | "new" | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);

  const needle = q.trim().toLowerCase();
  const showDevices = isAdmin;
  const matches = (...values: (string | null | undefined)[]) => !needle || values.some((v) => v?.toLowerCase().includes(needle));

  const zoneList = zones.data ?? [];
  const officeList: Space[] = isAdmin ? (adminOffices.data ?? []) : (lookup.data ?? []);
  const userList = users.data ?? [];

  const tree = useMemo(
    () => zoneList.filter((z) => matches(z.name, z.code, z.description)).map((zone) => ({
      zone,
      offices: officeList
        .filter((o) => o.zone_id === zone.id && matches(o.name, o.code, o.head_name, o.location))
        .map((office) => ({
          office,
          users: userList.filter((u) => u.office_id === office.id && matches(u.full_name, u.employee_code, u.job_title, u.email)),
        })),
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [zoneList, officeList, userList, needle],
  );

  const orphans = useMemo(
    () => officeList.filter((o) => !o.zone_id && matches(o.name, o.code, o.head_name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [officeList, needle],
  );

  const totals = useMemo(() => ({
    zones: zoneList.length,
    offices: officeList.length,
    users: userList.filter((u) => u.active).length,
    equipment: zoneList.reduce((acc, z) => acc + z.equipment_count, 0),
    pending: officeList.reduce((acc, o) => acc + (o.devices_pending ?? 0), 0),
  }), [zoneList, officeList, userList]);

  const active = useMemo(() => {
    if (!selected) return null;
    const [kind, id] = selected.split(":");
    if (kind === "zona") {
      const zone = zoneList.find((z) => z.id === id);
      return zone ? { kind: "zona" as const, id, zone } : null;
    }
    if (kind === "oficina") {
      const office = officeList.find((o) => o.id === id);
      return office ? { kind: "oficina" as const, id, office } : null;
    }
    const user = userList.find((u) => u.id === id);
    return user ? { kind: "usuario" as const, id, user } : null;
  }, [selected, zoneList, officeList, userList]);

  const zoneOffices = active?.kind === "zona" ? officeList.filter((o) => o.zone_id === active.id) : [];
  const officeUsers = active?.kind === "oficina" ? userList.filter((u) => u.office_id === active.id) : [];

  const select = (kind: string, id: string) => { setSelected(`${kind}:${id}`); setSection("resumen"); };
  const loading = zones.isLoading || lookup.isLoading || adminOffices.isLoading || users.isLoading;
  const error = zones.error ?? lookup.error ?? adminOffices.error ?? users.error;
  const nothingFound = tree.length === 0 && orphans.length === 0;

  return (
    <div>
      <PageHeader
        title="Espacios municipales"
        description="Zonas, oficinas y personal en una sola jerarquía. Seleccione un elemento para ver su ficha y administrarlo."
        actions={<>
          {isAdmin && <Button variant="secondary" onClick={() => setPasswordOpen(true)}><KeyRound className="size-4" /> Contraseña de oficinas</Button>}
          {isAdmin && <Button variant="secondary" onClick={() => setZoneEdit("new")}><Building2 className="size-4" /> Nueva zona</Button>}
          {isAdmin && <Button variant="primary" onClick={() => setUserEdit("new")}><Plus className="size-4" /> Nuevo usuario</Button>}
        </>}
        meta={
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[0.78rem] text-tenue">
            <span><strong className="font-bold text-tinta">{totals.zones}</strong> zonas</span>
            <span><strong className="font-bold text-tinta">{totals.offices}</strong> oficinas</span>
            <span><strong className="font-bold text-tinta">{totals.users}</strong> usuarios activos</span>
            <span><strong className="font-bold text-tinta">{totals.equipment}</strong> equipos</span>
            {totals.pending > 0 && <span className="font-semibold text-amber-700">{totals.pending} dispositivos por autorizar</span>}
          </div>
        }
      />

      {loading ? <Spinner label="Cargando estructura municipal" /> : error ? <ErrorBox message={errorMessage(error)} /> : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,23rem)_minmax(0,1fr)]">
          <nav className="panel flex max-h-[calc(100dvh-16rem)] flex-col overflow-hidden" aria-label="Jerarquía municipal">
            <div className="border-b border-linea p-2.5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-tenue-2" aria-hidden />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar zona, oficina o persona" aria-label="Buscar en la jerarquía" className="pl-8" />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {nothingFound && <p className="px-3 py-8 text-center text-[0.8rem] text-tenue">Sin resultados{needle ? ` para «${q}»` : ""}.</p>}

              {tree.map(({ zone, offices: children }) => {
                const expanded = openZones[zone.id] ?? true;
                const activeUsers = userList.filter((u) => u.zone_id === zone.id && u.active).length;
                return (
                  <div key={zone.id} className="mb-1">
                    <div className="flex items-center gap-0.5">
                      <Chevron
                        expanded={expanded}
                        onClick={() => setOpenZones((s) => ({ ...s, [zone.id]: !expanded }))}
                        label={expanded ? "Contraer zona" : "Expandir zona"}
                      />
                      <TreeButton
                        selected={active?.kind === "zona" && active.id === zone.id}
                        onClick={() => select("zona", zone.id)}
                        trailing={<span className="shrink-0 text-[0.7rem] font-semibold text-tenue-2">{zone.office_count}</span>}
                      >
                        {zone.name}
                      </TreeButton>
                    </div>

                    {expanded && (
                      <div className="ml-3.5 border-l border-linea pl-1.5">
                        {children.map(({ office, users }) => {
                          const officeExpanded = openOffices[office.id] ?? false;
                          return (
                            <div key={office.id}>
                              <div className="flex items-center gap-0.5">
                                <Chevron
                                  expanded={officeExpanded}
                                  small
                                  onClick={() => setOpenOffices((s) => ({ ...s, [office.id]: !officeExpanded }))}
                                  label={officeExpanded ? "Contraer oficina" : "Expandir oficina"}
                                />
                                <TreeButton
                                  selected={active?.kind === "oficina" && active.id === office.id}
                                  onClick={() => select("oficina", office.id)}
                                  dot={office.active}
                                  trailing={(office.devices_pending ?? 0) > 0 ? (
                                    <span className="shrink-0 rounded bg-amber-100 px-1 text-[0.65rem] font-bold text-amber-800">{office.devices_pending}</span>
                                  ) : undefined}
                                >
                                  {office.name}
                                </TreeButton>
                              </div>

                              {officeExpanded && (
                                <div className="ml-3.5 border-l border-linea pl-1.5">
                                  {users.map((user) => (
                                    <TreeButton
                                      key={user.id}
                                      selected={active?.kind === "usuario" && active.id === user.id}
                                      onClick={() => select("usuario", user.id)}
                                      className="text-[0.82rem]"
                                      trailing={!user.active ? <span className="shrink-0 text-[0.65rem] text-tenue-2">inactivo</span> : undefined}
                                    >
                                      {user.full_name}
                                    </TreeButton>
                                  ))}
                                  {!users.length && <p className="py-1.5 pl-2.5 text-[0.75rem] text-tenue-2">Sin personal registrado</p>}
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {!children.length && <p className="py-1.5 pl-2.5 text-[0.75rem] text-tenue-2">Sin oficinas</p>}
                        <p className="px-2.5 py-1.5 text-[0.72rem] text-tenue-2">
                          {zone.office_count} offices · {activeUsers} usuarios activos · {zone.equipment_count} equipos
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}

              {orphans.length > 0 && (
                <>
                  <p className="tree-group">Sin zona asignada</p>
                  {orphans.map((office) => (
                    <TreeButton key={office.id} selected={active?.kind === "oficina" && active.id === office.id} onClick={() => select("oficina", office.id)} dot={office.active}>
                      {office.name}
                    </TreeButton>
                  ))}
                </>
              )}
            </div>
          </nav>

          <div className="min-w-0">
            {!active ? (
              <div className="panel grid min-h-80 place-items-center p-8 text-center">
                <div>
                  <span className="mx-auto grid size-11 place-items-center rounded-xl border border-linea bg-papel-2 text-tenue-2"><Users className="size-5" aria-hidden /></span>
                  <p className="mt-3 text-[0.9rem] font-bold text-tinta">Seleccione una zona, oficina o persona</p>
                  <p className="mx-auto mt-1 max-w-sm text-[0.8rem] leading-5 text-tenue">
                    Toda la estructura municipal se administra desde aquí: cada elemento muestra su ficha, su personal y sus dispositivos.
                  </p>
                </div>
              </div>
            ) : active.kind === "zona" ? (
              <ZonePanel
                zone={active.zone}
                offices={zoneOffices}
                section={section}
                onSection={setSection}
                onOpenOffice={(id) => select("oficina", id)}
                onEdit={() => setZoneEdit(active.zone)}
                onAddOffice={() => setOfficeEdit({ office: null, zoneId: active.zone.id })}
                canEdit={isAdmin}
              />
            ) : active.kind === "oficina" ? (
              <OfficePanel
                office={active.office}
                users={officeUsers}
                section={section}
                onSection={setSection}
                onOpenUser={(id) => select("usuario", id)}
                onEdit={() => setOfficeEdit({ office: active.office as Office, zoneId: active.office.zone_id ?? "" })}
                onProfile={() => navigate(`/soporte/organizacion/oficina/${active.office.id}`)}
                canEdit={isAdmin}
                showDevices={showDevices}
              />
            ) : (
              <UserPanel
                user={active.user}
                onEdit={() => setUserEdit(active.user)}
                onProfile={() => navigate(`/soporte/organizacion/usuario/${active.user.id}`)}
                canEdit={isAdmin}
              />
            )}
          </div>
        </div>
      )}

      {zoneEdit && <ZoneModal zone={zoneEdit === "new" ? null : zoneEdit} onClose={() => setZoneEdit(null)} />}
      {officeEdit && <OfficeModal office={officeEdit.office as Office | null} zoneId={officeEdit.zoneId} onClose={() => setOfficeEdit(null)} />}
      {userEdit && <UserModal user={userEdit === "new" ? null : userEdit} onClose={() => setUserEdit(null)} />}
      <OfficePasswordModal open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </div>
  );
}

/* ------------------------------------------------------- Pieces del árbol */

function Chevron({ expanded, small, onClick, label }: { expanded: boolean; small?: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className={cx("grid shrink-0 place-items-center rounded-md text-tenue-2 transition hover:bg-papel-2 hover:text-tinta", small ? "size-6" : "size-7")} aria-label={label} aria-expanded={expanded}>
      <ChevronRight className={cx("transition-transform", small ? "size-3.5" : "size-4", expanded && "rotate-90")} aria-hidden />
    </button>
  );
}

function TreeButton({ selected, onClick, children, trailing, dot, className }: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  trailing?: ReactNode;
  dot?: boolean;
  className?: string;
}) {
  return (
    <button type="button" onClick={onClick} data-selected={selected} className={cx("tree-item flex-1", className)}>
      {dot !== undefined && <span className={cx("size-1.5 shrink-0 rounded-full", dot ? "bg-emerald-500" : "bg-linea-fuerte")} aria-hidden />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
    </button>
  );
}

function PanelHead({ eyebrow, title, subtitle, actions, tabs }: {
  eyebrow: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
}) {
  return (
    <div className="panel-head">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2 className="mt-1 text-lg font-bold text-tinta">{title}</h2>{subtitle && <p className="mt-1 text-[0.82rem] text-tenue">{subtitle}</p>}</div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
      {tabs}
    </div>
  );
}

/* -------------------------------------------------------- Fichas de detalle */

function ZonePanel({ zone, offices, section, onSection, onOpenOffice, onEdit, onAddOffice, canEdit }: {
  zone: Zone;
  offices: Space[];
  section: Section;
  onSection: (s: Section) => void;
  onOpenOffice: (id: string) => void;
  onEdit: () => void;
  onAddOffice: () => void;
  canEdit: boolean;
}) {
  return (
    <div className="panel animate-rise overflow-hidden">
      <PanelHead
        eyebrow="Zona"
        title={zone.name}
        subtitle={`${zone.code}${zone.description ? ` · ${zone.description}` : ""}`}
        actions={<>{canEdit && <Button size="sm" variant="secondary" onClick={onEdit}><Pencil className="size-4" /> Editar</Button>}{canEdit && <Button size="sm" onClick={onAddOffice}><Plus className="size-4" /> Oficina</Button>}</>}
        tabs={<Segmented ariaLabel="Secciones de la zona" value={section} onChange={onSection} options={[{ value: "resumen", label: "Resumen" }, { value: "oficinas", label: "Oficinas", count: offices.length }]} />}
      />
      <div className="panel-body">
        {section === "resumen" ? (
          <>
            <div className="grid gap-2.5 sm:grid-cols-3">
              <Stat label="Oficinas" value={zone.office_count} helper={`${offices.filter((o) => o.active).length} activas`} />
              <Stat label="Usuarios" value={zone.user_count} helper="Personal con cuenta" />
              <Stat label="Equipos" value={zone.equipment_count} helper="Inventario asignado" />
            </div>
            {offices.length > 0 && (
              <p className="mt-4 text-[0.8rem] text-tenue">
                La zona reúne {offices.length} {offices.length === 1 ? "oficina" : "oficinas"} y {zone.user_count} {zone.user_count === 1 ? "usuario" : "usuarios"}.
                Abra la pestaña <span className="font-semibold text-tinta">Oficinas</span> para verlas una a una.
              </p>
            )}
          </>
        ) : offices.length === 0 ? (
          <p className="py-8 text-center text-[0.85rem] text-tenue">Esta zona todavía no tiene oficinas.</p>
        ) : (
          <ul className="divide-y divide-linea">
            {offices.map((office) => (
              <li key={office.id}>
                <button type="button" onClick={() => onOpenOffice(office.id)} className="flex w-full items-center gap-3 py-2.5 text-left transition hover:bg-papel-2/60">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.9rem] font-bold text-tinta">{office.name}</span>
                    <span className="mt-0.5 block truncate text-[0.78rem] text-tenue">{office.code}{office.head_name ? ` · ${office.head_name}` : ""}</span>
                  </span>
                  <Badge className={SERVICE_TONE[office.service_level]}>{SERVICE_LEVEL[office.service_level]}</Badge>
                  <ChevronRight className="size-4 shrink-0 text-tenue-2" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function OfficePanel({ office, users, section, onSection, onOpenUser, onEdit, onProfile, canEdit, showDevices }: {
  office: Space;
  users: MunicipalUser[];
  section: Section;
  onSection: (s: Section) => void;
  onOpenUser: (id: string) => void;
  onEdit: () => void;
  onProfile: () => void;
  canEdit: boolean;
  showDevices: boolean;
}) {
  return (
    <div className="panel animate-rise overflow-hidden">
      <PanelHead
        eyebrow={`Oficina · ${office.zone_name ?? "Sin zona"}`}
        title={office.name}
        subtitle={<>
          {office.code}
          {office.username && <> · usuario de acceso <span className="font-semibold text-tinta-2">{office.username}</span></>}
          {!office.active && <Badge className="ml-2 border-linea bg-papel-2 text-tenue">Inactiva</Badge>}
        </>}
        actions={<>{canEdit && <Button size="sm" variant="secondary" onClick={onEdit}><Pencil className="size-4" /> Editar</Button>}<Button size="sm" variant="ghost" onClick={onProfile}>Ficha completa →</Button></>}
        tabs={<Segmented ariaLabel="Secciones de la oficina" value={section} onChange={onSection} options={[{ value: "resumen", label: "Ficha" }, { value: "usuarios", label: "Personal", count: users.length }]} />}
      />
      <div className="panel-body">
        {section === "resumen" ? (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <dl className="kv"><dt>Perfil de servicio</dt><dd><Badge className={SERVICE_TONE[office.service_level]}>{SERVICE_LEVEL[office.service_level]}</Badge></dd></dl>
              <dl className="kv"><dt>Ubicación</dt><dd>{office.location ?? "—"}</dd></dl>
              <dl className="kv"><dt>Responsable</dt><dd>{office.head_name ?? "—"}</dd></dl>
              <dl className="kv"><dt>Teléfono / anexo</dt><dd>{office.head_phone ?? "—"}</dd></dl>
              <dl className="kv"><dt>Peso de prioridad IA</dt><dd>{office.priority_weight.toFixed(2)}×</dd></dl>
              <dl className="kv"><dt>Estado</dt><dd>{office.active ? "Activa" : "Inactiva"}</dd></dl>
            </div>

            {office.service_reason && (
              <p className="notice"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-casma" aria-hidden /><span><span className="notice-strong">Función declarada: </span>{office.service_reason}</span></p>
            )}

            {showDevices && (
              <div className="grid gap-2.5 sm:grid-cols-2">
                <Stat label="Dispositivos autorizados" value={office.devices_approved ?? 0} tone="positive" />
                <Stat label="Esperando autorización" value={office.devices_pending ?? 0} tone={office.devices_pending ? "warning" : "default"} helper={office.devices_pending ? "Pendiente en la pestaña Dispositivos" : "Nada pendiente"} />
              </div>
            )}
          </div>
        ) : users.length === 0 ? (
          <p className="py-8 text-center text-[0.85rem] text-tenue">Esta oficina todavía no tiene personal registrado.</p>
        ) : (
          <ul className="divide-y divide-linea">
            {users.map((user) => (
              <li key={user.id}>
                <button type="button" onClick={() => onOpenUser(user.id)} className="flex w-full items-center gap-3 py-2.5 text-left transition hover:bg-papel-2/60">
                  <Avatar user={user} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.88rem] font-semibold text-tinta">{user.full_name}</span>
                    <span className="mt-0.5 block truncate text-[0.76rem] text-tenue">{user.job_title ?? "Sin cargo"} · {user.equipment_count} equipo{user.equipment_count === 1 ? "" : "s"}</span>
                  </span>
                  {!user.active && <Badge className="border-linea bg-papel-2 text-tenue">Inactivo</Badge>}
                  <ChevronRight className="size-4 shrink-0 text-tenue-2" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function UserPanel({ user, onEdit, onProfile, canEdit }: { user: MunicipalUser; onEdit: () => void; onProfile: () => void; canEdit: boolean }) {
  return (
    <div className="panel animate-rise overflow-hidden">
      <PanelHead
        eyebrow="Personal municipal"
        title={<span className="flex items-center gap-3"><Avatar user={user} large /><span className="min-w-0">{user.full_name}</span></span>}
        subtitle={<>{user.job_title ?? "Sin cargo registrado"} · {user.zone_name ?? "Sin zona"} → {user.office_name}{!user.active && <Badge className="ml-2 border-linea bg-papel-2 text-tenue">Inactivo</Badge>}</>}
        actions={<>{canEdit && <Button size="sm" variant="secondary" onClick={onEdit}><Pencil className="size-4" /> Editar</Button>}<Button size="sm" variant="ghost" onClick={onProfile}>Historial →</Button></>}
      />
      <div className="panel-body">
        <div className="grid gap-2.5 sm:grid-cols-3">
          <Stat label="Equipos asignados" value={user.equipment_count} />
          <Stat label="Código de trabajador" value={<span className="text-base">{user.employee_code ?? "—"}</span>} />
          <Stat label="Incidencias" value={<span className="text-base">Ver historial</span>} helper="En la ficha detallada" />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <dl className="kv"><dt>Correo</dt><dd className="truncate">{user.email ?? "—"}</dd></dl>
          <dl className="kv"><dt>Teléfono / anexo</dt><dd>{user.phone ?? "—"}</dd></dl>
        </div>
      </div>
    </div>
  );
}

function Avatar({ user, large = false }: { user: MunicipalUser; large?: boolean }) {
  const size = large ? "size-11 text-sm" : "size-8 text-[0.68rem]";
  return user.photo_url ? (
    <img src={user.photo_url} alt="" className={cx(size, "shrink-0 rounded-lg border border-linea object-cover")} />
  ) : (
    <span className={cx(size, "grid shrink-0 place-items-center rounded-lg bg-casma-claro font-bold text-casma-oscuro")}>{initials(user.full_name)}</span>
  );
}

/* ------------------------------------------------------------- Modales */

function ZoneModal({ zone, onClose }: { zone: Zone | null; onClose: () => void }) {
  const [form, setForm] = useState({ code: zone?.code ?? "", name: zone?.name ?? "", description: zone?.description ?? "", active: zone?.active ?? true });
  const qc = useQueryClient();
  const toast = useToast();
  const save = useMutation({
    mutationFn: () => zone
      ? api<Zone>(`/organization/zones/${zone.id}`, { method: "PATCH", json: { name: form.name, description: form.description.trim() || null, active: form.active } })
      : api<Zone>("/organization/zones", { json: { code: form.code, name: form.name, description: form.description.trim() || null } }),
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ["organization", "zones"] });
      qc.invalidateQueries({ queryKey: ["offices"] });
      toast({ tone: "success", title: zone ? "Zona actualizada" : "Zona creada", body: saved.name });
      onClose();
    },
  });

  return (
    <Modal open onClose={onClose} title={zone ? `Editar ${zone.name}` : "Nueva zona"}>
      <form className="flex flex-col gap-3.5" onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}>
        <Field label="Código">{(id) => <Input id={id} value={form.code} disabled={!!zone} onChange={(e) => setForm({ ...form, code: e.target.value })} required maxLength={30} />}</Field>
        <Field label="Nombre">{(id) => <Input id={id} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={120} placeholder="Ej. Complejo Municipal" />}</Field>
        <Field label="Descripción" hint="Opcional. Aparece en la ficha de la zona.">{(id) => <Input id={id} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={300} />}</Field>
        {zone && <Check label="Zona activa" checked={form.active} onChange={(v) => setForm({ ...form, active: v })} />}
        {save.error && <ErrorBox message={errorMessage(save.error)} />}
        <FormActions onCancel={onClose} loading={save.isPending} />
      </form>
    </Modal>
  );
}

function OfficeModal({ office, zoneId, onClose }: { office: Office | null; zoneId: string; onClose: () => void }) {
  const [form, setForm] = useState({
    code: office?.code ?? "", name: office?.name ?? "", username: office?.username ?? "", zone_id: office?.zone_id ?? zoneId,
    location: office?.location ?? "", head_name: office?.head_name ?? "", head_phone: office?.head_phone ?? "",
    service_level: (office?.service_level ?? "NORMAL") as OfficeServiceLevel, service_reason: office?.service_reason ?? "",
    priority_weight: office?.priority_weight ?? 1, active: office?.active ?? true,
  });
  const zones = useZones();
  const qc = useQueryClient();
  const toast = useToast();
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name, username: form.username, zone_id: form.zone_id || null,
        location: form.location || null, head_name: form.head_name || null, head_phone: form.head_phone || null,
        service_level: form.service_level, service_reason: form.service_reason.trim() || null, priority_weight: form.priority_weight,
      };
      return office
        ? api<Office>(`/admin/offices/${office.id}`, { method: "PATCH", json: { ...body, active: form.active } })
        : api<Office>("/admin/offices", { json: { ...body, code: form.code } });
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ["offices"] });
      toast({ tone: "success", title: office ? "Oficina actualizada" : "Oficina creada", body: `Usuario de acceso: ${saved.username}` });
      onClose();
    },
  });
  const bind = (k: keyof typeof form) => ({
    value: String(form[k]),
    onChange: (e: { target: { value: string } }) => setForm((s) => ({ ...s, [k]: k === "priority_weight" ? Number(e.target.value) : e.target.value })),
  });

  return (
    <Modal open onClose={onClose} title={office ? `Editar ${office.name}` : "Nueva oficina"} subtitle="Cada oficina accede al sistema con un usuario propio.">
      <form className="flex flex-col gap-3.5" onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Código">{(id) => <Input id={id} {...bind("code")} disabled={!!office} required minLength={2} maxLength={20} />}</Field>
          <Field label="Usuario de acceso">{(id) => <Input id={id} {...bind("username")} required autoCapitalize="none" pattern="[a-z0-9][a-z0-9._\-]{2,39}" />}</Field>
        </div>
        <Field label="Nombre">{(id) => <Input id={id} {...bind("name")} required minLength={3} maxLength={120} />}</Field>
        <Field label="Zona">{(id) => <Select id={id} {...bind("zone_id")} required><option value="">Seleccione una zona</option>{zones.data?.filter((z) => z.active).map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</Select>}</Field>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Ubicación" hint="Ayuda a detectar fallas masivas por piso.">{(id) => <Input id={id} {...bind("location")} placeholder="Piso 2, Palacio municipal" maxLength={120} />}</Field>
          <Field label="Teléfono / anexo">{(id) => <Input id={id} {...bind("head_phone")} maxLength={20} />}</Field>
        </div>
        <Field label="Responsable">{(id) => <Input id={id} {...bind("head_name")} maxLength={120} />}</Field>
        <Field label="Perfil de servicio" hint="El triaje automático eleva la prioridad de oficinas sensibles.">
          {(id) => (
            <Select
              id={id}
              value={form.service_level}
              onChange={(e) => {
                const level = e.target.value as OfficeServiceLevel;
                setForm((s) => ({ ...s, service_level: level, priority_weight: SERVICE_WEIGHT[level] }));
              }}
            >
              <option value="NORMAL">Normal</option>
              <option value="ATENCION_PUBLICO">Atención al público</option>
              <option value="SERVICIO_CRITICO">Servicio crítico</option>
            </Select>
          )}
        </Field>
        <Field label="Motivo / función" hint="Ej. Mesa de Partes, Caja, atención tributaria.">{(id) => <Input id={id} {...bind("service_reason")} maxLength={160} />}</Field>
        <Field label={`Peso de prioridad IA · ${form.priority_weight.toFixed(2)}×`} hint="Se ajusta según el perfil; puede afinarlo si TI lo necesita.">
          {(id) => <input id={id} type="range" min={0.5} max={2} step={0.1} {...bind("priority_weight")} className="w-full accent-casma" />}
        </Field>
        {office && <Check label="Oficina activa" checked={form.active} onChange={(v) => setForm({ ...form, active: v })} />}
        {save.error && <ErrorBox message={errorMessage(save.error)} />}
        <FormActions onCancel={onClose} loading={save.isPending} />
      </form>
    </Modal>
  );
}

function UserModal({ user, onClose }: { user: MunicipalUser | null; onClose: () => void }) {
  const offices = useOfficeLookup();
  const [form, setForm] = useState({
    employee_code: user?.employee_code ?? "", full_name: user?.full_name ?? "",
    office_id: user?.office_id ?? "", job_title: user?.job_title ?? "",
    email: user?.email ?? "", phone: user?.phone ?? "", active: user?.active ?? true,
  });
  const qc = useQueryClient();
  const toast = useToast();
  const save = useMutation({
    mutationFn: () => {
      const body = {
        employee_code: form.employee_code.trim() || null, full_name: form.full_name, office_id: form.office_id,
        job_title: form.job_title.trim() || null, email: form.email.trim() || null, phone: form.phone.trim() || null,
        ...(user ? { active: form.active } : {}),
      };
      return user
        ? api<MunicipalUser>(`/organization/users/${user.id}`, { method: "PATCH", json: body })
        : api<MunicipalUser>("/organization/users", { json: body });
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ["organization", "users"] });
      qc.invalidateQueries({ queryKey: ["organization", "zones"] });
      toast({ tone: "success", title: user ? "Usuario actualizado" : "Usuario registrado", body: saved.full_name });
      onClose();
    },
  });
  const text = (k: "employee_code" | "full_name" | "office_id" | "job_title" | "email" | "phone") => ({
    value: form[k],
    onChange: (e: { target: { value: string } }) => setForm((s) => ({ ...s, [k]: e.target.value })),
  });

  return (
    <Modal open onClose={onClose} title={user ? `Editar ${user.full_name}` : "Nuevo usuario municipal"}>
      <form className="flex flex-col gap-3.5" onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Código de trabajador">{(id) => <Input id={id} {...text("employee_code")} maxLength={40} placeholder="Opcional" />}</Field>
          <Field label="Nombre completo">{(id) => <Input id={id} {...text("full_name")} required maxLength={120} />}</Field>
        </div>
        <Field label="Oficina" hint="La zona se hereda de la oficina.">{(id) => <Select id={id} {...text("office_id")} required><option value="">Seleccione oficina</option>{offices.data?.map((o) => <option key={o.id} value={o.id}>{o.zone_name ? `${o.zone_name} › ${o.name}` : o.name}</option>)}</Select>}</Field>
        <Field label="Cargo / función">{(id) => <Input id={id} {...text("job_title")} maxLength={120} placeholder="Ej. Cajero, asistente, jefe de área" />}</Field>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Correo">{(id) => <Input id={id} type="email" {...text("email")} maxLength={120} />}</Field>
          <Field label="Teléfono / anexo">{(id) => <Input id={id} {...text("phone")} maxLength={20} />}</Field>
        </div>
        {user && <Check label="Usuario activo" checked={form.active} onChange={(v) => setForm({ ...form, active: v })} />}
        {save.error && <ErrorBox message={errorMessage(save.error)} />}
        <FormActions onCancel={onClose} loading={save.isPending} />
      </form>
    </Modal>
  );
}

function OfficePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const qc = useQueryClient();
  const toast = useToast();
  const status = useQuery({
    queryKey: ["office-password"],
    queryFn: () => api<{ configured: boolean; updated_at: string | null }>("/admin/settings/office-password"),
    enabled: open,
  });
  const save = useMutation({
    mutationFn: () => api<{ message: string }>("/admin/settings/office-password", { method: "PUT", json: { new_password: password } }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["office-password"] });
      toast({ tone: "success", title: result.message });
      setPassword("");
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Contraseña común de oficinas" subtitle="Se comparte por todas las oficinas de la municipalidad.">
      <form className="flex flex-col gap-3.5" onSubmit={(e: FormEvent) => { e.preventDefault(); if (confirm("Todas las oficinas deberán volver a ingresar. ¿Continuar?")) save.mutate(); }}>
        <p className="notice">
          <KeyRound className="mt-0.5 size-4 shrink-0 text-tenue-2" aria-hidden />
          <span>
            {status.data?.configured ? `Última actualización: ${status.data.updated_at ? fmtDateTime(status.data.updated_at) : "sin fecha"}.` : "Aún no se ha definido la contraseña."}
            {" "}Al cambiarla se cierra la sesión en todos los equipos; los dispositivos autorizados no se revocan.
          </span>
        </p>
        <Field label="Nueva contraseña" hint="Mínimo 10 caracteres, con letras y números.">
          {(id) => <Input id={id} type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" required minLength={10} />}
        </Field>
        {save.error && <ErrorBox message={errorMessage(save.error)} />}
        <FormActions onCancel={onClose} loading={save.isPending} submit="Cambiar contraseña" />
      </form>
    </Modal>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex min-h-10 items-center gap-2.5 text-[0.85rem] font-semibold text-tinta-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-casma" />
      {label}
    </label>
  );
}

function FormActions({ onCancel, loading, submit = "Guardar" }: { onCancel: () => void; loading: boolean; submit?: string }) {
  return (
    <div className="mt-1 flex justify-end gap-2 border-t border-linea pt-3.5">
      <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
      <Button type="submit" variant="primary" loading={loading}>{submit}</Button>
    </div>
  );
}
