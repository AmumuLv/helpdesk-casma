import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowRight, CircleCheckBig, Clock3, FileClock, ListTodo, LoaderCircle, Search, TriangleAlert } from "lucide-react";
import { useDeferredValue, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { Badge, Button, Card, CategoryBadge, cx, EmptyState, ErrorBox, Input, Modal, PriorityBadge, Spinner, StatusBadge } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import type { Page, Ticket, TicketStatus } from "../../lib/types";
import { useInsights, useKpis } from "./hooks";
import { NewTicketForm } from "./NewTicketForm";
import { TicketDetail } from "./TicketDetail";

type DashboardFilter = TicketStatus | "ACTIVAS";

const FILTERS: { value: DashboardFilter; label: string }[] = [
  { value: "ACTIVAS", label: "Activas" },
  { value: "PENDIENTE", label: "Pendientes" },
  { value: "EN_PROCESO", label: "En proceso" },
  { value: "RESUELTO", label: "Cerradas" },
];

type KpiTone = "active" | "pending" | "progress" | "closed";

const KPI_TONE: Record<KpiTone, { iconWrap: string; active: string }> = {
  active: {
    iconWrap: "bg-casma-claro text-casma-oscuro",
    active: "border-casma/30 ring-2 ring-casma/10 shadow-[0_16px_34px_rgba(21,128,61,0.13)]",
  },
  pending: {
    iconWrap: "bg-sol-claro text-[#713f12]",
    active: "border-amber-300 ring-2 ring-sol/15 shadow-[0_16px_34px_rgba(234,179,8,0.12)]",
  },
  progress: {
    iconWrap: "bg-sky-50 text-sky-800",
    active: "border-sky-200 ring-2 ring-sky-100 shadow-[0_16px_34px_rgba(14,165,233,0.10)]",
  },
  closed: {
    iconWrap: "bg-emerald-50 text-emerald-800",
    active: "border-emerald-200 ring-2 ring-emerald-100 shadow-[0_16px_34px_rgba(16,185,129,0.10)]",
  },
};

function formatResponseTime(hours: number | null | undefined) {
  if (hours == null) return "Sin datos";
  const totalMinutes = Math.max(1, Math.round(hours * 60));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${wholeHours} h ${minutes} min` : `${wholeHours} h`;
}

function countLabel(value: number, singular: string, plural: string) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function formatShortDate(value: string) {
  return new Date(value).toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" }).replace(".", "");
}

export function Dashboard() {
  const kpis = useKpis();
  const insights = useInsights();
  const [status, setStatus] = useState<DashboardFilter>("ACTIVAS");
  const [mine, setMine] = useState(false);
  const [urgent, setUrgent] = useState(false);
  const [q, setQ] = useState("");
  const query = useDeferredValue(q.trim());
  const [openId, setOpenId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const createOpen = searchParams.get("new") === "1";
  const closeCreate = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("new");
    setSearchParams(next, { replace: true });
  };

  const list = useInfiniteQuery({
    queryKey: ["tickets", { status, mine, urgent, query }],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ page: String(pageParam), page_size: "20" });
      if (status === "ACTIVAS") params.set("active", "true");
      else params.set("status", status);
      if (mine) params.set("assigned", "me");
      if (urgent) params.set("priority", "ALTA");
      if (query) params.set("q", query);
      return api<Page<Ticket>>(`/tickets?${params}`);
    },
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.page_size < last.total ? last.page + 1 : undefined),
  });

  const tickets = list.data?.pages.flatMap((p) => p.items) ?? [];
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
      label: "Cerrados",
      value: k?.resueltos,
      icon: <CircleCheckBig className="size-4" />,
      tone: "closed" as const,
      detail: k ? `1.ª respuesta: ${formatResponseTime(k.horas_primera_respuesta_30d)}` : undefined,
      onClick: () => setStatus("RESUELTO"),
      active: status === "RESUELTO",
    },
  ], [activeTotal, k, status]);

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4" aria-label="Resumen de incidencias">
        {metricCards.map((card) => (
          <Kpi
            key={card.label}
            label={card.label}
            value={card.value}
            icon={card.icon}
            tone={card.tone}
            detail={card.detail}
            onClick={card.onClick}
            active={card.active}
          />
        ))}
      </section>

      {insights.data?.active_alerts.map((a) => (
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
              <h2 className="text-xl font-bold tracking-[-0.02em] text-tinta">Incidencias</h2>
              {k && <p className="mt-1 text-sm text-tenue">{k.nuevos_hoy} {k.nuevos_hoy === 1 ? "registro nuevo hoy" : "registros nuevos hoy"}</p>}
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
                      status === f.value
                        ? "bg-casma-oscuro text-white shadow-sm"
                        : "text-tenue hover:bg-white hover:text-tinta",
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full max-w-lg">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tenue" aria-hidden />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar código, oficina o descripción" className="bg-papel pl-9 shadow-none" aria-label="Buscar incidencias" />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Toggle checked={mine} onChange={setMine} label="Mis casos" />
              <Toggle checked={urgent} onChange={setUrgent} label="Solo urgentes" />
            </div>
          </div>
        </div>

        {list.isLoading ? <Spinner /> : list.error ? <div className="p-4"><ErrorBox message={errorMessage(list.error)} /></div> : tickets.length === 0 ? (
          <EmptyState icon={<FileClock />} title="No hay incidencias con estos filtros" />
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
                      {t.status !== "RESUELTO" && <Button size="sm" variant="success" onClick={() => setOpenId(t.id)}>Atender</Button>}
                      <Button size="sm" variant="secondary" onClick={() => setOpenId(t.id)} aria-label={`Ver detalle de ${t.number}`}>
                        <ArrowRight className="size-4" />
                      </Button>
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
                          {(t.assigned_to_name || t.reporter_name) && (
                            <Badge className="border-casma/20 bg-casma-claro text-casma-oscuro">{t.assigned_to_name ?? t.reporter_name}</Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-sm text-tenue">
                        <div className="font-semibold text-tinta">{formatShortDate(t.created_at)}</div>
                        <div className="mt-1">{t.equipment?.patrimonial_code ?? "Sin equipo"}</div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-col items-start gap-2 xl:flex-row xl:items-center">
                          {t.status !== "RESUELTO" && (
                            <Button size="sm" variant="success" onClick={() => setOpenId(t.id)}>Atender</Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => setOpenId(t.id)}>
                            Ver detalle <ArrowRight className="size-4" />
                          </Button>
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
        <NewTicketForm
          variant="modal"
          onCreated={(id) => {
            closeCreate();
            setOpenId(id);
          }}
        />
      </Modal>

      <TicketDetail ticketId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function Kpi({
  label,
  value,
  icon,
  tone,
  detail,
  onClick,
  active,
}: {
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
        "rounded-2xl border border-transparent bg-white p-4 text-left shadow-[0_10px_26px_rgba(15,23,42,0.05)] transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(15,23,42,0.08)] sm:rounded-3xl sm:p-5",
        active && style.active,
      )}
    >
      <div className="flex items-start justify-between gap-2 sm:gap-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-tenue">{label}</p>
          <p className="mt-2 text-3xl font-bold tracking-[-0.03em] text-tinta sm:mt-3 sm:text-4xl">{value ?? "–"}</p>
        </div>
        <span className={cx("grid size-9 shrink-0 place-items-center rounded-xl sm:size-10 sm:rounded-2xl", style.iconWrap)}>{icon}</span>
      </div>
      <p className="mt-4 line-clamp-2 text-xs font-medium leading-4 text-tenue sm:mt-6 sm:text-sm sm:leading-5">{detail ?? "Información en actualización"}</p>
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
