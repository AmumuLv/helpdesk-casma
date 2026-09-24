import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Building2, Camera, ClipboardList, MapPinned, Monitor, UserRound, Users } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router";
import { PhotoPicker } from "../../components/PhotoPicker";
import { useToast } from "../../components/Toasts";
import { Badge, Button, Card, ErrorBox, PriorityBadge, Spinner, StatusBadge } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { CATEGORY_LABEL, EQUIPMENT_LABEL, EQUIPMENT_STATUS_LABEL, fmtDateTime } from "../../lib/labels";
import type { MunicipalUser, MunicipalUserProfile, OfficeProfile, OfficeServiceLevel, Page, Ticket, ZoneProfile } from "../../lib/types";
import { useIsAdmin } from "./hooks";

type ProfileKind = "zona" | "oficina" | "usuario";

const SERVICE_LEVEL_LABEL: Record<OfficeServiceLevel, string> = {
  NORMAL: "Normal",
  ATENCION_PUBLICO: "Atención al público",
  SERVICIO_CRITICO: "Servicio crítico",
};


export function OrganizationProfilePage({ kind }: { kind: ProfileKind }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();

  const endpoint =
    kind === "zona"
      ? `/organization/zones/${id}/profile`
      : kind === "oficina"
        ? `/organization/offices/${id}/profile`
        : `/organization/users/${id}/profile`;

  const profile = useQuery({
    queryKey: ["organization", "profile", kind, id],
    queryFn: () =>
      kind === "zona"
        ? api<ZoneProfile>(endpoint)
        : kind === "oficina"
          ? api<OfficeProfile>(endpoint)
          : api<MunicipalUserProfile>(endpoint),
    enabled: !!id,
  });

  if (profile.isLoading) return <Spinner />;
  if (!profile.data) return <ErrorBox message={errorMessage(profile.error)} />;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}><ArrowLeft className="size-4" /> Volver</Button>
      </div>
      {kind === "zona" && <ZoneProfileView data={profile.data as ZoneProfile} />}
      {kind === "oficina" && <OfficeProfileView data={profile.data as OfficeProfile} />}
      {kind === "usuario" && <UserProfileView data={profile.data as MunicipalUserProfile} isAdmin={isAdmin} />}
    </div>
  );
}

function ZoneProfileView({ data }: { data: ZoneProfile }) {
  const navigate = useNavigate();
  const { zone, offices, recent_tickets } = data;

  return (
    <>
      <ProfileHeader
        icon={<MapPinned className="size-7" />}
        title={zone.name}
        subtitle={`Zona · ${zone.code}`}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Oficinas" value={zone.office_count} icon={<Building2 />} />
        <Metric label="Usuarios" value={zone.user_count} icon={<Users />} />
        <Metric label="Equipos" value={zone.equipment_count} icon={<Monitor />} />
      </div>

      {zone.description && <Card className="p-4"><p className="text-sm">{zone.description}</p></Card>}

      <section>
        <h2 className="mb-3 text-lg font-bold">Oficinas de la zona</h2>
        <div className="grid gap-3 lg:grid-cols-2">
          {offices.map((office) => (
            <button
              type="button"
              key={office.id}
              onClick={() => navigate(`/soporte/organizacion/oficina/${office.id}`)}
              className="rounded-2xl border border-linea bg-white p-4 text-left transition hover:border-casma hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-bold">{office.name}</p>
                  <p className="text-sm text-tenue">{office.code}{office.location ? ` · ${office.location}` : ""}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge className={office.service_level === "SERVICIO_CRITICO" ? "border-alerta/30 bg-alerta-claro text-alerta" : office.service_level === "ATENCION_PUBLICO" ? "border-sol/40 bg-sol-claro" : "border-linea bg-papel text-tenue"}>
                    {SERVICE_LEVEL_LABEL[office.service_level]}
                  </Badge>
                  {!office.active && <Badge className="border-linea bg-papel text-tenue">Inactiva</Badge>}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
                <MiniMetric label="Usuarios" value={office.user_count} />
                <MiniMetric label="Equipos" value={office.equipment_count} />
                <MiniMetric label="Incidencias" value={office.ticket_count} />
              </div>
              {office.service_reason && <p className="mt-3 text-xs text-tenue">Función prioritaria: <strong className="text-tinta">{office.service_reason}</strong></p>}
              {office.head_name && <p className="mt-1 text-sm text-tenue">Responsable: <strong className="text-tinta">{office.head_name}</strong></p>}
            </button>
          ))}
        </div>
      </section>

      <TicketHistory tickets={recent_tickets} title="Actividad reciente de la zona" />
    </>
  );
}

