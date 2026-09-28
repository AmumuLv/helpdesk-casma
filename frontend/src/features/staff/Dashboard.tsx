import { useInfiniteQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Building2, CheckCircle2, Clock3, Filter, ListTodo, LoaderCircle, MapPin, Search, UserRound, UsersRound, X } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { Button, Card, EmptyState, ErrorBox, Input, Modal, PriorityBadge, Select, Spinner, StatusBadge, cx } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { CATEGORIES, CATEGORY_LABEL, PRIORITY_LABEL } from "../../lib/labels";
import type { Page, ResolutionType, Ticket, TicketCategory, TicketPriority, TicketStatus } from "../../lib/types";
import { useKpis, useMunicipalUsers, useOfficeLookup, useTechnicians, useZones } from "./hooks";
import { NewTicketForm } from "./NewTicketForm";
import { TicketDetail } from "./TicketDetail";

type View = TicketStatus | "ACTIVAS";
type WorkSort = "smart" | "created_desc" | "created_asc" | "priority_desc";
type ClosedSort = "closed_desc" | "closed_asc" | "duration_desc" | "duration_asc";
type Period = "all" | "today" | "7d" | "30d" | "90d" | "custom";

const TABS: { value: View; label: string; help: string }[] = [
  { value: "ACTIVAS", label: "Todas activas", help: "Casos que todavía necesitan seguimiento del Área TI." },
  { value: "PENDIENTE", label: "Por atender", help: "Incidencias que aún no han iniciado su atención." },
  { value: "EN_PROCESO", label: "En atención", help: "Casos en los que el personal TI ya está trabajando." },
  { value: "RESUELTO", label: "Cerradas", help: "Historial de casos finalizados y sus soluciones." },
];
const WORK_SORT: Record<WorkSort, string> = { smart: "Prioridad de atención", created_desc: "Más recientes", created_asc: "Más antiguos", priority_desc: "Prioridad" };
const CLOSED_SORT: Record<ClosedSort, string> = { closed_desc: "Cierre más reciente", closed_asc: "Cierre más antiguo", duration_desc: "Mayor duración", duration_asc: "Menor duración" };
const PERIODS: Record<Period, string> = { all: "Todo el historial", today: "Hoy", "7d": "Últimos 7 días", "30d": "Últimos 30 días", "90d": "Últimos 90 días", custom: "Rango personalizado" };
const RESOLUTION: Record<ResolutionType, string> = { SOLUCIONADO: "Solucionado", REPARADO: "Reparado", REQUIERE_REPUESTO: "Requiere repuesto", REEMPLAZADO: "Reemplazado", OBSOLETO: "Obsoleto", IRREPARABLE: "Irreparable", BAJA_PATRIMONIAL: "Baja patrimonial", DERIVADO: "Derivado" };

