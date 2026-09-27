import { useInfiniteQuery } from "@tanstack/react-query";
import { Check, CircleCheckBig, ClipboardList, Clock3, ListTodo, LoaderCircle, Search, TriangleAlert } from "lucide-react";
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

const KPI_TONE: Record<KpiTone, { accent: string; icon: string; value: string; selected: string; soft: string }> = {
  active: {
    accent: "bg-casma",
    icon: "bg-casma-claro text-casma-oscuro",
    value: "text-casma-oscuro",
    selected: "border-casma/45 ring-2 ring-casma/18 shadow-[0_16px_34px_rgba(30,122,59,0.12)]",
    soft: "from-casma-claro/45 to-white",
  },
  pending: {
    accent: "bg-sol",
    icon: "bg-sol-claro text-[#806000]",
    value: "text-[#806000]",
    selected: "border-sol/65 ring-2 ring-sol/20 shadow-[0_16px_34px_rgba(234,179,8,0.11)]",
    soft: "from-sol-claro/55 to-white",
  },
  progress: {
    accent: "bg-casma-oscuro",
    icon: "bg-casma-claro text-casma-oscuro",
    value: "text-casma-oscuro",
    selected: "border-casma/50 ring-2 ring-casma/18 shadow-[0_16px_34px_rgba(20,83,45,0.12)]",
    soft: "from-casma-claro/35 to-white",
  },
  closed: {
    accent: "bg-hecho",
    icon: "bg-hecho-claro text-hecho",
    value: "text-hecho",
    selected: "border-hecho/45 ring-2 ring-hecho/15 shadow-[0_16px_34px_rgba(21,128,61,0.10)]",
    soft: "from-hecho-claro/35 to-white",
  },
};

