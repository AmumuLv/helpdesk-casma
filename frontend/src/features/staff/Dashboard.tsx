import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowRight, Check, CircleCheckBig, Clock3, FileClock, ListTodo, LoaderCircle, Search, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { Badge, Button, Card, CategoryBadge, cx, EmptyState, ErrorBox, Input, Modal, PriorityBadge, Select, Spinner, StatusBadge } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { CATEGORIES, CATEGORY_LABEL, PRIORITY_LABEL } from "../../lib/labels";
import type { Page, ResolutionType, Ticket, TicketCategory, TicketPriority, TicketStatus } from "../../lib/types";
import { useInsights, useKpis, useOfficeLookup, useTechnicians } from "./hooks";
import { NewTicketForm } from "./NewTicketForm";
import { TicketDetail } from "./TicketDetail";

type DashboardFilter = TicketStatus | "ACTIVAS";
type ClosedPeriod = "all" | "today" | "7d" | "30d" | "90d" | "custom";
type ClosedSort = "closed_desc" | "closed_asc" | "duration_desc" | "duration_asc";

const FILTERS: { value: DashboardFilter; label: string }[] = [
  { value: "ACTIVAS", label: "Activas" },
  { value: "PENDIENTE", label: "Pendientes" },
  { value: "EN_PROCESO", label: "En proceso" },
  { value: "RESUELTO", label: "Cerradas" },
];

const RESOLUTION_LABEL: Record<ResolutionType, string> = {
  SOLUCIONADO: "Solucionado",
  REPARADO: "Reparado",
  REQUIERE_REPUESTO: "Requiere repuesto",
  REEMPLAZADO: "Reemplazado",
  OBSOLETO: "Obsoleto",
  IRREPARABLE: "Irreparable",
  BAJA_PATRIMONIAL: "Baja patrimonial",
  DERIVADO: "Derivado",
};

const CLOSED_PERIOD_LABEL: Record<ClosedPeriod, string> = {
  all: "Todo el historial",
  today: "Hoy",
  "7d": "Últimos 7 días",
  "30d": "Últimos 30 días",
  "90d": "Últimos 90 días",
  custom: "Rango personalizado",
};

const CLOSED_SORT_LABEL: Record<ClosedSort, string> = {
  closed_desc: "Cierre más reciente",
  closed_asc: "Cierre más antiguo",
  duration_desc: "Mayor tiempo de resolución",
  duration_asc: "Menor tiempo de resolución",
};

type KpiTone = "active" | "pending" | "progress" | "closed";

const SELECTED_KPI = "border-[#D97706] bg-[#FFFBEB] ring-2 ring-[#F59E0B]/20 shadow-[0_16px_34px_rgba(217,119,6,0.14)]";

const KPI_TONE: Record<KpiTone, { iconWrap: string; active: string }> = {
  active: { iconWrap: "bg-casma-claro text-casma-oscuro", active: SELECTED_KPI },
  pending: { iconWrap: "bg-sol-claro text-[#713f12]", active: SELECTED_KPI },
  progress: { iconWrap: "bg-sky-50 text-sky-800", active: SELECTED_KPI },
  closed: { iconWrap: "bg-emerald-50 text-emerald-800", active: SELECTED_KPI },
};