function OfficeProfileView({ data }: { data: OfficeProfile }) {
  const navigate = useNavigate();
  const { office, users, equipment, ticket_count } = data;
  const [ticketPage, setTicketPage] = useState(1);
  const ticketHistory = useQuery({
    queryKey: ["organization", "office-tickets", office.id, ticketPage],
    queryFn: () => api<Page<Ticket>>(`/tickets?office_id=${office.id}&page=${ticketPage}&page_size=50`),
  });

  return (
    <>
      <ProfileHeader
        icon={<Building2 className="size-7" />}
        title={office.name}
        subtitle={office.zone_name ? `${office.zone_name} · Oficina ${office.code}` : `Oficina ${office.code}`}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Usuarios" value={users.length} icon={<Users />} />
        <Metric label="Equipos" value={equipment.length} icon={<Monitor />} />
        <Metric label="Incidencias" value={ticket_count} icon={<ClipboardList />} />
      </div>

      <Card className="grid gap-3 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Info label="Ubicación" value={office.location} />
        <Info label="Jefe / responsable" value={office.head_name} />
        <Info label="Perfil de servicio" value={SERVICE_LEVEL_LABEL[office.service_level]} />
        <Info label="Motivo de criticidad" value={office.service_reason} />
      </Card>

      <section>
        <h2 className="mb-3 text-lg font-bold">Usuarios municipales ({users.length})</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {users.map((user) => (
            <button
              type="button"
              key={user.id}
              onClick={() => navigate(`/soporte/organizacion/usuario/${user.id}`)}
              className="flex items-center gap-3 rounded-2xl border border-linea bg-white p-4 text-left transition hover:border-casma"
            >
              <UserAvatar user={user} />
              <div className="min-w-0">
                <p className="truncate font-bold">{user.full_name}</p>
                <p className="truncate text-sm text-tenue">{user.job_title ?? "Sin cargo registrado"}</p>
                <p className="mt-1 text-xs text-tenue">{user.equipment_count} equipo{user.equipment_count === 1 ? "" : "s"}</p>
              </div>
            </button>
          ))}
          {!users.length && <Card className="p-6 text-center text-tenue">No hay usuarios municipales registrados en esta oficina.</Card>}
        </div>
      </section>

      <EquipmentList equipment={equipment} />
      <section>
        <h2 className="mb-3 text-lg font-bold">Historial completo de incidencias ({ticket_count})</h2>
        {ticketHistory.isLoading ? <Spinner label="Cargando incidencias" /> : ticketHistory.error ? (
          <ErrorBox message={errorMessage(ticketHistory.error)} />
        ) : (
          <>
            <TicketHistory tickets={ticketHistory.data?.items ?? []} title="" />
            {ticket_count > 50 && (
              <div className="mt-3 flex items-center justify-between gap-3">
                <Button variant="secondary" disabled={ticketPage <= 1} onClick={() => setTicketPage((page) => Math.max(1, page - 1))}>Anterior</Button>
                <span className="text-sm text-tenue">Página {ticketPage} de {Math.max(1, Math.ceil(ticket_count / 50))}</span>
                <Button variant="secondary" disabled={ticketPage >= Math.ceil(ticket_count / 50)} onClick={() => setTicketPage((page) => page + 1)}>Siguiente</Button>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}

function UserProfileView({ data, isAdmin }: { data: MunicipalUserProfile; isAdmin: boolean }) {
  const { user, equipment, recent_tickets, ticket_count } = data;
  const qc = useQueryClient();
  const toast = useToast();
  const [photo, setPhoto] = useState<File | null>(null);

  const upload = useMutation({
    mutationFn: () => {
      if (!photo) throw new Error("Seleccione una fotografía.");
      const form = new FormData();
      form.append("file", photo);
      return api<MunicipalUser>(`/organization/users/${user.id}/photo`, { form });
    },
    onSuccess: () => {
      setPhoto(null);
      qc.invalidateQueries({ queryKey: ["organization", "profile", "usuario", user.id] });
      qc.invalidateQueries({ queryKey: ["organization", "users"] });
      toast({ tone: "success", title: "Fotografía actualizada", body: user.full_name });
    },
    onError: (err) => toast({ tone: "danger", title: "No se pudo guardar la fotografía", body: errorMessage(err) }),
  });

  const removePhoto = useMutation({
    mutationFn: () => api<MunicipalUser>(`/organization/users/${user.id}/photo`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["organization", "profile", "usuario", user.id] });
      qc.invalidateQueries({ queryKey: ["organization", "users"] });
      toast({ tone: "success", title: "Fotografía eliminada" });
    },
  });

  return (
    <>
      <Card className="p-5">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <UserAvatar user={user} large />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold">{user.full_name}</h1>
              {!user.active && <Badge className="border-linea bg-papel text-tenue">Inactivo</Badge>}
            </div>
            <p className="text-tenue">{user.job_title ?? "Sin cargo registrado"}</p>
            <p className="mt-1 text-sm">{user.zone_name ?? "Sin zona"} → {user.office_name}</p>
            <p className="mt-1 text-sm text-tenue">{user.employee_code ?? "Sin código de trabajador"}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-center">
            <MiniMetric label="Equipos" value={equipment.length} />
            <MiniMetric label="Incidencias" value={ticket_count} />
          </div>
        </div>
      </Card>

      <Card className="grid gap-3 p-4 text-sm sm:grid-cols-2">
        <Info label="Correo" value={user.email} />
        <Info label="Teléfono / anexo" value={user.phone} />
      </Card>

      {isAdmin && (
        <Card className="p-4">
          <h2 className="mb-3 flex items-center gap-2 font-bold"><Camera className="size-5" /> Fotografía del usuario</h2>
          <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
            <PhotoPicker value={photo} onChange={setPhoto} />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => upload.mutate()} loading={upload.isPending} disabled={!photo}>Guardar foto</Button>
              {user.photo_url && <Button variant="danger" onClick={() => confirm("¿Quitar la fotografía de este usuario?") && removePhoto.mutate()} loading={removePhoto.isPending}>Quitar foto</Button>}
            </div>
          </div>
        </Card>
      )}

      <EquipmentList equipment={equipment} />
      <TicketHistory tickets={recent_tickets} title={`Incidencias relacionadas (${ticket_count})`} />
    </>
  );
}

function ProfileHeader({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle: string }) {
  return (
    <Card className="flex items-center gap-4 p-5">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-casma-claro text-casma">{icon}</div>
      <div>
        <p className="text-sm font-bold uppercase tracking-wide text-tenue">{subtitle}</p>
        <h1 className="text-2xl font-bold">{title}</h1>
      </div>
    </Card>
  );
}

function Metric({ label, value, icon }: { label: string; value: number; icon: ReactNode }) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <div className="text-casma [&_svg]:size-6">{icon}</div>
      <div><strong className="block text-2xl">{value}</strong><span className="text-sm text-tenue">{label}</span></div>
    </Card>
  );
}

