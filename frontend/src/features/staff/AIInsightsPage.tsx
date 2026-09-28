import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Fragment } from "react";
import { Activity, BrainCircuit, Clock3, PauseCircle, Radar, RefreshCw, TriangleAlert } from "lucide-react";
import { useToast } from "../../components/Toasts";
import { Button, Card, cx, ErrorBox, Spinner } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { CATEGORY_LABEL, fmtDateTime, pct } from "../../lib/labels";
import { useFollowUpMetrics, useInsights, useIsAdmin } from "./hooks";
import { PageHeader } from "./PageHeader";

function formatHours(value: number | null | undefined) {
  if (value == null) return "Sin datos";
  const minutes = Math.max(1, Math.round(value * 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function MetricBar({ label, value, max, display, tone = "green" }: { label: string; value: number; max: number; display: string; tone?: "green" | "amber" | "orange" | "slate" }) {
  const width = value <= 0 ? 0 : Math.max(5, (value / Math.max(1, max)) * 100);
  const barClass = tone === "amber" ? "bg-amber-500" : tone === "orange" ? "bg-orange-500" : tone === "slate" ? "bg-slate-700" : "bg-casma";
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-semibold text-tinta">{label}</span>
        <span className="shrink-0 font-bold text-tinta">{display}</span>
      </div>
      <div className="mt-2 h-3 overflow-hidden rounded-full bg-papel">
        <div className={cx("h-full rounded-full transition-all", barClass)} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function ContextCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-xl border border-linea bg-papel/45 p-4">
      <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-tenue">{label}</p>
      <p className="mt-2 break-words text-lg font-bold text-tinta">{value}</p>
      <p className="mt-1 text-xs leading-5 text-tenue">{helper}</p>
    </div>
  );
}

export function AIInsightsPage() {
  const insights = useInsights();
  const followUp = useFollowUpMetrics(true);
  const isAdmin = useIsAdmin();
  const qc = useQueryClient();
  const toast = useToast();
  const onError = (err: unknown) => toast({ tone: "danger", title: "No se pudo completar", body: errorMessage(err) });
  const retrain = useMutation({
    mutationFn: () => api("/ai/retrain", { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["insights"] }); toast({ tone: "success", title: "Modelos reentrenados" }); },
    onError,
  });
  const scan = useMutation({
    mutationFn: () => api<{ created: { title: string }[] }>("/ai/scan-anomalies", { method: "POST" }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["insights"] }); toast({ tone: r.created.length ? "danger" : "success", title: r.created.length ? `${r.created.length} alerta(s) nuevas` : "No se detectaron fallas masivas" }); },
    onError,
  });
  const close = useMutation({
    mutationFn: (id: string) => api(`/ai/alerts/${id}/close`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["insights"] }),
    onError,
  });

  if (insights.isLoading) return <Spinner label="Calculando análisis" />;
  if (!insights.data) return <ErrorBox message={errorMessage(insights.error)} />;
  const d = insights.data;
  const f = followUp.data;
  const maxTrend = Math.max(1, ...d.category_trend.flatMap((c) => [c.last_30d, c.previous_30d]));
  const maxOffice = Math.max(1, ...d.offices_30d.map((o) => o.count));
  const maxFollowState = f ? Math.max(1, f.waiting, f.requieren_revision, f.sin_actualizacion) : 1;
  const maxFollowTime = f ? Math.max(1, f.primera_respuesta_horas_30d ?? 0, f.entre_actualizaciones_horas_30d ?? 0, f.resolucion_horas_30d ?? 0) : 1;
  const metrics = d.model?.metrics as { category?: { f1_macro_cv?: number }; risk?: { mode?: string; roc_auc_holdout?: number }; priority?: { mode?: string } } | undefined;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Análisis con IA" description="Seguimiento operativo, mantenimiento predictivo, tendencias y detección de patrones."
        actions={<>
          <Button variant="secondary" loading={scan.isPending} onClick={() => scan.mutate()}><Radar className="size-4" /> Buscar fallas masivas</Button>
          {isAdmin && <Button variant="secondary" loading={retrain.isPending} onClick={() => retrain.mutate()}><RefreshCw className="size-4" /> Reentrenar</Button>}
        </>} />

      {f && (
        <Card className="overflow-hidden">
          <div className="border-b border-linea bg-white px-4 py-4 sm:px-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.1em] text-casma-oscuro"><BrainCircuit className="size-4" /> Seguimiento operativo · 30 días</p>
                <h2 className="mt-1 text-xl font-bold text-tinta">Estado y tiempos de atención</h2>
                <p className="mt-1 max-w-3xl text-sm text-tenue">Vista gráfica para detectar casos que necesitan atención y patrones generales. Es una referencia operativa, no un ranking ni una evaluación automática del técnico.</p>
              </div>
              <span className="w-fit rounded-full border border-casma/20 bg-casma-claro px-3 py-1.5 text-xs font-bold text-casma-oscuro">Análisis contextual</span>
            </div>
          </div>

          <div className="grid gap-5 p-4 sm:p-5 xl:grid-cols-2">
            <section className="rounded-2xl border border-linea bg-white p-4">
              <div className="mb-4 flex items-center gap-2">
                <PauseCircle className="size-5 text-casma" />
                <div><h3 className="font-bold text-tinta">Casos que conviene revisar</h3><p className="text-xs text-tenue">Situación actual de las incidencias abiertas.</p></div>
              </div>
              <div className="space-y-5">
                <MetricBar label="En espera" value={f.waiting} max={maxFollowState} display={`${f.waiting}`} tone="green" />
                <MetricBar label="Requieren revisión" value={f.requieren_revision} max={maxFollowState} display={`${f.requieren_revision}`} tone="orange" />
                <MetricBar label="Sin actualización reciente" value={f.sin_actualizacion} max={maxFollowState} display={`${f.sin_actualizacion}`} tone="amber" />
              </div>
            </section>

            <section className="rounded-2xl border border-linea bg-white p-4">
              <div className="mb-4 flex items-center gap-2">
                <Clock3 className="size-5 text-casma" />
                <div><h3 className="font-bold text-tinta">Tiempos de atención</h3><p className="text-xs text-tenue">Promedios de los últimos 30 días.</p></div>
              </div>
              <div className="space-y-5">
                <MetricBar label="Primera respuesta" value={f.primera_respuesta_horas_30d ?? 0} max={maxFollowTime} display={formatHours(f.primera_respuesta_horas_30d)} tone="green" />
                <MetricBar label="Entre avances" value={f.entre_actualizaciones_horas_30d ?? 0} max={maxFollowTime} display={formatHours(f.entre_actualizaciones_horas_30d)} tone="slate" />
                <MetricBar label="Resolución" value={f.resolucion_horas_30d ?? 0} max={maxFollowTime} display={formatHours(f.resolucion_horas_30d)} tone="amber" />
              </div>
            </section>
          </div>

          <div className="grid gap-3 border-t border-linea bg-papel/25 p-4 sm:p-5 md:grid-cols-3">
            <ContextCard label="Casos recurrentes" value={String(f.casos_recurrentes_30d)} helper="Incidencias repetidas asociadas a equipos durante los últimos 30 días." />
            <ContextCard label="Oficina con mayor concentración" value={f.top_office_30d || "Sin patrón claro"} helper="Oficina con más incidencias registradas en el periodo, si existe una concentración identificable." />
            <ContextCard label="Equipo recurrente" value={f.top_equipment_30d || "Sin patrón claro"} helper={f.top_equipment_30d ? `${f.top_equipment_incidents_30d} incidencias asociadas en los últimos 30 días.` : "No se detectó un equipo con recurrencia destacable."} />
          </div>
        </Card>
      )}

      {followUp.error && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">No se pudieron cargar las métricas de seguimiento. El resto del análisis sigue disponible.</div>}

      {d.active_alerts.map((a) => (
        <div key={a.id} className="flex flex-wrap items-start gap-3 rounded-2xl border border-alerta/40 bg-alerta-claro p-4">
          <TriangleAlert className="size-5 text-alerta" aria-hidden />
          <div className="flex-1"><p className="font-bold text-alerta">{a.title}</p><p className="text-sm">{a.message}</p><p className="text-xs text-tenue">Vigente hasta {fmtDateTime(a.until)}</p></div>
          <Button size="sm" variant="secondary" loading={close.isPending && close.variables === a.id} onClick={() => close.mutate(a.id)}>Cerrar alerta</Button>
        </div>
      ))}
      {d.live_bursts.length > 0 && !d.active_alerts.length && (
        <Card className="p-4 text-sm">
          <p className="mb-1 font-bold">Picos detectados en las últimas horas</p>
          {d.live_bursts.map((b, i) => <p key={i}>{CATEGORY_LABEL[b.category]} en {b.location ?? "varias ubicaciones"}: {b.count} casos (esperado {b.expected.toFixed(1)})</p>)}
        </Card>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Card className="p-4">
          <h2 className="mb-1 flex items-center gap-2 text-lg font-bold"><Activity className="size-5 text-casma" /> Equipos con mayor riesgo de falla</h2>
          <p className="mb-4 text-sm text-tenue">Probabilidad de nueva incidencia de hardware en los próximos 30 días. Priorice su mantenimiento preventivo.</p>
          <ol className="flex flex-col gap-3">
            {d.equipment_risk.map((r) => (
              <li key={r.equipment_id} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                <div className="min-w-0"><p className="truncate font-bold">{r.patrimonial_code}: {r.name}</p><p className="truncate text-xs text-tenue">{r.office}{r.factors.length > 0 && `. ${r.factors.join("; ")}`}</p></div>
                <span className="font-bold">{pct(r.risk)}</span>
                <div className="col-span-2 h-2 overflow-hidden rounded-full bg-papel"><div className={cx("h-full rounded-full", r.risk > 0.6 ? "bg-alerta" : r.risk > 0.35 ? "bg-sol" : "bg-hecho")} style={{ width: pct(r.risk) }} /></div>
              </li>
            ))}
            {!d.equipment_risk.length && <p className="text-tenue">Registre equipos para ver el análisis de riesgo.</p>}
          </ol>
        </Card>

        <div className="flex flex-col gap-5">
          <Card className="p-4">
            <h2 className="mb-4 text-lg font-bold">Categorías: últimos 30 días frente a los 30 anteriores</h2>
            <ul className="flex flex-col gap-2.5">
              {d.category_trend.filter((c) => c.last_30d || c.previous_30d).map((c) => (
                <li key={c.category} className="text-sm">
                  <div className="flex justify-between"><span className="font-bold">{c.label}</span><span>{c.last_30d} <span className="text-tenue">(antes {c.previous_30d})</span></span></div>
                  <div className="mt-1 flex flex-col gap-0.5">
                    <div className="h-2 rounded-full bg-casma" style={{ width: `${(c.last_30d / maxTrend) * 100}%` }} />
                    <div className="h-1 rounded-full bg-linea" style={{ width: `${(c.previous_30d / maxTrend) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="p-4">
            <h2 className="mb-4 text-lg font-bold">Oficinas con más incidencias (30 días)</h2>
            <ul className="flex flex-col gap-2">
              {d.offices_30d.map((o) => (
                <li key={o.office} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm">
                  <span className="truncate">{o.office}</span>
                  <div className="h-2.5 rounded-full bg-tinta" style={{ width: `${(o.count / maxOffice) * 100}%` }} />
                  <span className="font-bold">{o.count}</span>
                </li>
              ))}
            </ul>
          </Card>
          {d.model && (
            <Card className="p-4 text-sm">
              <h2 className="mb-2 flex items-center gap-2 text-lg font-bold"><BrainCircuit className="size-5 text-casma" /> Estado de los modelos</h2>
              <dl className="grid grid-cols-2 gap-2">
                <dt className="text-tenue">Versión</dt><dd className="font-bold">{d.model.version}</dd>
                <dt className="text-tenue">Entrenado</dt><dd>{fmtDateTime(d.model.trained_at)}</dd>
                <dt className="text-tenue">Representación de texto</dt><dd>{d.model.backend}</dd>
                <dt className="text-tenue">Clasificador (F1 interno)</dt><dd>{metrics?.category?.f1_macro_cv != null ? pct(metrics.category.f1_macro_cv) : "–"}</dd>
                <dt className="text-tenue">Prioridad</dt><dd>{metrics?.priority?.mode ?? "–"}</dd>
                <dt className="text-tenue">Riesgo de falla</dt><dd>{metrics?.risk?.mode === "gradient_boosting" ? `Aprendido (AUC ${metrics.risk.roc_auc_holdout})` : "Modelo experto"}</dd>
                {Object.entries(d.model.samples).map(([k, v]) => <Fragment key={k}><dt className="text-tenue">Muestras {k}</dt><dd>{v}</dd></Fragment>)}
              </dl>
              <p className="mt-3 text-xs text-tenue">
                El F1 se mide sobre el mismo corpus de entrenamiento (frases semilla más incidencias ya clasificadas), así que es una cifra optimista.
                La señal real es cuántas veces el técnico corrige la categoría en el detalle de la incidencia: cada corrección entra al siguiente entrenamiento.
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