function inputDate(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function rangeFor(period: Period, from: string, to: string) {
  if (period === "all") return {} as { from?: string; to?: string };
  if (period === "custom") return { from: from ? `${from}T00:00:00-05:00` : undefined, to: to ? `${to}T23:59:59-05:00` : undefined };
  const now = new Date(); const start = new Date(now); const days = period === "today" ? 1 : period === "7d" ? 7 : period === "30d" ? 30 : 90;
  start.setDate(now.getDate() - days + 1);
  return { from: `${inputDate(start)}T00:00:00-05:00`, to: `${inputDate(now)}T23:59:59-05:00` };
}
function ago(value: string) { const m = Math.floor(Math.max(0, Date.now() - new Date(value).getTime()) / 60000); if (m < 1) return "Ahora"; if (m < 60) return `Hace ${m} min`; const h = Math.floor(m / 60); if (h < 24) return `Hace ${h} h`; const d = Math.floor(h / 24); return `Hace ${d} ${d === 1 ? "día" : "días"}`; }
function when(value: string) { return new Date(value).toLocaleString("es-PE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(".", ""); }
function actionLabel(t: Ticket) { if (t.status === "RESUELTO") return "Ver / reabrir"; if (t.status === "EN_PROCESO") return "Continuar atención"; return t.assigned_to_id ? "Iniciar atención" : "Asignar y atender"; }

export function Dashboard() {
  const kpis = useKpis(); const zones = useZones(); const offices = useOfficeLookup(); const techs = useTechnicians();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>("ACTIVAS"); const [q, setQ] = useState(""); const query = useDeferredValue(q.trim()); const [openId, setOpenId] = useState<string | null>(null); const [filtersOpen, setFiltersOpen] = useState(false);
  const [mine, setMine] = useState(false); const [urgent, setUrgent] = useState(false); const [unassigned, setUnassigned] = useState(false);
  const [zone, setZone] = useState(""); const [office, setOffice] = useState(""); const [municipalUser, setMunicipalUser] = useState(""); const [technician, setTechnician] = useState(""); const [category, setCategory] = useState<"" | TicketCategory>(""); const [priority, setPriority] = useState<"" | TicketPriority>("");
  const [createdDate, setCreatedDate] = useState(""); const [workSort, setWorkSort] = useState<WorkSort>("smart");
  const [period, setPeriod] = useState<Period>("30d"); const [closedFrom, setClosedFrom] = useState(""); const [closedTo, setClosedTo] = useState(""); const [closedSort, setClosedSort] = useState<ClosedSort>("closed_desc"); const [resolution, setResolution] = useState<"" | ResolutionType>("");
  const users = useMunicipalUsers(office); const tab = TABS.find((x) => x.value === view) ?? TABS[0];
  const activeZones = (zones.data ?? []).filter((z) => z.active); const activeOffices = (offices.data ?? []).filter((o) => o.active && (!zone || o.zone_id === zone));
  const closedRange = useMemo(() => rangeFor(period, closedFrom, closedTo), [period, closedFrom, closedTo]);
  const advancedCount = view === "RESUELTO" ? [zone, office, municipalUser, technician, category, priority, resolution].filter(Boolean).length : [zone, office, municipalUser, technician, category, priority, createdDate].filter(Boolean).length;

  useEffect(() => {
    const ticket = params.get("ticket"); const status = params.get("status");
    if (ticket) setOpenId(ticket); if (status && TABS.some((x) => x.value === status)) setView(status as View); if (params.get("mine") === "1") setMine(true);
  }, [params]);

  const list = useInfiniteQuery({
    queryKey: ["workboard", { view, query, mine, urgent, unassigned, zone, office, municipalUser, technician, category, priority, createdDate, workSort, period, closedFrom, closedTo, closedSort, resolution }],
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ page: String(pageParam), page_size: "20", sort_by: view === "RESUELTO" ? closedSort : workSort });
      view === "ACTIVAS" ? p.set("active", "true") : p.set("status", view); if (zone) p.set("zone_id", zone); if (office) p.set("office_id", office); if (municipalUser) p.set("user_id", municipalUser); if (category) p.set("category", category); if (query) p.set("q", query);
      if (view === "RESUELTO") { if (closedRange.from) p.set("resolved_from", closedRange.from); if (closedRange.to) p.set("resolved_to", closedRange.to); if (technician) p.set("technician_id", technician); if (priority) p.set("priority", priority); if (resolution) p.set("resolution_type", resolution); }
      else { if (mine) p.set("assigned", "me"); else if (unassigned) p.set("assigned", "none"); else if (technician) p.set("technician_id", technician); if (urgent) p.set("priority", "ALTA"); else if (priority) p.set("priority", priority); if (createdDate) { p.set("created_from", `${createdDate}T00:00:00-05:00`); p.set("created_to", `${createdDate}T23:59:59-05:00`); } }
      return api<Page<Ticket>>(`/workboard/tickets?${p}`);
    }, initialPageParam: 1, getNextPageParam: (last) => last.page * last.page_size < last.total ? last.page + 1 : undefined,
  });
  const tickets = list.data?.pages.flatMap((p) => p.items) ?? []; const total = list.data?.pages[0]?.total ?? 0; const k = kpis.data; const activeTotal = k ? k.pendientes + k.en_proceso : undefined;

  const chooseView = (next: View) => { setView(next); setMine(false); setUrgent(false); setUnassigned(false); };
  const clear = () => { setMine(false); setUrgent(false); setUnassigned(false); setZone(""); setOffice(""); setMunicipalUser(""); setTechnician(""); setCategory(""); setPriority(""); setCreatedDate(""); setWorkSort("smart"); setPeriod("30d"); setClosedFrom(""); setClosedTo(""); setClosedSort("closed_desc"); setResolution(""); };
  const closeCreate = () => { const next = new URLSearchParams(params); next.delete("new"); setParams(next, { replace: true }); };
  const closeTicket = () => { setOpenId(null); const next = new URLSearchParams(params); next.delete("ticket"); next.delete("source"); setParams(next, { replace: true }); };

  return <div className="flex flex-col gap-5 sm:gap-6">
    <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <Kpi label="Activos" value={activeTotal} detail={k ? `${k.pendientes} por atender · ${k.en_proceso} en atención` : ""} active={view === "ACTIVAS"} icon={<ListTodo className="size-4" />} onClick={() => chooseView("ACTIVAS")} />
      <Kpi label="Por atender" value={k?.pendientes} detail={k ? `${k.sin_asignar} sin asignar` : ""} active={view === "PENDIENTE"} icon={<Clock3 className="size-4" />} onClick={() => chooseView("PENDIENTE")} />
      <Kpi label="En atención" value={k?.en_proceso} detail={k ? `${k.urgentes_abiertos} urgentes activas` : ""} active={view === "EN_PROCESO"} icon={<LoaderCircle className="size-4" />} onClick={() => chooseView("EN_PROCESO")} />
      <Kpi label="Cerradas" value={k?.resueltos} detail={k ? `${k.cerrados_mes} cerradas este mes` : ""} active={view === "RESUELTO"} icon={<CheckCircle2 className="size-4" />} onClick={() => chooseView("RESUELTO")} />
    </section>

    <Card className="overflow-hidden border-linea/80">
      <header className="border-b border-linea bg-white px-4 py-5 sm:px-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-casma">Bandeja de trabajo</p><h1 className="mt-1 text-2xl font-bold text-tinta">{view === "RESUELTO" ? "Historial de incidencias" : tab.label}</h1><p className="mt-1 text-sm text-tenue">{tab.help} {total > 0 && <strong className="text-tinta">{total} {total === 1 ? "caso" : "casos"}.</strong>}</p></div>
          <div className="-mx-1 overflow-x-auto px-1 pb-1"><div className="flex w-max gap-1 rounded-xl bg-papel p-1">{TABS.map((x) => <button key={x.value} onClick={() => chooseView(x.value)} className={cx("min-h-10 rounded-lg px-3.5 py-2 text-sm font-semibold transition", view === x.value ? "bg-casma-oscuro text-white shadow-sm" : "text-tenue hover:bg-white hover:text-tinta")}>{x.label}</button>)}</div></div>
        </div>

        {view === "RESUELTO" && k && <div className="mt-4 flex flex-wrap gap-2 rounded-xl border border-linea bg-papel/60 px-4 py-3 text-sm"><strong>Resumen:</strong><span>{k.resueltos} históricas</span><span>•</span><span>{k.cerrados_mes} este mes</span>{k.reabiertos_30d > 0 && <><span>•</span><span>{k.reabiertos_30d} reabiertas en 30 días</span></>}</div>}

        <div className="mt-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="relative w-full max-w-xl"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tenue" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar código, oficina, usuario, descripción o equipo" className="bg-papel pl-9 shadow-none" /></div>
          {view === "RESUELTO" ? <div className="flex flex-wrap gap-2">
            <Select value={period} onChange={(e) => setPeriod(e.target.value as Period)} className="min-w-40">{(Object.keys(PERIODS) as Period[]).map((x) => <option key={x} value={x}>{PERIODS[x]}</option>)}</Select>
            <Select value={closedSort} onChange={(e) => setClosedSort(e.target.value as ClosedSort)} className="min-w-44">{(Object.keys(CLOSED_SORT) as ClosedSort[]).map((x) => <option key={x} value={x}>{CLOSED_SORT[x]}</option>)}</Select>
            <FilterButton count={advancedCount} open={filtersOpen} onClick={() => setFiltersOpen((v) => !v)} />
          </div> : <div className="flex flex-wrap gap-2">
            <Quick label="Mis incidencias" icon={<UserRound className="size-4" />} active={mine} onClick={() => { setMine((v) => !v); setUnassigned(false); setTechnician(""); }} />
            <Quick label="Urgentes" icon={<AlertTriangle className="size-4" />} active={urgent} onClick={() => { setUrgent((v) => !v); setPriority(""); }} />
            <Quick label="Sin asignar" icon={<UsersRound className="size-4" />} active={unassigned} onClick={() => { setUnassigned((v) => !v); setMine(false); setTechnician(""); }} />
            <Select value={workSort} onChange={(e) => setWorkSort(e.target.value as WorkSort)} className="min-w-44">{(Object.keys(WORK_SORT) as WorkSort[]).map((x) => <option key={x} value={x}>{WORK_SORT[x]}</option>)}</Select>
            <FilterButton count={advancedCount} open={filtersOpen} onClick={() => setFiltersOpen((v) => !v)} />
          </div>}
        </div>

        {filtersOpen && <div className="mt-4 rounded-2xl border border-linea bg-papel/55 p-4">
          <div className="mb-3 flex items-center justify-between gap-3"><div><p className="font-bold">Filtros avanzados</p><p className="text-xs text-tenue">Jerarquía municipal: Zona → Oficina → Usuario.</p></div><Button size="sm" variant="ghost" onClick={clear}><X className="size-4" /> Limpiar</Button></div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Field label="Zona"><Select value={zone} onChange={(e) => { setZone(e.target.value); setOffice(""); setMunicipalUser(""); }}><option value="">Todas las zonas</option>{activeZones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</Select></Field>
            <Field label="Oficina"><Select value={office} disabled={!zone} onChange={(e) => { setOffice(e.target.value); setMunicipalUser(""); }}><option value="">{zone ? "Todas las oficinas de la zona" : "Seleccione primero una zona"}</option>{activeOffices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select></Field>
            <Field label="Usuario"><Select value={municipalUser} disabled={!office} onChange={(e) => setMunicipalUser(e.target.value)}><option value="">{office ? "Todos los usuarios de la oficina" : "Seleccione primero una oficina"}</option>{(users.data ?? []).filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.full_name}{u.job_title ? ` · ${u.job_title}` : ""}</option>)}</Select></Field>
            <Field label={view === "RESUELTO" ? "Técnico que atendió" : "Técnico responsable"}><Select value={technician} onChange={(e) => { setTechnician(e.target.value); setMine(false); setUnassigned(false); }}><option value="">Todos los técnicos</option>{(techs.data ?? []).filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}</Select></Field>
            <Field label="Categoría"><Select value={category} onChange={(e) => setCategory(e.target.value as "" | TicketCategory)}><option value="">Todas las categorías</option>{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</Select></Field>
            <Field label="Prioridad"><Select value={priority} onChange={(e) => { setPriority(e.target.value as "" | TicketPriority); setUrgent(false); }}><option value="">Todas las prioridades</option>{(["ALTA", "MEDIA", "BAJA"] as TicketPriority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</Select></Field>
            {view === "RESUELTO" ? <><Field label="Tipo de cierre"><Select value={resolution} onChange={(e) => setResolution(e.target.value as "" | ResolutionType)}><option value="">Todos los tipos</option>{(Object.keys(RESOLUTION) as ResolutionType[]).map((r) => <option key={r} value={r}>{RESOLUTION[r]}</option>)}</Select></Field>{period === "custom" && <><Field label="Cerrada desde"><Input type="date" value={closedFrom} onChange={(e) => setClosedFrom(e.target.value)} /></Field><Field label="Cerrada hasta"><Input type="date" value={closedTo} onChange={(e) => setClosedTo(e.target.value)} /></Field></>}</> : <Field label="Fecha de registro"><Input type="date" value={createdDate} onChange={(e) => setCreatedDate(e.target.value)} /></Field>}
          </div>
        </div>}

        {(zone || office || municipalUser) && <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-tenue"><MapPin className="size-4 text-casma" /><strong className="text-tinta">Ruta:</strong><span>{activeZones.find((z) => z.id === zone)?.name ?? "Todas las zonas"}</span>{office && <><span>→</span><span>{offices.data?.find((o) => o.id === office)?.name}</span></>}{municipalUser && <><span>→</span><span>{users.data?.find((u) => u.id === municipalUser)?.full_name}</span></>}</div>}
      </header>

      {list.isLoading ? <div className="p-6"><Spinner /></div> : list.error ? <div className="p-5"><ErrorBox message={errorMessage(list.error)} /></div> : tickets.length === 0 ? <EmptyState icon={view === "RESUELTO" ? <CheckCircle2 /> : <ListTodo />} title={view === "RESUELTO" ? "No hay incidencias cerradas con estos filtros" : "No hay incidencias que coincidan"} /> : <TicketList tickets={tickets} onOpen={setOpenId} />}
      {list.hasNextPage && <div className="border-t border-linea bg-white p-4 text-center"><Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>Cargar más</Button></div>}
    </Card>

    <Modal open={params.get("new") === "1"} onClose={closeCreate} title="Nueva incidencia" wide><NewTicketForm variant="modal" onCreated={(id) => { closeCreate(); setOpenId(id); }} /></Modal>
    <TicketDetail ticketId={openId} onClose={closeTicket} />
  </div>;
}

function TicketList({ tickets, onOpen }: { tickets: Ticket[]; onOpen: (id: string) => void }) {
  return <><div className="divide-y divide-linea bg-white md:hidden">{tickets.map((t) => <article key={t.id} className="p-4"><button className="block w-full text-left" onClick={() => onOpen(t.id)}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.08em] text-tenue">{t.number}</p><h3 className="mt-1 font-bold text-tinta">{t.subject}</h3></div><PriorityBadge priority={t.priority} /></div><p className="mt-2 line-clamp-2 text-sm text-tenue">{t.description || "Sin descripción adicional"}</p></button><div className="mt-3 flex items-center gap-2 text-xs text-tenue"><StatusBadge status={t.status} /><span>{CATEGORY_LABEL[t.category]}</span></div><div className="mt-3 rounded-xl bg-papel/70 p-3 text-xs leading-5 text-tenue"><p className="font-semibold text-tinta">{t.office_name}</p><p>{t.reporter_name || "Usuario no especificado"}{t.equipment?.patrimonial_code ? ` · ${t.equipment.patrimonial_code}` : ""}</p>{t.status === "RESUELTO" ? <div className="mt-2 flex items-center gap-2 rounded-lg border border-casma/20 bg-casma-claro/70 px-2.5 py-2 text-casma-oscuro"><UserRound className="size-4 shrink-0" /><span><strong>Técnico que atendió:</strong> {t.resolution?.resolved_by_name || t.assigned_to_name || "No registrado"}</span></div> : <p>{t.assigned_to_name ? `Responsable: ${t.assigned_to_name}` : "Sin técnico asignado"}</p>}{t.status === "RESUELTO" && t.resolution?.notes && <p className="mt-2 line-clamp-2">Solución: {t.resolution.notes}</p>}</div><div className="mt-3 flex items-center justify-between gap-3"><span className="text-xs text-tenue">{t.status === "RESUELTO" && t.resolution?.resolved_at ? `Cerrada ${ago(t.resolution.resolved_at).toLowerCase()}` : ago(t.created_at)}</span><Button size="sm" variant={t.status === "RESUELTO" ? "secondary" : "success"} onClick={() => onOpen(t.id)}>{actionLabel(t)} <ArrowRight className="size-4" /></Button></div></article>)}</div>
    <div className="hidden overflow-x-auto bg-white md:block"><table className="min-w-full text-left"><thead className="bg-papel/70 text-xs font-bold uppercase tracking-[0.07em] text-tenue"><tr><th className="px-5 py-4 sm:px-6">Incidencia</th><th className="px-5 py-4">Contexto</th><th className="px-5 py-4">Atención</th><th className="px-5 py-4">Acción</th></tr></thead><tbody>{tickets.map((t) => <tr key={t.id} className="border-t border-linea/80 align-top hover:bg-casma-claro/25"><td className="px-5 py-4 sm:px-6"><button className="max-w-xl text-left" onClick={() => onOpen(t.id)}><p className="text-xs font-bold uppercase tracking-[0.08em] text-tenue">{t.number}</p><p className="mt-1 font-bold text-tinta">{t.subject}</p><p className="mt-1 line-clamp-2 text-sm text-tenue">{t.description || "Sin descripción adicional"}</p></button><div className="mt-2 flex gap-2"><PriorityBadge priority={t.priority} /><StatusBadge status={t.status} /></div></td><td className="px-5 py-4 text-sm"><p className="flex items-center gap-1.5 font-semibold text-tinta"><Building2 className="size-4 text-casma" /> {t.office_name}</p><p className="mt-1 text-tenue">{CATEGORY_LABEL[t.category]}</p><p className="mt-1 text-xs text-tenue">{t.reporter_name || "Usuario no especificado"}{t.equipment?.patrimonial_code ? ` · ${t.equipment.patrimonial_code}` : ""}</p></td><td className="px-5 py-4 text-sm">{t.status === "RESUELTO" ? <><div className="rounded-xl border border-casma/20 bg-casma-claro/65 p-3"><p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.08em] text-casma-oscuro"><UserRound className="size-4" /> Técnico que atendió</p><p className="mt-1 text-base font-bold text-tinta">{t.resolution?.resolved_by_name || t.assigned_to_name || "No registrado"}</p></div><p className="mt-2 text-xs text-tenue">{t.resolution?.resolved_at ? `Cerrada: ${when(t.resolution.resolved_at)}` : "Fecha de cierre no registrada"}</p>{t.resolution?.notes && <p className="mt-2 line-clamp-2 max-w-sm text-xs text-tenue">Solución: {t.resolution.notes}</p>}</> : <><p className={cx("font-semibold", t.assigned_to_name ? "text-tinta" : "text-amber-700")}>{t.assigned_to_name || "Sin técnico asignado"}</p><p className="mt-1 text-xs text-tenue">{ago(t.created_at)} · {when(t.created_at)}</p></>}</td><td className="px-5 py-4"><Button size="sm" variant={t.status === "RESUELTO" ? "secondary" : "success"} onClick={() => onOpen(t.id)}>{actionLabel(t)} <ArrowRight className="size-4" /></Button></td></tr>)}</tbody></table></div></>;
}

function Kpi({ label, value, detail, active, icon, onClick }: { label: string; value?: number; detail: string; active: boolean; icon: ReactNode; onClick: () => void }) { return <button onClick={onClick} className={cx("rounded-2xl border bg-white p-4 text-left shadow-[0_8px_24px_rgba(15,23,42,0.05)] transition hover:border-amber-300 sm:p-5", active ? "border-amber-400 bg-amber-50/60 ring-2 ring-amber-200/50" : "border-transparent")}><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-tenue">{label}</p><p className="mt-2 text-3xl font-bold text-tinta">{value ?? "–"}</p></div><span className="grid size-10 place-items-center rounded-xl bg-casma-claro text-casma-oscuro">{icon}</span></div><p className="mt-4 text-xs text-tenue sm:text-sm">{detail || "Información en actualización"}</p></button>; }
function Quick({ label, icon, active, onClick }: { label: string; icon: ReactNode; active: boolean; onClick: () => void }) { return <button onClick={onClick} className={cx("inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold", active ? "border-casma/30 bg-casma-claro text-casma-oscuro" : "border-linea bg-white text-tenue hover:text-tinta")}>{icon}{label}</button>; }
function FilterButton({ count, open, onClick }: { count: number; open: boolean; onClick: () => void }) { return <Button variant="secondary" onClick={onClick}><Filter className="size-4" /> Filtros{count ? ` (${count})` : ""}{open ? " · Ocultar" : ""}</Button>; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="flex flex-col gap-1.5 text-xs font-bold text-tenue">{label}{children}</label>; }