function MiniMetric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl bg-papel p-2"><strong className="block text-lg">{value}</strong><span className="text-xs text-tenue">{label}</span></div>;
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return <div><p className="text-xs font-bold uppercase tracking-wide text-tenue">{label}</p><p className="font-bold">{value || "–"}</p></div>;
}

function UserAvatar({ user, large = false }: { user: MunicipalUser; large?: boolean }) {
  const initials = user.full_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const size = large ? "size-28 text-3xl" : "size-14 text-lg";
  return user.photo_url ? (
    <img src={user.photo_url} alt={`Foto de ${user.full_name}`} className={`${size} shrink-0 rounded-2xl border border-linea object-cover`} />
  ) : (
    <div className={`${size} flex shrink-0 items-center justify-center rounded-2xl bg-casma-claro font-bold text-casma`}>
      {initials || <UserRound className="size-6" />}
    </div>
  );
}

function EquipmentList({ equipment }: { equipment: OfficeProfile["equipment"] }) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-bold">Equipos asignados ({equipment.length})</h2>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-linea bg-papel text-tenue">
              <tr><th className="p-3">ID TI</th><th className="p-3">Patrimonial</th><th className="p-3">Tipo</th><th className="p-3">Equipo</th><th className="p-3">IP</th><th className="p-3">Estado</th></tr>
            </thead>
            <tbody className="divide-y divide-linea">
              {equipment.map((item) => (
                <tr key={item.id}>
                  <td className="p-3 font-bold text-casma">{item.inventory_id ?? "–"}</td>
                  <td className="p-3 font-bold">{item.patrimonial_code}</td>
                  <td className="p-3">{EQUIPMENT_LABEL[item.type]}</td>
                  <td className="p-3">{item.hostname ?? item.device_label ?? ([item.brand, item.model].filter(Boolean).join(" ") || "–")}</td>
                  <td className="p-3">{item.ip_address ?? "–"}</td>
                  <td className="p-3"><Badge className="border-linea bg-papel">{EQUIPMENT_STATUS_LABEL[item.status]}</Badge></td>
                </tr>
              ))}
              {!equipment.length && <tr><td colSpan={6} className="p-8 text-center text-tenue">No hay equipos asignados.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}

function TicketHistory({ tickets, title }: { tickets: Ticket[]; title: string }) {
  return (
    <section>
      {title && <h2 className="mb-3 text-lg font-bold">{title}</h2>}
      <Card className="overflow-hidden">
        <ol className="divide-y divide-linea">
          {tickets.map((ticket) => (
            <li key={ticket.id} className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{ticket.number}</span>
                <StatusBadge status={ticket.status} />
                <PriorityBadge priority={ticket.priority} />
                <span className="text-sm text-tenue">{CATEGORY_LABEL[ticket.category]}</span>
                <span className="ml-auto text-xs text-tenue">{fmtDateTime(ticket.created_at)}</span>
              </div>
              <p className="mt-1 font-bold">{ticket.subject}</p>
              <p className="text-sm text-tenue">{ticket.office_name}{ticket.equipment ? ` · ${ticket.equipment.patrimonial_code}` : ""}</p>
              {ticket.resolution && <p className="mt-1 text-sm">Solución: {ticket.resolution.notes}</p>}
            </li>
          ))}
          {!tickets.length && <li className="p-8 text-center text-tenue">No hay incidencias registradas.</li>}
        </ol>
      </Card>
    </section>
  );
}
