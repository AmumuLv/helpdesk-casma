import { useInfiniteQuery } from "@tanstack/react-query";
import {
  Activity, AlertTriangle, ArrowRight, BrainCircuit, Building2, CheckCircle2, ChevronRight, Clock3,
  ListTodo, LoaderCircle, MapPin, PauseCircle, Search, UserRound, UsersRound, X,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { Button, Card, EmptyState, ErrorBox, Input, Modal, PriorityBadge, Select, Spinner, StatusBadge, cx } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { CATEGORIES, CATEGORY_LABEL, PRIORITY_LABEL } from "../../lib/labels";
import type { FollowUp, FollowUpState, Page, ResolutionType, Ticket, TicketCategory, TicketPriority, TicketStatus } from "../../lib/types";
import { useKpis, useMunicipalUsers, useOfficeLookup, useTechnicians, useZones } from "./hooks";
import { NewTicketForm } from "./NewTicketForm";
import { TicketDetail } from "./TicketDetail";

type View = TicketStatus | "ACTIVAS";
type WorkSort = "smart" | "created_desc" | "created_asc" | "priority_desc";
type ClosedSort = "closed_desc" | "closed_asc" | "duration_desc" | "duration_asc";
type Period = "all" | "today" | "7d" | "30d" | "90d" | "custom";
type FollowFilter = "" | Exclude<FollowUpState, "CERRADA" | "EN_SEGUIMIENTO">;

const TABS: { value: View; label: string }[] = [
  { value: "ACTIVAS", label: "Activas" },
  { value: "PENDIENTE", label: "Por atender" },
  { value: "EN_PROCESO", label: "En atención" },
  { value: "RESUELTO", label: "Cerradas" },
];

const WORK_SORT: Record<WorkSort, string> = {
  smart: "Prioridad de atención",
  created_desc: "Más recientes",
  created_asc: "Más antiguas",
  priority_desc: "Prioridad",
};

const CLOSED_SORT: Record<ClosedSort, string> = {
  closed_desc: "Cierre más reciente",
  closed_asc: "Cierre más antiguo",
  duration_desc: "Mayor duración",
  duration_asc: "Menor duración",
};

const PERIODS: Record<Period, string> = {
  all: "Todo el historial",
  today: "Hoy",
  "7d": "Últimos 7 días",
  "30d": "Últimos 30 días",
  "90d": "Últimos 90 días",
  custom: "Rango personalizado",
};

const RESOLUTION: Record<ResolutionType, string> = {
  SOLUCIONADO: "Solucionado",
  REPARADO: "Reparado",
  REQUIERE_REPUESTO: "Requiere repuesto",
  REEMPLAZADO: "Reemplazado",
  OBSOLETO: "Obsoleto",
  IRREPARABLE: "Irreparable",
  BAJA_PATRIMONIAL: "Baja patrimonial",
  DERIVADO: "Derivado",
};

const FOLLOW_LABEL: Record<Exclude<FollowUpState, "CERRADA" | "EN_SEGUIMIENTO">, string> = {
  EN_ESPERA: "En espera",
  SIN_ACTUALIZACION: "Sin actualización",
  REQUIERE_REVISION: "Requieren revisión",
};

/* ------------------------------------------------------------- Utilidades */

function inputDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rangeFor(period: Period, from: string, to: string) {
  if (period === "all") return {} as { from?: string; to?: string };
  if (period === "custom") {
    return { from: from ? `${from}T00:00:00-05:00` : undefined, to: to ? `${to}T23:59:59-05:00` : undefined };
  }
  const now = new Date();
  const start = new Date(now);
  const days = period === "today" ? 1 : period === "7d" ? 7 : period === "30d" ? 30 : 90;
  start.setDate(now.getDate() - days + 1);
  return { from: `${inputDate(start)}T00:00:00-05:00`, to: `${inputDate(now)}T23:59:59-05:00` };
}

function ago(value: string) {
  const m = Math.floor(Math.max(0, Date.now() - new Date(value).getTime()) / 60000);
  if (m < 1) return "Ahora";
  if (m < 60) return `Hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `Hace ${h} h`;
  const d = Math.floor(h / 24);
  return `Hace ${d} ${d === 1 ? "día" : "días"}`;
}

function when(value: string) {
  return new Date(value).toLocaleString("es-PE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(".", "");
}

function actionLabel(t: Ticket) {
  if (t.status === "RESUELTO") return "Ver o reabrir";
  if (t.status === "EN_PROCESO") return "Continuar";
  return t.assigned_to_id ? "Iniciar atención" : "Atender y asignar";
}

function technicianOf(t: Ticket) {
  return t.status === "RESUELTO" ? (t.resolution?.resolved_by_name || t.assigned_to_name) : t.assigned_to_name;
}

/* ------------------------------------------------------------------ Página */

export function Dashboard() {
  const kpis = useKpis();
  const zones = useZones();
  const offices = useOfficeLookup();
  const techs = useTechnicians();
  const [params, setParams] = useSearchParams();

  const [view, setView] = useState<View>("ACTIVAS");
  const [q, setQ] = useState("");
  const query = useDeferredValue(q.trim());
  const [openId, setOpenId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [mine, setMine] = useState(false);
  const [urgent, setUrgent] = useState(false);
  const [unassigned, setUnassigned] = useState(false);
  const [followFilter, setFollowFilter] = useState<FollowFilter>("");
  const [zone, setZone] = useState("");
  const [office, setOffice] = useState("");
  const [municipalUser, setMunicipalUser] = useState("");
  const [technician, setTechnician] = useState("");
  const [category, setCategory] = useState<"" | TicketCategory>("");
  const [priority, setPriority] = useState<"" | TicketPriority>("");
  const [createdDate, setCreatedDate] = useState("");
  const [workSort, setWorkSort] = useState<WorkSort>("smart");

  const [period, setPeriod] = useState<Period>("30d");
  const [closedFrom, setClosedFrom] = useState("");
  const [closedTo, setClosedTo] = useState("");
  const [closedSort, setClosedSort] = useState<ClosedSort>("closed_desc");
  const [resolution, setResolution] = useState<"" | ResolutionType>("");

  const users = useMunicipalUsers(office);
  const closed = view === "RESUELTO";
  const activeZones = (zones.data ?? []).filter((z) => z.active);
  const activeOffices = (offices.data ?? []).filter((o) => o.active && (!zone || o.zone_id === zone));
  const closedRange = useMemo(() => rangeFor(period, closedFrom, closedTo), [period, closedFrom, closedTo]);
  const advancedCount = closed
    ? [zone, office, municipalUser, technician, category, priority, resolution].filter(Boolean).length
    : [zone, office, municipalUser, technician, category, priority, createdDate, followFilter].filter(Boolean).length;

  useEffect(() => {
    const ticket = params.get("ticket");
    const status = params.get("status");
    if (ticket) setOpenId(ticket);
    if (status && TABS.some((x) => x.value === status)) setView(status as View);
    if (params.get("mine") === "1") setMine(true);
  }, [params]);

  const list = useInfiniteQuery({
    queryKey: ["workboard", {
      view, query, mine, urgent, unassigned, followFilter, zone, office, municipalUser, technician,
      category, priority, createdDate, workSort, period, closedFrom, closedTo, closedSort, resolution,
    }],
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ page: String(pageParam), page_size: "20", sort_by: closed ? closedSort : workSort });

      closed ? p.set("status", "RESUELTO") : p.set("active", "true");
      if (zone) p.set("zone_id", zone);
      if (office) p.set("office_id", office);
      if (municipalUser) p.set("user_id", municipalUser);
      if (category) p.set("category", category);
      if (query) p.set("q", query);

      if (closed) {
        if (closedRange.from) p.set("resolved_from", closedRange.from);
        if (closedRange.to) p.set("resolved_to", closedRange.to);
        if (technician) p.set("technician_id", technician);
        if (priority) p.set("priority", priority);
        if (resolution) p.set("resolution_type", resolution);
      } else {
        if (mine) p.set("assigned", "me");
        else if (unassigned) p.set("assigned", "none");
        else if (technician) p.set("technician_id", technician);
        if (urgent) p.set("priority", "ALTA");
        else if (priority) p.set("priority", priority);
        if (followFilter) p.set("follow_up_state", followFilter);
        if (createdDate) {
          p.set("created_from", `${createdDate}T00:00:00-05:00`);
          p.set("created_to", `${createdDate}T23:59:59-05:00`);
        }
      }

      return api<Page<Ticket>>(`/workboard/tickets?${p}`);
    },
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.page_size < last.total ? last.page + 1 : undefined),
  });

  const tickets = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;
  const k = kpis.data;
  const activeTotal = k ? k.pendientes + k.en_proceso : undefined;

  const chooseView = (next: View) => {
    setView(next);
    setMine(false);
    setUrgent(false);
    setUnassigned(false);
    setFollowFilter("");
  };

  const clearFilters = () => {
    setMine(false); setUrgent(false); setUnassigned(false); setFollowFilter("");
    setZone(""); setOffice(""); setMunicipalUser(""); setTechnician("");
    setCategory(""); setPriority(""); setCreatedDate(""); setWorkSort("smart");
    setPeriod("30d"); setClosedFrom(""); setClosedTo(""); setClosedSort("closed_desc"); setResolution("");
  };

  const closeCreate = () => {
    const next = new URLSearchParams(params);
    next.delete("new");
    setParams(next, { replace: true });
  };

  const closeTicket = () => {
    setOpenId(null);
    const next = new URLSearchParams(params);
    next.delete("ticket");
    next.delete("source");
    setParams(next, { replace: true });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* ------------------------------------------------- Indicadores */}
      <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4" aria-label="Resumen de incidencias">
        <Kpi label="Activas" value={activeTotal} helper={k ? `${k.sin_asignar} sin asignar` : ""} active={view === "ACTIVAS"} icon={<ListTodo className="size-4.5" />} tone="bg-casma-claro text-casma-oscuro" onClick={() => chooseView("ACTIVAS")} />
        <Kpi label="Por atender" value={k?.pendientes} helper={k?.nuevos_hoy ? `${k.nuevos_hoy} nuevas hoy` : ""} active={view === "PENDIENTE"} icon={<Clock3 className="size-4.5" />} tone="bg-amber-50 text-amber-700" onClick={() => chooseView("PENDIENTE")} />
        <Kpi label="En atención" value={k?.en_proceso} helper={k?.urgentes_abiertos ? `${k.urgentes_abiertos} urgentes` : ""} active={view === "EN_PROCESO"} icon={<LoaderCircle className="size-4.5" />} tone="bg-sky-50 text-sky-700" onClick={() => chooseView("EN_PROCESO")} />
        <Kpi label="Cerradas" value={k?.resueltos} helper={k ? `${k.cerrados_mes} este mes` : ""} active={view === "RESUELTO"} icon={<CheckCircle2 className="size-4.5" />} tone="bg-emerald-50 text-emerald-700" onClick={() => chooseView("RESUELTO")} />
      </section>

      {/* --------------------------------------------------- Bandeja */}
      <Card className="overflow-hidden">
        <header className="panel-head">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="eyebrow">Bandeja de trabajo</p>
              <div className="mt-1.5 flex items-center gap-2.5">
                <h1 className="text-lg font-bold tracking-[-0.02em] text-tinta">{closed ? "Historial de incidencias" : TABS.find((x) => x.value === view)?.label}</h1>
                {total > 0 && (
                  <span className="rounded-full bg-casma-claro px-2 py-0.5 text-[0.72rem] font-bold text-casma-oscuro">
                    {total}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[0.8rem] text-tenue">
                {total > 0 ? <><strong className="font-semibold text-tinta">{total}</strong> {total === 1 ? "caso" : "casos"}</> : "Sin casos en esta vista"}
              </p>
            </div>
            <div className="segmented overflow-x-auto" role="tablist" aria-label="Estado de las incidencias">
              {TABS.map((tab) => (
                <button key={tab.value} type="button" role="tab" aria-selected={view === tab.value} onClick={() => chooseView(tab.value)}>{tab.label}</button>
              ))}
            </div>
          </div>
        </header>

        <div className="toolbar">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-tenue-2" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar código, oficina, usuario, equipo o descripción" aria-label="Buscar incidencias" className="pl-8" />
          </div>

          {closed ? (
            <div className="flex flex-wrap items-center gap-2">
              <Select value={period} onChange={(e) => setPeriod(e.target.value as Period)} aria-label="Periodo" className="w-auto min-w-36">
                {(Object.keys(PERIODS) as Period[]).map((x) => <option key={x} value={x}>{PERIODS[x]}</option>)}
              </Select>
              <Select value={closedSort} onChange={(e) => setClosedSort(e.target.value as ClosedSort)} aria-label="Orden" className="w-auto min-w-40">
                {(Object.keys(CLOSED_SORT) as ClosedSort[]).map((x) => <option key={x} value={x}>{CLOSED_SORT[x]}</option>)}
              </Select>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Chip active={mine} icon={<UserRound className="size-3.5" />} onClick={() => { setMine((v) => !v); setUnassigned(false); setTechnician(""); }}>Mías</Chip>
              <Chip active={unassigned} icon={<UsersRound className="size-3.5" />} onClick={() => { setUnassigned((v) => !v); setMine(false); setTechnician(""); }}>Sin asignar</Chip>
              <Chip active={urgent} icon={<AlertTriangle className="size-3.5" />} onClick={() => { setUrgent((v) => !v); setPriority(""); }}>Urgentes</Chip>
              <Chip active={followFilter === "EN_ESPERA"} icon={<PauseCircle className="size-3.5" />} onClick={() => setFollowFilter((c) => (c === "EN_ESPERA" ? "" : "EN_ESPERA"))}>En espera</Chip>
              <Chip active={followFilter === "REQUIERE_REVISION"} icon={<BrainCircuit className="size-3.5" />} onClick={() => setFollowFilter((c) => (c === "REQUIERE_REVISION" ? "" : "REQUIERE_REVISION"))}>Revisar</Chip>
              <Select value={workSort} onChange={(e) => setWorkSort(e.target.value as WorkSort)} aria-label="Orden" className="w-auto min-w-40">
                {(Object.keys(WORK_SORT) as WorkSort[]).map((x) => <option key={x} value={x}>{WORK_SORT[x]}</option>)}
              </Select>
            </div>
          )}

          <Button variant={advancedCount ? "selected" : "secondary"} onClick={() => setFiltersOpen((v) => !v)} className="sm:ml-auto">
            Filtros{advancedCount ? ` · ${advancedCount}` : ""}
          </Button>
        </div>

        {filtersOpen && (
          <div className="border-b border-linea bg-papel-2/50 px-4 py-3.5 sm:px-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-[0.82rem] font-bold text-tinta">Filtros avanzados <span className="font-normal text-tenue">· Jerarquía Zona → Oficina → Usuario</span></p>
              <Button size="sm" variant="ghost" onClick={clearFilters}><X className="size-4" /> Limpiar</Button>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <Field label="Zona">
                <Select value={zone} onChange={(e) => { setZone(e.target.value); setOffice(""); setMunicipalUser(""); }}>
                  <option value="">Todas las zonas</option>
                  {activeZones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                </Select>
              </Field>
              <Field label="Oficina">
                <Select value={office} disabled={!zone} onChange={(e) => { setOffice(e.target.value); setMunicipalUser(""); }}>
                  <option value="">{zone ? "Todas de la zona" : "Elija primero una zona"}</option>
                  {activeOffices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </Select>
              </Field>
              <Field label="Usuario">
                <Select value={municipalUser} disabled={!office} onChange={(e) => setMunicipalUser(e.target.value)}>
                  <option value="">{office ? "Todos de la oficina" : "Elija primero una oficina"}</option>
                  {(users.data ?? []).filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.full_name}{u.job_title ? ` · ${u.job_title}` : ""}</option>)}
                </Select>
              </Field>
              <Field label={closed ? "Técnico que atendió" : "Técnico responsable"}>
                <Select value={technician} onChange={(e) => { setTechnician(e.target.value); setMine(false); setUnassigned(false); }}>
                  <option value="">Todos los técnicos</option>
                  {(techs.data ?? []).filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
                </Select>
              </Field>
              <Field label="Categoría">
                <Select value={category} onChange={(e) => setCategory(e.target.value as "" | TicketCategory)}>
                  <option value="">Todas</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                </Select>
              </Field>
              <Field label="Prioridad">
                <Select value={priority} onChange={(e) => { setPriority(e.target.value as "" | TicketPriority); setUrgent(false); }}>
                  <option value="">Todas</option>
                  {(["ALTA", "MEDIA", "BAJA"] as TicketPriority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
                </Select>
              </Field>
              {closed ? (
                <>
                  <Field label="Tipo de cierre">
                    <Select value={resolution} onChange={(e) => setResolution(e.target.value as "" | ResolutionType)}>
                      <option value="">Todos</option>
                      {(Object.keys(RESOLUTION) as ResolutionType[]).map((r) => <option key={r} value={r}>{RESOLUTION[r]}</option>)}
                    </Select>
                  </Field>
                  {period === "custom" && <>
                    <Field label="Cerrada desde"><Input type="date" value={closedFrom} onChange={(e) => setClosedFrom(e.target.value)} /></Field>
                    <Field label="Cerrada hasta"><Input type="date" value={closedTo} onChange={(e) => setClosedTo(e.target.value)} /></Field>
                  </>}
                </>
              ) : (
                <>
                  <Field label="Seguimiento" hint="Señal orientativa de la IA, no un SLA.">
                    <Select value={followFilter} onChange={(e) => setFollowFilter(e.target.value as FollowFilter)}>
                      <option value="">Todos los estados</option>
                      {(Object.keys(FOLLOW_LABEL) as (keyof typeof FOLLOW_LABEL)[]).map((key) => <option key={key} value={key}>{FOLLOW_LABEL[key]}</option>)}
                    </Select>
                  </Field>
                  <Field label="Fecha de registro"><Input type="date" value={createdDate} onChange={(e) => setCreatedDate(e.target.value)} /></Field>
                </>
              )}
            </div>
          </div>
        )}

        {(zone || office || municipalUser) && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-linea bg-papel-2/30 px-4 py-2 text-[0.78rem] text-tenue sm:px-5">
            <MapPin className="size-3.5 text-casma" aria-hidden />
            <span>{activeZones.find((z) => z.id === zone)?.name ?? "Todas las zonas"}</span>
            {office && <><ChevronRight className="size-3" aria-hidden /><span className="font-medium text-tinta-2">{offices.data?.find((o) => o.id === office)?.name}</span></>}
            {municipalUser && <><ChevronRight className="size-3" aria-hidden /><span className="font-medium text-tinta-2">{users.data?.find((u) => u.id === municipalUser)?.full_name}</span></>}
          </div>
        )}

        {list.isLoading ? <Spinner label="Cargando incidencias" /> : list.error ? <div className="p-4"><ErrorBox message={errorMessage(list.error)} /></div>
          : tickets.length === 0 ? <EmptyState icon={closed ? <CheckCircle2 /> : <ListTodo />} title={closed ? "No hay incidencias cerradas con estos filtros" : "No hay incidencias que coincidan"} />
            : <TicketList tickets={tickets} onOpen={setOpenId} />}

        {list.hasNextPage && (
          <div className="border-t border-linea p-3 text-center">
            <Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>Cargar más</Button>
          </div>
        )}
      </Card>

      <Modal open={params.get("new") === "1"} onClose={closeCreate} title="Nueva incidencia" wide>
        <NewTicketForm variant="modal" onCreated={(id) => { closeCreate(); setOpenId(id); }} />
      </Modal>
      <TicketDetail ticketId={openId} onClose={closeTicket} />
    </div>
  );
}

/* ------------------------------------------------------------------- Lista */

function TicketList({ tickets, onOpen }: { tickets: Ticket[]; onOpen: (id: string) => void }) {
  return (
    <>
      {/* Móvil: tarjetas */}
      <ul className="divide-y divide-linea md:hidden">
        {tickets.map((t) => (
          <li key={t.id} className={cx("p-4", t.status !== "RESUELTO" && t.priority === "ALTA" && "border-l-4 border-l-alerta")}>
            <TicketHeader ticket={t} onOpen={onOpen} />
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[0.78rem] text-tenue">
              <span className="inline-flex items-center gap-1.5"><Building2 className="size-3.5 text-casma" aria-hidden />{t.office_name}</span>
              <span>·</span>
              <span>{CATEGORY_LABEL[t.category]}</span>
              {t.equipment?.patrimonial_code && <><span>·</span><span>{t.equipment.patrimonial_code}</span></>}
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-linea/70 pt-3">
              <span className="text-[0.75rem] text-tenue">
                {t.status === "RESUELTO" && t.resolution?.resolved_at ? `Cerrada ${ago(t.resolution.resolved_at).toLowerCase()}` : ago(t.created_at)}
              </span>
              <Button size="sm" variant={t.status === "RESUELTO" ? "secondary" : "primary"} onClick={() => onOpen(t.id)}>{actionLabel(t)}</Button>
            </div>
          </li>
        ))}
      </ul>

      {/* Escritorio: tabla compacta */}
      <div className="hidden overflow-x-auto md:block">
        <table className="data-table">
          <thead>
            <tr>
              <th className="w-[2px] p-0"><span className="sr-only">Prioridad</span></th>
              <th className="w-[34%]">Incidencia</th>
              <th>Oficina y usuario</th>
              <th>Responsable</th>
              <th>Estado</th>
              <th className="text-right">Acción</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((t) => {
              const tech = technicianOf(t);
              return (
                <tr key={t.id}>
                  <td className="p-0">
                    <span
                      className={cx("block h-full min-h-11 w-[3px]", t.status === "RESUELTO" ? "prioridad-baja" : t.priority === "ALTA" ? "prioridad-alta" : t.priority === "MEDIA" ? "prioridad-media" : "prioridad-baja")}
                      title={t.status === "RESUELTO" ? "Cerrada" : `Prioridad ${PRIORITY_LABEL[t.priority].toLowerCase()}`}
                    />
                  </td>
                  <td>
                    <button type="button" onClick={() => onOpen(t.id)} className="group block w-full text-left">
                      <span className="text-[0.7rem] font-bold uppercase tracking-[0.06em] text-casma">{t.number}</span>
                      <span className="mt-0.5 block truncate font-semibold text-tinta transition group-hover:text-casma-oscuro">{t.subject}</span>
                      <span className="mt-0.5 line-clamp-1 block text-[0.78rem] text-tenue">{t.description || "Sin descripción adicional"}</span>
                    </button>
                  </td>
                  <td>
                    <p className="truncate text-[0.83rem] font-semibold text-tinta">{t.office_name}</p>
                    <p className="mt-0.5 truncate text-[0.76rem] text-tenue">
                      {t.status === "RESUELTO" ? "Reportó" : "Reporta"}: {t.reporter_name ?? "sin especificar"}
                    </p>
                    {t.equipment?.patrimonial_code && <p className="mt-0.5 truncate text-[0.76rem] text-tenue-2">Equipo {t.equipment.patrimonial_code}</p>}
                  </td>
                  <td>
                    <p className="truncate text-[0.83rem] font-semibold text-tinta-2">{tech ?? "Sin asignar"}</p>
                    {t.status === "RESUELTO" && t.resolution?.notes
                      ? <p className="mt-0.5 line-clamp-2 max-w-xs text-[0.76rem] text-tenue">{t.resolution.notes}</p>
                      : <div className="mt-1"><FollowUpPill followUp={t.follow_up} /></div>}
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1.5"><StatusBadge status={t.status} /><PriorityBadge priority={t.priority} /></div>
                    {t.status === "RESUELTO" && t.resolution?.resolved_at && <p className="mt-1 text-[0.72rem] text-tenue-2">{when(t.resolution.resolved_at)}</p>}
                  </td>
                  <td className="text-right">
                    <Button size="sm" variant={t.status === "RESUELTO" ? "secondary" : "primary"} onClick={() => onOpen(t.id)}>
                      {actionLabel(t)} <ArrowRight className="size-3.5" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function TicketHeader({ ticket: t, onOpen }: { ticket: Ticket; onOpen: (id: string) => void }) {
  return (
    <button type="button" onClick={() => onOpen(t.id)} className="block w-full text-left">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="text-[0.7rem] font-bold uppercase tracking-[0.06em] text-tenue-2">{t.number}</span>
          <span className="mt-0.5 block text-[0.92rem] font-bold leading-snug text-tinta">{t.subject}</span>
          <span className="mt-0.5 line-clamp-2 block text-[0.8rem] leading-5 text-tenue">{t.description || "Sin descripción adicional"}</span>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <StatusBadge status={t.status} />
          <PriorityBadge priority={t.priority} />
        </div>
      </div>
    </button>
  );
}

function FollowUpPill({ followUp }: { followUp: FollowUp }) {
  if (followUp.state === "EN_SEGUIMIENTO" || followUp.state === "CERRADA") {
    return <span className="text-[0.75rem] text-tenue-2">Última actividad: {ago(followUp.last_activity_at).toLowerCase()}</span>;
  }
  const tone =
    followUp.state === "EN_ESPERA" ? "border-violet-200 bg-violet-50 text-violet-800"
      : followUp.state === "SIN_ACTUALIZACION" ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-orange-200 bg-orange-50 text-orange-800";
  return (
    <span className={cx("inline-flex max-w-full items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[0.7rem] font-semibold", tone)} title={followUp.detail}>
      <Activity className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{followUp.state === "EN_ESPERA" && followUp.wait_reason_label ? followUp.wait_reason_label : followUp.label}</span>
    </span>
  );
}

/* ------------------------------------------------------------- Controles */

function Kpi({ label, value, helper, active, icon, tone, onClick }: { label: string; value?: number; helper: string; active: boolean; icon: ReactNode; tone: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} data-active={active} aria-pressed={active} className="kpi group">
      <span className="flex items-start justify-between gap-2">
        <span className="stat-label">{label}</span>
        <span className={cx("grid size-8 shrink-0 place-items-center rounded-lg transition", active ? "bg-white/20 text-white" : cx(tone, "group-hover:scale-105"))}>{icon}</span>
      </span>
      <span className="stat-value block">{value ?? "–"}</span>
      <span className="stat-helper block">{helper || "Actualizando…"}</span>
    </button>
  );
}

function Chip({ active, icon, onClick, children }: { active: boolean; icon: ReactNode; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} data-active={active} className="chip">
      {icon}{children}
    </button>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}