function formatHours(hours: number | null | undefined) {
  if (hours == null) return "Sin datos";
  const totalMinutes = Math.max(1, Math.round(hours * 60));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${wholeHours} h ${minutes} min` : `${wholeHours} h`;
}

function formatTicketDuration(ticket: Ticket) {
  if (!ticket.resolution?.resolved_at) return "Sin dato";
  const milliseconds = new Date(ticket.resolution.resolved_at).getTime() - new Date(ticket.created_at).getTime();
  return formatHours(Math.max(0, milliseconds) / 3_600_000);
}

function countLabel(value: number, singular: string, plural: string) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function formatShortDate(value: string) {
  return new Date(value).toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" }).replace(".", "");
}

function formatClosedDate(value: string) {
  return new Date(value).toLocaleString("es-PE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).replace(".", "");
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildClosedRange(period: ClosedPeriod, customFrom: string, customTo: string) {
  if (period === "all") return {} as { from?: string; to?: string };
  if (period === "custom") {
    return {
      from: customFrom ? `${customFrom}T00:00:00-05:00` : undefined,
      to: customTo ? `${customTo}T23:59:59-05:00` : undefined,
    };
  }

  const today = new Date();
  const from = new Date(today);
  const days = period === "today" ? 1 : period === "7d" ? 7 : period === "30d" ? 30 : 90;
  from.setDate(today.getDate() - (days - 1));
  return {
    from: `${toDateInputValue(from)}T00:00:00-05:00`,
    to: `${toDateInputValue(today)}T23:59:59-05:00`,
  };
}

export function Dashboard() {
  const kpis = useKpis();
  const insights = useInsights();
  const offices = useOfficeLookup();
  const technicians = useTechnicians();
  const [status, setStatus] = useState<DashboardFilter>("ACTIVAS");
  const [mine, setMine] = useState(false);
  const [urgent, setUrgent] = useState(false);
  const [q, setQ] = useState("");
  const query = useDeferredValue(q.trim());
  const [openId, setOpenId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const [closedPeriod, setClosedPeriod] = useState<ClosedPeriod>("30d");
  const [closedFrom, setClosedFrom] = useState("");
  const [closedTo, setClosedTo] = useState("");
  const [closedOffice, setClosedOffice] = useState("");
  const [closedTechnician, setClosedTechnician] = useState("");
  const [closedCategory, setClosedCategory] = useState<"" | TicketCategory>("");
  const [closedPriority, setClosedPriority] = useState<"" | TicketPriority>("");
  const [closedResolution, setClosedResolution] = useState<"" | ResolutionType>("");
  const [closedSort, setClosedSort] = useState<ClosedSort>("closed_desc");
  const [showClosedFilters, setShowClosedFilters] = useState(false);

  const createOpen = searchParams.get("new") === "1";
  const urlQuery = searchParams.get("q") ?? "";
  const notificationSource = searchParams.get("source");
  const notificationStatus = searchParams.get("status");
  const notificationMine = searchParams.get("mine");
  const notificationTicket = searchParams.get("ticket");

  const closedRange = useMemo(() => buildClosedRange(closedPeriod, closedFrom, closedTo), [closedPeriod, closedFrom, closedTo]);
  const activeClosedFilters = [closedOffice, closedTechnician, closedCategory, closedPriority, closedResolution].filter(Boolean).length;

  useEffect(() => {
    setQ(urlQuery);
  }, [urlQuery]);

  useEffect(() => {
    if (notificationSource === "notifications" && notificationStatus) {
      const requested = FILTERS.find((item) => item.value === notificationStatus)?.value;
      if (requested) setStatus(requested);
      setMine(notificationMine === "1");
    }
    if (notificationTicket) setOpenId(notificationTicket);
  }, [notificationSource, notificationStatus, notificationMine, notificationTicket]);

  const closeCreate = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("new");
    setSearchParams(next, { replace: true });
  };

  const closeTicket = () => {
    setOpenId(null);
    if (!searchParams.has("ticket")) return;
    const next = new URLSearchParams(searchParams);
    next.delete("ticket");
    if (next.get("source") === "notifications" && !next.has("status") && !next.has("mine")) next.delete("source");
    setSearchParams(next, { replace: true });
  };

  const clearClosedFilters = () => {
    setClosedPeriod("30d");
    setClosedFrom("");
    setClosedTo("");
    setClosedOffice("");
    setClosedTechnician("");
    setClosedCategory("");
    setClosedPriority("");
    setClosedResolution("");
    setClosedSort("closed_desc");
  };

  const list = useInfiniteQuery({
    queryKey: ["tickets", {
      status, mine, urgent, query, closedPeriod, closedFrom, closedTo, closedOffice,
      closedTechnician, closedCategory, closedPriority, closedResolution, closedSort,
    }],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ page: String(pageParam), page_size: "20" });
      if (status === "ACTIVAS") params.set("active", "true");
      else params.set("status", status);

      if (status === "RESUELTO") {
        params.set("sort_by", closedSort);
        if (closedRange.from) params.set("resolved_from", closedRange.from);
        if (closedRange.to) params.set("resolved_to", closedRange.to);
        if (closedOffice) params.set("office_id", closedOffice);
        if (closedTechnician) params.set("resolved_by", closedTechnician);
        if (closedCategory) params.set("category", closedCategory);
        if (closedPriority) params.set("priority", closedPriority);
        if (closedResolution) params.set("resolution_type", closedResolution);
      } else {
        if (mine) params.set("assigned", "me");
        if (urgent) params.set("priority", "ALTA");
      }

      if (query) params.set("q", query);
      return api<Page<Ticket>>(`/tickets?${params}`);
    },
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.page_size < last.total ? last.page + 1 : undefined),
  });

  const tickets = list.data?.pages.flatMap((p) => p.items) ?? [];
  const totalResults = list.data?.pages[0]?.total ?? 0;
  const k = kpis.data;
  const activeTotal = k ? k.pendientes + k.en_proceso : undefined;

  const metricCards = useMemo(() => [
    {
      label: "Activos",
      value: activeTotal,
      icon: <ListTodo className="size-4" />,
      tone: "active" as const,
      detail: k ? `${countLabel(k.pendientes, "pendiente", "pendientes")} · ${countLabel(k.en_proceso, "en proceso", "en proceso")}` : undefined,
      onClick: () => setStatus("ACTIVAS"),
      active: status === "ACTIVAS",
    },
    {
      label: "Pendientes",
      value: k?.pendientes,
      icon: <Clock3 className="size-4" />,
      tone: "pending" as const,
      detail: k ? countLabel(k.sin_asignar, "sin asignar", "sin asignar") : undefined,
      onClick: () => setStatus("PENDIENTE"),
      active: status === "PENDIENTE",
    },
    {
      label: "En proceso",
      value: k?.en_proceso,
      icon: <LoaderCircle className="size-4" />,
      tone: "progress" as const,
      detail: k ? countLabel(k.urgentes_abiertos, "urgente", "urgentes") : undefined,
      onClick: () => setStatus("EN_PROCESO"),
      active: status === "EN_PROCESO",
    },
    {
      label: "Cerrados este mes",
      value: k?.cerrados_mes,
      icon: <CircleCheckBig className="size-4" />,
      tone: "closed" as const,
      detail: k ? `Histórico: ${k.resueltos} · Prom. ${formatHours(k.horas_resolucion_30d)}` : undefined,
      onClick: () => setStatus("RESUELTO"),
      active: status === "RESUELTO",
    },
  ], [activeTotal, k, status]);

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4" aria-label="Resumen de incidencias">
        {metricCards.map((card) => (
          <Kpi key={card.label} label={card.label} value={card.value} icon={card.icon} tone={card.tone} detail={card.detail} onClick={card.onClick} active={card.active} />
        ))}
      </section>

      {status !== "RESUELTO" && insights.data?.active_alerts.map((a) => (
        <div key={a.id} role="alert" className="flex items-start gap-3 rounded-2xl border border-alerta/20 bg-alerta-claro px-4 py-3 shadow-sm">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-alerta" aria-hidden />
          <div>
            <p className="font-bold text-alerta">{a.title}</p>
            <p className="mt-0.5 text-sm leading-5 text-tinta/85">{a.message}</p>
          </div>
        </div>
      ))}

      <Card className="overflow-hidden border-linea/80">
        <div className="border-b border-linea bg-white px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2" aria-hidden>
                <span className="h-1.5 w-8 rounded-full bg-casma" />
                <span className="h-1.5 w-3 rounded-full bg-sol" />
              </div>
              <h2 className="text-xl font-bold tracking-[-0.02em] text-tinta">{status === "RESUELTO" ? "Historial de incidencias" : "Incidencias"}</h2>
              {status === "RESUELTO" ? (
                <p className="mt-1 text-sm text-tenue">{totalResults} {totalResults === 1 ? "resultado" : "resultados"} con los filtros actuales · consulta soluciones y casos finalizados</p>
              ) : k ? (
                <p className="mt-1 text-sm text-tenue">{k.nuevos_hoy} {k.nuevos_hoy === 1 ? "registro nuevo hoy" : "registros nuevos hoy"}</p>
              ) : null}
            </div>

            <div className="-mx-1 overflow-x-auto px-1 pb-1">
              <div className="flex w-max gap-1 rounded-xl bg-papel p-1" role="tablist" aria-label="Filtrar incidencias por estado">
                {FILTERS.map((f) => (
                  <button
                    key={f.value}
                    role="tab"
                    aria-selected={status === f.value}
                    onClick={() => setStatus(f.value)}
                    className={cx(
                      "min-h-10 shrink-0 rounded-lg px-3.5 py-2 text-sm font-semibold transition sm:px-4",
                      status === f.value ? "bg-casma-oscuro text-white shadow-sm" : "text-tenue hover:bg-white hover:text-tinta",
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {status === "RESUELTO" && k && (
            <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
              <ClosedMetric label="Cerrados este mes" value={String(k.cerrados_mes)} />
              <ClosedMetric label="Prom. resolución · 30 días" value={formatHours(k.horas_resolucion_30d)} />
              <ClosedMetric label="Reaperturas · 30 días" value={String(k.reabiertos_30d)} />
              <ClosedMetric label="Histórico cerrado" value={String(k.resueltos)} />
            </div>
          )}

          <div className="mt-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="relative w-full max-w-xl">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tenue" aria-hidden />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar código, oficina, descripción o equipo" className="bg-papel pl-9 shadow-none" aria-label="Buscar incidencias" />
            </div>

            {status === "RESUELTO" ? (
              <div className="flex flex-wrap items-center gap-2">
                <Select value={closedPeriod} onChange={(e) => setClosedPeriod(e.target.value as ClosedPeriod)} aria-label="Periodo de incidencias cerradas" className="min-w-40">
                  {(Object.keys(CLOSED_PERIOD_LABEL) as ClosedPeriod[]).map((period) => <option key={period} value={period}>{CLOSED_PERIOD_LABEL[period]}</option>)}
                </Select>
                <Select value={closedSort} onChange={(e) => setClosedSort(e.target.value as ClosedSort)} aria-label="Ordenar incidencias cerradas" className="min-w-48">
                  {(Object.keys(CLOSED_SORT_LABEL) as ClosedSort[]).map((sort) => <option key={sort} value={sort}>{CLOSED_SORT_LABEL[sort]}</option>)}
                </Select>
                <Button variant="secondary" onClick={() => setShowClosedFilters((value) => !value)}>
                  <SlidersHorizontal className="size-4" /> Filtros{activeClosedFilters ? ` (${activeClosedFilters})` : ""}
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Toggle checked={mine} onChange={setMine} label="Mis casos" />
                <Toggle checked={urgent} onChange={setUrgent} label="Solo urgentes" />
              </div>
            )}
          </div>

          {status === "RESUELTO" && (showClosedFilters || activeClosedFilters > 0 || closedPeriod === "custom") && (
            <div className="mt-4 rounded-2xl border border-linea bg-papel/60 p-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {closedPeriod === "custom" && (
                  <>
                    <FilterField label="Cerradas desde">
                      <Input type="date" value={closedFrom} onChange={(e) => setClosedFrom(e.target.value)} />
                    </FilterField>
                    <FilterField label="Cerradas hasta">
                      <Input type="date" value={closedTo} onChange={(e) => setClosedTo(e.target.value)} />
                    </FilterField>
                  </>
                )}
                <FilterField label="Oficina">
                  <Select value={closedOffice} onChange={(e) => setClosedOffice(e.target.value)}>
                    <option value="">Todas las oficinas</option>
                    {offices.data?.map((office) => <option key={office.id} value={office.id}>{office.name}</option>)}
                  </Select>
                </FilterField>
                <FilterField label="Técnico que resolvió">
                  <Select value={closedTechnician} onChange={(e) => setClosedTechnician(e.target.value)}>
                    <option value="">Todos los técnicos</option>
                    {technicians.data?.filter((tech) => tech.active).map((tech) => <option key={tech.id} value={tech.id}>{tech.full_name}</option>)}
                  </Select>
                </FilterField>
                <FilterField label="Categoría">
                  <Select value={closedCategory} onChange={(e) => setClosedCategory(e.target.value as "" | TicketCategory)}>
                    <option value="">Todas las categorías</option>
                    {CATEGORIES.map((category) => <option key={category} value={category}>{CATEGORY_LABEL[category]}</option>)}
                  </Select>
                </FilterField>
                <FilterField label="Prioridad">
                  <Select value={closedPriority} onChange={(e) => setClosedPriority(e.target.value as "" | TicketPriority)}>
                    <option value="">Todas las prioridades</option>
                    {(["ALTA", "MEDIA", "BAJA"] as TicketPriority[]).map((priority) => <option key={priority} value={priority}>{PRIORITY_LABEL[priority]}</option>)}
                  </Select>
                </FilterField>
                <FilterField label="Tipo de resolución">
                  <Select value={closedResolution} onChange={(e) => setClosedResolution(e.target.value as "" | ResolutionType)}>
                    <option value="">Todos los tipos</option>
                    {(Object.keys(RESOLUTION_LABEL) as ResolutionType[]).map((resolution) => <option key={resolution} value={resolution}>{RESOLUTION_LABEL[resolution]}</option>)}
                  </Select>
                </FilterField>
              </div>
              <div className="mt-3 flex justify-end">
                <Button variant="ghost" size="sm" onClick={clearClosedFilters}>Limpiar filtros</Button>
              </div>
            </div>
          )}
        </div>

        {list.isLoading ? <Spinner /> : list.error ? <div className="p-4"><ErrorBox message={errorMessage(list.error)} /></div> : tickets.length === 0 ? (
          <EmptyState icon={<FileClock />} title={status === "RESUELTO" ? "No hay incidencias cerradas con estos filtros" : "No hay incidencias con estos filtros"} />
        ) : status === "RESUELTO" ? (
          <ClosedHistory tickets={tickets} onOpen={setOpenId} />
        ) : (
          <>
            <div className="divide-y divide-linea bg-white md:hidden">
              {tickets.map((t) => (
                <article key={t.id} className="p-4">
                  <button onClick={() => setOpenId(t.id)} className="block w-full text-left">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-bold uppercase tracking-[0.07em] text-tenue">{t.number}</p>
                        <h3 className="mt-1 text-base font-bold leading-5 text-tinta">{t.subject}</h3>
                      </div>
                      <span className="shrink-0 text-xs font-semibold text-tenue">{formatShortDate(t.created_at)}</span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm leading-5 text-tenue">{t.description || "Sin descripción adicional"}</p>
                  </button>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <PriorityBadge priority={t.priority} />
                    <StatusBadge status={t.status} />
                    <CategoryBadge category={t.category} />
                    <Badge className="border-slate-300 bg-slate-100 text-slate-800">{t.office_name}</Badge>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-3 border-t border-linea/70 pt-3">
                    <div className="min-w-0 text-xs text-tenue">
                      <p className="truncate">{t.equipment?.patrimonial_code ?? "Sin equipo asociado"}</p>
                      {(t.assigned_to_name || t.reporter_name) && <p className="mt-0.5 truncate">{t.assigned_to_name ?? t.reporter_name}</p>}
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <Button size="sm" variant="success" onClick={() => setOpenId(t.id)}>Atender</Button>
                      <Button size="sm" variant="secondary" onClick={() => setOpenId(t.id)} aria-label={`Ver detalle de ${t.number}`}><ArrowRight className="size-4" /></Button>
                    </div>
                  </div>
                </article>
              ))}
            </div>

            <div className="hidden overflow-x-auto bg-white md:block">
              <table className="min-w-full text-left">
                <thead className="bg-papel/70">
                  <tr className="text-xs font-bold uppercase tracking-[0.07em] text-tenue">
                    <th className="px-5 py-4 sm:px-6">Ticket</th>
                    <th className="px-5 py-4">Etiquetas</th>
                    <th className="px-5 py-4">Fecha</th>
                    <th className="px-5 py-4">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((t) => (
                    <tr key={t.id} className="border-t border-linea/80 align-top transition hover:bg-casma-claro/30">
                      <td className="px-5 py-4 sm:px-6">
                        <button onClick={() => setOpenId(t.id)} className="max-w-xl text-left">
                          <div className="text-xs font-bold uppercase tracking-[0.07em] text-tenue">{t.number}</div>
                          <div className="mt-1 text-base font-bold text-tinta">{t.subject}</div>
                          <div className="mt-1 max-w-xl text-sm leading-6 text-tenue">{t.description || "Sin descripción adicional"}</div>
                        </button>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex max-w-md flex-wrap gap-2">
                          <PriorityBadge priority={t.priority} />
                          <CategoryBadge category={t.category} />
                          <StatusBadge status={t.status} />
                          <Badge className="border-slate-300 bg-slate-100 text-slate-800">{t.office_name}</Badge>
                          {(t.assigned_to_name || t.reporter_name) && <Badge className="border-casma/20 bg-casma-claro text-casma-oscuro">{t.assigned_to_name ?? t.reporter_name}</Badge>}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-sm text-tenue">
                        <div className="font-semibold text-tinta">{formatShortDate(t.created_at)}</div>
                        <div className="mt-1">{t.equipment?.patrimonial_code ?? "Sin equipo"}</div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-col items-start gap-2 xl:flex-row xl:items-center">
                          <Button size="sm" variant="success" onClick={() => setOpenId(t.id)}>Atender</Button>
                          <Button size="sm" variant="ghost" onClick={() => setOpenId(t.id)}>Ver detalle <ArrowRight className="size-4" /></Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {list.hasNextPage && (
          <div className="border-t border-linea bg-white p-4 text-center">
            <Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>Cargar más</Button>
          </div>
        )}
      </Card>

      <Modal open={createOpen} onClose={closeCreate} title="Nueva incidencia" wide>
        <NewTicketForm variant="modal" onCreated={(id) => { closeCreate(); setOpenId(id); }} />
      </Modal>

      <TicketDetail ticketId={openId} onClose={closeTicket} />
    </div>
  );
}

function ClosedHistory({ tickets, onOpen }: { tickets: Ticket[]; onOpen: (id: string) => void }) {
  return (
    <>
      <div className="divide-y divide-linea bg-white md:hidden">
        {tickets.map((ticket) => (
          <article key={ticket.id} className="p-4">
            <button onClick={() => onOpen(ticket.id)} className="block w-full text-left">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-[0.07em] text-tenue">{ticket.number}</p>
                  <h3 className="mt-1 text-base font-bold leading-5 text-tinta">{ticket.subject}</h3>
                </div>
                <PriorityBadge priority={ticket.priority} />
              </div>
              <p className="mt-2 text-sm text-tenue">{ticket.office_name} · {CATEGORY_LABEL[ticket.category]}</p>
            </button>
            <div className="mt-3 rounded-xl bg-papel p-3 text-sm">
              <p><strong>{ticket.resolution?.tipo_resolucion ? RESOLUTION_LABEL[ticket.resolution.tipo_resolucion] : "Cerrado"}</strong></p>
              <p className="mt-1 line-clamp-2 text-tenue">{ticket.resolution?.notes || "Sin detalle de solución."}</p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-tenue">
                <span>Resolvió: <strong className="text-tinta">{ticket.resolution?.resolved_by_name || ticket.assigned_to_name || "Sin dato"}</strong></span>
                <span>Duración: <strong className="text-tinta">{formatTicketDuration(ticket)}</strong></span>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-xs text-tenue">Cerrado: {ticket.resolution?.resolved_at ? formatClosedDate(ticket.resolution.resolved_at) : "Sin fecha"}</span>
              <Button size="sm" variant="secondary" onClick={() => onOpen(ticket.id)}>Ver solución <ArrowRight className="size-4" /></Button>
            </div>
          </article>
        ))}
      </div>

      <div className="hidden overflow-x-auto bg-white md:block">
        <table className="min-w-full text-left">
          <thead className="bg-papel/70">
            <tr className="text-xs font-bold uppercase tracking-[0.07em] text-tenue">
              <th className="px-5 py-4 sm:px-6">Incidencia</th>
              <th className="px-5 py-4">Cierre</th>
              <th className="px-5 py-4">Solución</th>
              <th className="px-5 py-4">Técnico</th>
              <th className="px-5 py-4">Acción</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((ticket) => (
              <tr key={ticket.id} className="border-t border-linea/80 align-top transition hover:bg-emerald-50/30">
                <td className="px-5 py-4 sm:px-6">
                  <button onClick={() => onOpen(ticket.id)} className="max-w-lg text-left">
                    <div className="text-xs font-bold uppercase tracking-[0.07em] text-tenue">{ticket.number}</div>
                    <div className="mt-1 font-bold text-tinta">{ticket.subject}</div>
                    <div className="mt-1 text-sm text-tenue">{ticket.office_name} · {CATEGORY_LABEL[ticket.category]}</div>
                    <div className="mt-2"><PriorityBadge priority={ticket.priority} /></div>
                  </button>
                </td>
                <td className="px-5 py-4 text-sm">
                  <p className="font-semibold text-tinta">{ticket.resolution?.resolved_at ? formatClosedDate(ticket.resolution.resolved_at) : "Sin fecha"}</p>
                  <p className="mt-1 text-xs text-tenue">Resolución: {formatTicketDuration(ticket)}</p>
                </td>
                <td className="max-w-sm px-5 py-4 text-sm">
                  <Badge className="border-emerald-200 bg-emerald-50 text-emerald-800">{ticket.resolution?.tipo_resolucion ? RESOLUTION_LABEL[ticket.resolution.tipo_resolucion] : "Cerrado"}</Badge>
                  <p className="mt-2 line-clamp-2 leading-5 text-tenue">{ticket.resolution?.notes || "Sin detalle de solución."}</p>
                </td>
                <td className="px-5 py-4 text-sm text-tinta">{ticket.resolution?.resolved_by_name || ticket.assigned_to_name || "Sin dato"}</td>
                <td className="px-5 py-4">
                  <Button size="sm" variant="ghost" onClick={() => onOpen(ticket.id)}>Ver solución <ArrowRight className="size-4" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ClosedMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-linea/80 bg-papel/55 px-3 py-3">
      <p className="text-xs font-semibold text-tenue">{label}</p>
      <p className="mt-1 text-lg font-bold tracking-[-0.02em] text-tinta">{value}</p>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-xs font-bold text-tenue">
      {label}
      {children}
    </label>
  );
}

function Kpi({ label, value, icon, tone, detail, onClick, active }: {
  label: string;
  value?: number;
  icon: ReactNode;
  tone: KpiTone;
  detail?: string;
  onClick: () => void;
  active: boolean;
}) {
  const style = KPI_TONE[tone];
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "rounded-2xl border border-transparent bg-white p-4 text-left shadow-[0_10px_26px_rgba(15,23,42,0.05)] transition-all duration-150 hover:-translate-y-0.5 hover:border-[#F59E0B]/50 hover:shadow-[0_14px_30px_rgba(15,23,42,0.08)] sm:p-5",
        active && style.active,
      )}
    >
      <div className="flex items-start justify-between gap-2 sm:gap-4">
        <div className="min-w-0">
          <p className={cx("truncate text-sm font-semibold", active ? "text-[#92400E]" : "text-tenue")}>{label}</p>
          <p className="mt-2 text-3xl font-bold tracking-[-0.03em] text-tinta sm:mt-3 sm:text-4xl">{value ?? "–"}</p>
        </div>
        <span className={cx("relative grid size-10 shrink-0 place-items-center rounded-xl", style.iconWrap)}>
          {icon}
          {active && <span className="absolute -right-2 -top-2 grid size-6 place-items-center rounded-full bg-[#D97706] text-white shadow-sm ring-2 ring-[#FFFBEB]" aria-hidden><Check className="size-4 stroke-[3]" /></span>}
        </span>
      </div>
      <p className={cx("mt-4 line-clamp-2 text-xs font-medium leading-4 sm:mt-6 sm:text-sm sm:leading-5", active ? "text-[#78350F]" : "text-tenue")}>{detail ?? "Información en actualización"}</p>
      {active && <span className="sr-only">Filtro seleccionado</span>}
    </button>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className={cx(
      "flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition",
      checked ? "border-casma/30 bg-casma-claro text-casma-oscuro" : "border-linea bg-white text-tenue hover:border-slate-300 hover:text-tinta",
    )}>
      <input type="checkbox" className="size-4 accent-casma" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}