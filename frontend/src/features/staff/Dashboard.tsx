import { useInfiniteQuery } from "@tanstack/react-query";
import { CircleCheckBig, ClipboardList, Clock3, ListTodo, LoaderCircle, Search, TriangleAlert } from "lucide-react";
import { useDeferredValue, useState, type ReactNode } from "react";
import { Button, Card, cx, EmptyState, ErrorBox, Input, Spinner } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import type { Page, Ticket, TicketStatus } from "../../lib/types";
import { useInsights, useKpis } from "./hooks";
import { NewTicketForm } from "./NewTicketForm";
import { TicketCard } from "./TicketCard";
import { TicketDetail } from "./TicketDetail";

type DashboardFilter = TicketStatus | "ACTIVAS";

const FILTERS: { value: DashboardFilter; label: string }[] = [
  { value: "ACTIVAS", label: "Activas" },
  { value: "PENDIENTE", label: "Pendientes" },
  { value: "EN_PROCESO", label: "En proceso" },
  { value: "RESUELTO", label: "Cerrados" },
];

type KpiTone = "active" | "pending" | "progress" | "closed";

const KPI_TONE: Record<KpiTone, { accent: string; icon: string; value: string; selected: string }> = {
  active: {
    accent: "bg-tinta",
    icon: "bg-papel text-tinta",
    value: "text-tinta",
    selected: "border-tinta/30 ring-2 ring-tinta/10",
  },
  pending: {
    accent: "bg-sol",
    icon: "bg-sol-claro text-[#7a5200]",
    value: "text-[#7a5200]",
    selected: "border-sol/60 ring-2 ring-sol/15",
  },
  progress: {
    accent: "bg-casma",
    icon: "bg-casma-claro text-casma-oscuro",
    value: "text-casma-oscuro",
    selected: "border-casma/50 ring-2 ring-casma/15",
  },
  closed: {
    accent: "bg-hecho",
    icon: "bg-hecho-claro text-hecho",
    value: "text-hecho",
    selected: "border-hecho/40 ring-2 ring-hecho/10",
  },
};