function formatResponseTime(hours: number | null | undefined) {
  if (hours == null) return "Sin datos suficientes";
  const totalMinutes = Math.max(1, Math.round(hours * 60));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${wholeHours} h ${minutes} min` : `${wholeHours} h`;
}

function countLabel(value: number, singular: string, plural: string) {
  return `${value} ${value === 1 ? singular : plural}`;
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
    <div className="flex flex-col gap-6">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4" aria-label="Resumen de incidencias">
        <Kpi
          label="Activos"
          value={activeTotal}
          icon={<ListTodo className="size-5" />}
          tone="active"
          description="Carga de trabajo actual"
          detailLabel="Distribución actual"
          detailValue={k ? `${countLabel(k.pendientes, "pendiente", "pendientes")} · ${countLabel(k.en_proceso, "en proceso", "en proceso")}` : undefined}
          onClick={() => setStatus("ACTIVAS")}
          active={status === "ACTIVAS"}
        />
        <Kpi
          label="Pendientes"
          value={k?.pendientes}
          icon={<Clock3 className="size-5" />}
          tone="pending"
          description="Aún sin iniciar"
          detailLabel="Asignación de técnico"
          detailValue={k ? `${countLabel(k.sin_asignar, "incidencia", "incidencias")} activa${k.sin_asignar === 1 ? "" : "s"} sin técnico asignado` : undefined}
          onClick={() => setStatus("PENDIENTE")}
          active={status === "PENDIENTE"}
        />
        <Kpi
          label="En proceso"
          value={k?.en_proceso}
          icon={<LoaderCircle className="size-5" />}
          tone="progress"
          description="Atención en curso"
          detailLabel="Prioridad urgente"
          detailValue={k ? `${countLabel(k.urgentes_abiertos, "incidencia urgente", "incidencias urgentes")} aún abierta${k.urgentes_abiertos === 1 ? "" : "s"}` : undefined}
          onClick={() => setStatus("EN_PROCESO")}
          active={status === "EN_PROCESO"}
        />
        <Kpi
          label="Cerrados"
          value={k?.resueltos}
          icon={<CircleCheckBig className="size-5" />}
          tone="closed"
          description="Histórico finalizado"
          detailLabel="Primera respuesta · últimos 30 días"
          detailValue={k ? `Promedio: ${formatResponseTime(k.horas_primera_respuesta_30d)}` : undefined}
          onClick={() => setStatus("RESUELTO")}
          active={status === "RESUELTO"}
        />
      </section>

      {insights.data?.active_alerts.map((a) => (
        <div key={a.id} role="alert" className="flex items-start gap-3 rounded-2xl border border-alerta/25 bg-alerta-claro px-4 py-3.5 shadow-sm">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/70 text-alerta shadow-sm">
            <TriangleAlert className="size-5" aria-hidden />
          </span>
          <div><p className="font-bold text-alerta">{a.title}</p><p className="mt-0.5 text-sm text-tinta/80">{a.message}</p></div>
        </div>
      ))}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(320px,380px)_1fr] xl:gap-6">
        <NewTicketForm onCreated={setOpenId} />

        <Card className="flex min-w-0 flex-col overflow-hidden">
          <div className="flex flex-col gap-4 border-b border-linea bg-gradient-to-b from-white to-papel/45 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="mb-2 h-1 w-10 rounded-full bg-sol" aria-hidden />
                <h2 className="text-xl font-bold tracking-tight text-tinta">Incidencias</h2>
                {k && <p className="mt-0.5 text-sm text-tenue">{k.nuevos_hoy} {k.nuevos_hoy === 1 ? "registro nuevo hoy" : "registros nuevos hoy"}</p>}
              </div>
              <div className="grid w-full grid-cols-4 gap-1 rounded-xl border border-linea bg-white p-1 shadow-inner sm:flex sm:w-auto" role="tablist">
                {FILTERS.map((f) => (
                  <button
                    key={f.label}
                    role="tab"
                    aria-selected={status === f.value}
                    onClick={() => setStatus(f.value)}
                    className={cx(
                      "relative rounded-lg px-2.5 py-2 text-xs font-bold transition-all sm:px-3.5 sm:text-sm",
                      status === f.value
                        ? "bg-casma text-white shadow-[0_4px_10px_rgba(30,122,59,0.18)]"
                        : "text-tenue hover:bg-casma-claro/50 hover:text-casma-oscuro",
                    )}
                  >
                    {f.label}
                    {status === f.value && <span className="absolute inset-x-3 -bottom-1 h-0.5 rounded-full bg-sol" aria-hidden />}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="group relative min-w-52 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tenue transition-colors group-focus-within:text-casma" aria-hidden />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por N.º, oficina, código o texto" className="pl-9" aria-label="Buscar incidencias" />
              </div>
              <Toggle checked={mine} onChange={setMine} label="Mis casos" />
              <Toggle checked={urgent} onChange={setUrgent} label="Solo urgentes" />
            </div>
          </div>

          {list.isLoading ? <Spinner /> : list.error ? <div className="p-4"><ErrorBox message={errorMessage(list.error)} /></div> : tickets.length === 0 ? (
            <EmptyState icon={<ClipboardList />} title="No hay incidencias con estos filtros" />
          ) : (
            <ul className="flex flex-col gap-3 bg-papel/70 p-3 sm:p-4">
              {tickets.map((t) => <li key={t.id}><TicketCard ticket={t} onOpen={() => setOpenId(t.id)} /></li>)}
            </ul>
          )}
          {list.hasNextPage && (
            <div className="border-t border-linea bg-white p-3 text-center">
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
  detailLabel,
  detailValue,
  onClick,
  active,
}: {
  label: string;
  value?: number;
  icon: ReactNode;
  tone: KpiTone;
  description: string;
  detailLabel: string;
  detailValue?: string;
  onClick: () => void;
  active: boolean;
}) {
  const style = KPI_TONE[tone];
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "group relative min-h-44 overflow-hidden rounded-2xl border border-linea bg-gradient-to-br text-left shadow-[0_8px_24px_rgba(31,41,55,0.05)] transition-all duration-200 hover:-translate-y-1 hover:border-casma/25 hover:shadow-[0_15px_34px_rgba(31,41,55,0.085)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sol/20",
        style.soft,
        active && `-translate-y-0.5 ${style.selected}`,
      )}
    >
      <div className={cx("absolute inset-x-0 top-0 h-1.5", style.accent)} aria-hidden />
      {active && (
        <span className="absolute right-3 top-3 grid size-6 place-items-center rounded-full bg-casma text-white shadow-md ring-2 ring-white" aria-label="Seleccionado">
          <Check className="size-3.5" />
        </span>
      )}
      <div className="flex h-full flex-col p-4 pt-5 sm:p-5 sm:pt-6">
        <div className="flex items-start justify-between gap-4 pr-7">
          <div className="min-w-0">
            <p className="text-sm font-extrabold tracking-tight text-tinta">{label}</p>
            <p className="mt-1 text-xs font-medium text-tenue">{description}</p>
          </div>
          <div className={cx("flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/80 shadow-sm transition-transform group-hover:scale-105", style.icon)} aria-hidden>
            {icon}
          </div>
        </div>

        <p className={cx("mt-4 text-4xl font-extrabold leading-none tracking-[-0.04em]", style.value)}>{value ?? "–"}</p>

        <div className="mt-auto border-t border-linea/80 pt-3">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.11em] text-tenue">{detailLabel}</p>
          <p className="mt-1 text-xs font-semibold leading-5 text-tinta/80" title={detailValue}>
            {detailValue ?? "Información no disponible"}
          </p>
        </div>
      </div>
    </button>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className={cx(
      "flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold shadow-sm transition-all",
      checked
        ? "border-casma bg-casma text-white shadow-[0_4px_10px_rgba(30,122,59,0.15)]"
        : "border-linea bg-white text-tinta hover:border-casma/30 hover:bg-casma-claro/30",
    )}>
      <input type="checkbox" className="size-4 accent-sol" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}
