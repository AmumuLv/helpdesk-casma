import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowRight, BriefcaseBusiness, CircleCheckBig, Search } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { Badge, Button, Card, CategoryBadge, EmptyState, ErrorBox, Input, PriorityBadge, Spinner, StatusBadge, cx } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import type { Page, Ticket } from "../../lib/types";
import { TicketDetail } from "./TicketDetail";

type WorkView = "ABIERTAS" | "CERRADAS";

function formatShortDate(value: string) {
  return new Date(value).toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" }).replace(".", "");
}

export function MyTicketsPage() {
  const [view, setView] = useState<WorkView>("ABIERTAS");
  const [q, setQ] = useState("");
  const query = useDeferredValue(q.trim());
  const [openId, setOpenId] = useState<string | null>(null);

  const list = useInfiniteQuery({
    queryKey: ["tickets", "assigned-to-me", { view, query }],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ assigned: "me", page: String(pageParam), page_size: "20" });
      if (view === "ABIERTAS") params.set("active", "true");
      else params.set("status", "RESUELTO");
      if (query) params.set("q", query);
      return api<Page<Ticket>>(`/tickets?${params}`);
    },
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.page_size < last.total ? last.page + 1 : undefined),
  });

  const tickets = list.data?.pages.flatMap((page) => page.items) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.06)]">
        <div className="flex flex-col gap-4 px-4 py-5 sm:px-6 sm:py-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
              <BriefcaseBusiness className="size-5" aria-hidden />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-extrabold tracking-[-0.02em] text-slate-950 sm:text-2xl">Mis incidencias</h1>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{total}</span>
              </div>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">Aquí solo aparecen las incidencias asignadas a tu cuenta. Esta vista representa tu carga de trabajo, no el total general del Área TI.</p>
            </div>
          </div>

          <div className="flex w-full rounded-xl bg-slate-100 p-1 lg:w-auto" role="tablist" aria-label="Estado de mis incidencias">
            {([
              ["ABIERTAS", "Abiertas"],
              ["CERRADAS", "Cerradas"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={view === value}
                onClick={() => setView(value)}
                className={cx(
                  "min-h-10 flex-1 rounded-lg px-4 text-sm font-bold transition lg:flex-none",
                  view === value ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-800",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3 sm:px-6">
          <div className="relative max-w-xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Buscar por código, oficina o descripción"
              aria-label="Buscar en mis incidencias"
              className="bg-white pl-9 shadow-none"
            />
          </div>
        </div>
      </section>

      <Card className="overflow-hidden border-slate-200">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
          <div>
            <h2 className="font-bold text-slate-950">{view === "ABIERTAS" ? "Trabajo asignado" : "Historial resuelto"}</h2>
            <p className="mt-0.5 text-xs text-slate-500">{total} {total === 1 ? "incidencia" : "incidencias"} en esta vista</p>
          </div>
          {view === "CERRADAS" && <CircleCheckBig className="size-5 text-emerald-600" aria-hidden />}
        </div>

        {list.isLoading ? (
          <Spinner />
        ) : list.error ? (
          <div className="p-4"><ErrorBox message={errorMessage(list.error)} /></div>
        ) : tickets.length === 0 ? (
          <EmptyState
            icon={<BriefcaseBusiness />}
            title={view === "ABIERTAS" ? "No tienes incidencias abiertas asignadas" : "No hay incidencias cerradas con estos filtros"}
          />
        ) : (
          <>
            <div className="divide-y divide-slate-100 bg-white md:hidden">
              {tickets.map((ticket) => (
                <article key={ticket.id} className="p-4">
                  <button type="button" onClick={() => setOpenId(ticket.id)} className="block w-full text-left">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-bold uppercase tracking-[0.07em] text-emerald-700">{ticket.number}</p>
                        <h3 className="mt-1 line-clamp-2 text-base font-bold leading-5 text-slate-950">{ticket.subject}</h3>
                      </div>
                      <span className="shrink-0 text-xs font-semibold text-slate-500">{formatShortDate(ticket.created_at)}</span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm leading-5 text-slate-600">{ticket.description || "Sin descripción adicional"}</p>
                  </button>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <PriorityBadge priority={ticket.priority} />
                    <StatusBadge status={ticket.status} />
                    <CategoryBadge category={ticket.category} />
                    <Badge className="border-slate-300 bg-slate-100 text-slate-800">{ticket.office_name}</Badge>
                  </div>

                  <div className="mt-3 flex justify-end border-t border-slate-100 pt-3">
                    <Button size="sm" variant="secondary" onClick={() => setOpenId(ticket.id)}>
                      Ver detalle <ArrowRight className="size-4" />
                    </Button>
                  </div>
                </article>
              ))}
            </div>

            <div className="hidden overflow-x-auto bg-white md:block">
              <table className="min-w-full text-left">
                <thead className="bg-slate-50/80">
                  <tr className="text-xs font-bold uppercase tracking-[0.07em] text-slate-500">
                    <th className="px-5 py-4 sm:px-6">Incidencia</th>
                    <th className="px-5 py-4">Estado</th>
                    <th className="px-5 py-4">Oficina</th>
                    <th className="px-5 py-4">Fecha</th>
                    <th className="px-5 py-4">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((ticket) => (
                    <tr key={ticket.id} className="border-t border-slate-100 align-top transition hover:bg-slate-50/70">
                      <td className="px-5 py-4 sm:px-6">
                        <button type="button" onClick={() => setOpenId(ticket.id)} className="max-w-xl text-left">
                          <div className="text-xs font-bold uppercase tracking-[0.07em] text-emerald-700">{ticket.number}</div>
                          <div className="mt-1 font-bold text-slate-950">{ticket.subject}</div>
                          <div className="mt-1 line-clamp-2 max-w-xl text-sm leading-5 text-slate-600">{ticket.description || "Sin descripción adicional"}</div>
                        </button>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap gap-1.5">
                          <PriorityBadge priority={ticket.priority} />
                          <StatusBadge status={ticket.status} />
                        </div>
                      </td>
                      <td className="px-5 py-4 text-sm font-semibold text-slate-700">{ticket.office_name}</td>
                      <td className="px-5 py-4 text-sm text-slate-500">{formatShortDate(ticket.created_at)}</td>
                      <td className="px-5 py-4">
                        <Button size="sm" variant="ghost" onClick={() => setOpenId(ticket.id)}>
                          Ver detalle <ArrowRight className="size-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {list.hasNextPage && (
          <div className="border-t border-slate-200 bg-white p-4 text-center">
            <Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>Cargar más</Button>
          </div>
        )}
      </Card>

      <TicketDetail ticketId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
