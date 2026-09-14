import { useInfiniteQuery } from "@tanstack/react-query";
import { ClipboardList, Search, TriangleAlert } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { Button, Card, cx, EmptyState, ErrorBox, Input, Spinner } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import type { Page, Ticket, TicketStatus } from "../../lib/types";
import { useInsights, useKpis } from "./hooks";
import { NewTicketForm } from "./NewTicketForm";
import { TicketCard } from "./TicketCard";
import { TicketDetail } from "./TicketDetail";

const FILTERS: { value: TicketStatus | ""; label: string }[] = [
  { value: "", label: "Todos" },
  { value: "PENDIENTE", label: "Pendientes" },
  { value: "EN_PROCESO", label: "En proceso" },
  { value: "RESUELTO", label: "Resueltos" },
];

export function Dashboard() {
  const kpis = useKpis();
  const insights = useInsights();
  const [status, setStatus] = useState<TicketStatus | "">("");
  const [mine, setMine] = useState(false);
  const [urgent, setUrgent] = useState(false);
  const [q, setQ] = useState("");
  const query = useDeferredValue(q.trim());
  const [openId, setOpenId] = useState<string | null>(null);

  const list = useInfiniteQuery({
    queryKey: ["tickets", { status, mine, urgent, query }],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ page: String(pageParam), page_size: "20" });
      if (status) params.set("status", status);
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

  return (
    <div className="flex flex-col gap-5">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Indicadores">
        <Kpi label="Total" value={k?.total} accent="border-tinta" onClick={() => setStatus("")} active={status === ""} />
        <Kpi label="Pendientes" value={k?.pendientes} accent="border-sol" onClick={() => setStatus("PENDIENTE")} active={status === "PENDIENTE"} extra={k ? `${k.sin_asignar} sin asignar` : undefined} />
        <Kpi label="En proceso" value={k?.en_proceso} accent="border-casma" onClick={() => setStatus("EN_PROCESO")} active={status === "EN_PROCESO"} extra={k ? `${k.urgentes_abiertos} urgentes` : undefined} />
        <Kpi label="Resueltos" value={k?.resueltos} accent="border-hecho" onClick={() => setStatus("RESUELTO")} active={status === "RESUELTO"}
          extra={k?.horas_primera_respuesta_30d != null ? `1.ª respuesta: ${k.horas_primera_respuesta_30d} h` : undefined} />
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

function Kpi({ label, value, accent, extra, onClick, active }: { label: string; value?: number; accent: string; extra?: string; onClick: () => void; active: boolean }) {
  return (
    <button onClick={onClick} className={cx("rounded-2xl border border-l-[6px] bg-white p-4 text-left transition-shadow hover:shadow-md", accent, active ? "ring-2 ring-casma/40" : "border-y-linea border-r-linea")}>
      <p className="text-sm font-bold text-tenue">{label}</p>
      <p className="text-3xl font-bold sm:text-4xl">{value ?? "–"}</p>
      {extra && <p className="mt-0.5 text-xs text-tenue">{extra}</p>}
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