export function Dashboard() {
  const kpis = useKpis();
  const insights = useInsights();
  const [status, setStatus] = useState<DashboardFilter>("ACTIVAS");
  const [mine, setMine] = useState(false);
  const [urgent, setUrgent] = useState(false);
  const [q, setQ] = useState("");
  const query = useDeferredValue(q.trim());
  const [openId, setOpenId] = useState<string | null>(null);

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

  return (
    <div className="flex flex-col gap-5">
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-label="Resumen de incidencias">
        <Kpi
          label="Activos"
          value={activeTotal}
          icon={<ListTodo className="size-5" />}
          tone="active"
          description="Carga de trabajo actual"
          extra={k ? `${k.pendientes} pendientes · ${k.en_proceso} en proceso` : undefined}
          onClick={() => setStatus("ACTIVAS")}
          active={status === "ACTIVAS"}
        />
        <Kpi
          label="Pendientes"
          value={k?.pendientes}
          icon={<Clock3 className="size-5" />}
          tone="pending"
          description="Aún sin iniciar"
          extra={k ? `${k.sin_asignar} sin asignar` : undefined}
          onClick={() => setStatus("PENDIENTE")}
          active={status === "PENDIENTE"}
        />
        <Kpi
          label="En proceso"
          value={k?.en_proceso}
          icon={<LoaderCircle className="size-5" />}
          tone="progress"
          description="Atención en curso"
          extra={k ? `${k.urgentes_abiertos} urgentes abiertos` : undefined}
          onClick={() => setStatus("EN_PROCESO")}
          active={status === "EN_PROCESO"}
        />
        <Kpi
          label="Cerrados"
          value={k?.resueltos}
          icon={<CircleCheckBig className="size-5" />}
          tone="closed"
          description="Histórico finalizado"
          extra={k?.horas_primera_respuesta_30d != null ? `Respuesta inicial promedio: ${k.horas_primera_respuesta_30d} h` : "Sin datos de respuesta"}
          onClick={() => setStatus("RESUELTO")}
          active={status === "RESUELTO"}
        />
      </section>

      {insights.data?.active_alerts.map((a) => (
        <div key={a.id} role="alert" className="flex items-start gap-3 rounded-2xl border border-alerta/40 bg-alerta-claro p-4">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-alerta" aria-hidden />
          <div><p className="font-bold text-alerta">{a.title}</p><p className="text-sm">{a.message}</p></div>
        </div>
      ))}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(320px,380px)_1fr]">
        <NewTicketForm onCreated={setOpenId} />

        <Card className="flex min-w-0 flex-col">
          <div className="flex flex-col gap-3 border-b border-linea p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-bold">Incidencias {k && <span className="text-tenue">({k.nuevos_hoy} {k.nuevos_hoy === 1 ? "nueva" : "nuevas"} hoy)</span>}</h2>
              <div className="grid w-full grid-cols-4 gap-1 rounded-xl bg-papel p-1 sm:flex sm:w-auto" role="tablist">
                {FILTERS.map((f) => (
                  <button key={f.label} role="tab" aria-selected={status === f.value} onClick={() => setStatus(f.value)}
                    className={cx("rounded-lg px-1 py-1.5 text-xs font-bold sm:px-3 sm:text-sm", status === f.value ? "bg-white text-tinta shadow-sm" : "text-tenue hover:text-tinta")}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-52 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tenue" aria-hidden />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por N.º, oficina, código o texto" className="pl-9" aria-label="Buscar incidencias" />
              </div>
              <Toggle checked={mine} onChange={setMine} label="Mis casos" />
              <Toggle checked={urgent} onChange={setUrgent} label="Solo urgentes" />
            </div>
          </div>

          {list.isLoading ? <Spinner /> : list.error ? <div className="p-4"><ErrorBox message={errorMessage(list.error)} /></div> : tickets.length === 0 ? (
            <EmptyState icon={<ClipboardList />} title="No hay incidencias con estos filtros" />
          ) : (
            <ul className="flex flex-col divide-y divide-linea">
              {tickets.map((t) => <li key={t.id}><TicketCard ticket={t} onOpen={() => setOpenId(t.id)} /></li>)}
            </ul>
          )}
          {list.hasNextPage && (
            <div className="border-t border-linea p-3 text-center">
              <Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>Cargar más</Button>
            </div>
          )}
        </Card>
      </div>
      <TicketDetail ticketId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function Kpi({
  label,
  value,
  icon,
  tone,
  description,
  extra,
  onClick,
  active,
}: {
  label: string;
  value?: number;
  icon: ReactNode;
  tone: KpiTone;
  description: string;
  extra?: string;
  onClick: () => void;
  active: boolean;
}) {
  const style = KPI_TONE[tone];
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "group relative min-h-40 overflow-hidden rounded-2xl border border-linea bg-white text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-tinta/20 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-casma/30",
        active && style.selected,
      )}
    >
      <div className={cx("absolute inset-x-0 top-0 h-1", style.accent)} aria-hidden />
      <div className="flex h-full flex-col p-5 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-bold tracking-tight text-tinta">{label}</p>
            <p className="mt-1 text-xs font-medium text-tenue">{description}</p>
          </div>
          <div className={cx("flex size-10 shrink-0 items-center justify-center rounded-xl", style.icon)} aria-hidden>
            {icon}
          </div>
        </div>

        <p className={cx("mt-4 text-4xl font-extrabold leading-none tracking-tight", style.value)}>{value ?? "–"}</p>

        <div className="mt-auto border-t border-linea/80 pt-3">
          <p className="truncate text-xs font-medium text-tenue" title={extra}>{extra ?? "Sin información adicional"}</p>
        </div>
      </div>
    </button>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm font-bold">
      <input type="checkbox" className="size-4 accent-casma" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}
