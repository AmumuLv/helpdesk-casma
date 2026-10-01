import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Activity, BrainCircuit, Clock3, Cpu, PauseCircle, Radar, RefreshCw, TrendingUp, TriangleAlert,
} from "lucide-react";
import { useToast } from "../../components/Toasts";
import { Badge, Button, Card, ErrorBox, Spinner, Stat, cx } from "../../components/ui";
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

function Bar({ label, value, max, display, tone }: { label: string; value: number; max: number; display: string; tone: string }) {
  const width = value <= 0 ? 0 : Math.max(4, (value / Math.max(1, max)) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[0.82rem] font-medium text-tinta-2">{label}</span>
        <span className="text-[0.82rem] font-bold text-tinta">{display}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-papel-2">
        <div className={cx("h-full rounded-full", tone)} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function Block({ title, hint, icon, children, action }: { title: string; hint?: string; icon?: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-linea px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[0.9rem] font-bold text-tinta">{icon}{title}</h2>
          {hint && <p className="mt-0.5 text-[0.78rem] leading-5 text-tenue">{hint}</p>}
        </div>
        {action}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </Card>
  );
}

/**
 * Análisis con IA. Cuatro bloques con una función clara cada uno:
 * 1) Alertas y picos (lo que exige una acción hoy).
 * 2) Estado y tiempos de atención (operación de los últimos 30 días).
 * 3) Riesgo de falla por equipo (mantenimiento preventivo).
 * 4) Tendencias y estado de los modelos (contexto y trazabilidad).
 */
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
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["insights"] });
      toast({ tone: r.created.length ? "danger" : "success", title: r.created.length ? `${r.created.length} alerta(s) nuevas` : "No se detectaron fallas masivas" });
    },
    onError,
  });
  const closeAlert = useMutation({
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
  const alerts = d.active_alerts;
  const bursts = d.live_bursts;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Análisis con IA"
        description="Señales que ayudan a decidir: qué está fallando ahora, qué Equipos Ambonitar y cómo evoluciona la carga."
        actions={<>
          <Button variant="secondary" loading={scan.isPending} onClick={() => scan.mutate()}><Radar className="size-4" /> Buscar fallas masivas</Button>
          {isAdmin && <Button variant="secondary" loading={retrain.isPending} onClick={() => retrain.mutate()}><RefreshCw className="size-4" /> Reentrenar</Button>}
        </>}
      />

      {/* 1 · Alertas y picos */}
      {(alerts.length > 0 || bursts.length > 0) && (
        <section className="flex flex-col gap-2" aria-label="Alertas activas">
          {alerts.map((alert) => (
            <div key={alert.id} className="flex flex-wrap items-start gap-3 rounded-xl border border-red-200 bg-alerta-claro px-4 py-3">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-alerta" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[0.85rem] font-bold text-alerta">{alert.title}</p>
                <p className="mt-0.5 text-[0.8rem] leading-5 text-tinta-2">{alert.message}</p>
                <p className="mt-1 text-[0.72rem] text-tenue">Vigente hasta {fmtDateTime(alert.until)}</p>
              </div>
              <Button size="sm" variant="secondary" loading={closeAlert.isPending && closeAlert.variables === alert.id} onClick={() => closeAlert.mutate(alert.id)}>Cerrar</Button>
            </div>
          ))}
          {bursts.map((burst, index) => (
            <div key={index} className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5">
              <Activity className="size-4 shrink-0 text-amber-700" aria-hidden />
              <p className="min-w-0 flex-1 text-[0.8rem] text-amber-900">
                <strong className="font-bold">Pico detectado:</strong> {CATEGORY_LABEL[burst.category]} en {burst.location ?? "varias ubicaciones"} — {burst.count} casos frente a {burst.expected.toFixed(1)} esperados.
              </p>
            </div>
          ))}
        </section>
      )}

      {/* 2 · Estado y tiempos de atención */}
      <Block
        title="Estado y tiempos de atención"
        hint="Últimos 30 días. Referencia operativa para detectar casos rezagados; no es un SLA ni evalúa al técnico."
        icon={<Clock3 className="size-4 text-casma" aria-hidden />}
        action={<Badge className="border-casma/25 bg-casma-claro text-casma-oscuro">Orientativo</Badge>}
      >
        {followUp.error ? (
          <p className="text-[0.8rem] text-amber-800">No se pudieron cargar las métricas de seguimiento. El resto del análisis sigue disponible.</p>
        ) : !f ? (
          <Spinner label="Calculando métricas" />
        ) : (
          <>
            <div className="grid gap-5 xl:grid-cols-2">
              <div className="space-y-4">
                <p className="flex items-center gap-1.5 text-[0.72rem] font-bold uppercase tracking-[0.07em] text-tenue-2"><PauseCircle className="size-3.5" aria-hidden /> Casos por revisar</p>
                <Bar label="En espera" value={f.waiting} max={maxFollowState} display={String(f.waiting)} tone="bg-casma" />
                <Bar label="Requieren revisión" value={f.requieren_revision} max={maxFollowState} display={String(f.requieren_revision)} tone="bg-orange-500" />
                <Bar label="Sin actualización reciente" value={f.sin_actualizacion} max={maxFollowState} display={String(f.sin_actualizacion)} tone="bg-amber-500" />
              </div>
              <div className="space-y-4">
                <p className="flex items-center gap-1.5 text-[0.72rem] font-bold uppercase tracking-[0.07em] text-tenue-2"><Clock3 className="size-3.5" aria-hidden /> Tiempos promedio</p>
                <Bar label="Primera respuesta" value={f.primera_respuesta_horas_30d ?? 0} max={maxFollowTime} display={formatHours(f.primera_respuesta_horas_30d)} tone="bg-casma" />
                <Bar label="Entre avances" value={f.entre_actualizaciones_horas_30d ?? 0} max={maxFollowTime} display={formatHours(f.entre_actualizaciones_horas_30d)} tone="bg-tenue-2" />
                <Bar label="Resolución" value={f.resolucion_horas_30d ?? 0} max={maxFollowTime} display={formatHours(f.resolucion_horas_30d)} tone="bg-amber-500" />
              </div>
            </div>
            <div className="mt-5 grid gap-2.5 border-t border-linea pt-4 sm:grid-cols-3">
              <Stat label="Casos recurrentes" value={f.casos_recurrentes_30d} helper="Equipos con incidencias repetidas" />
              <Stat label="Oficina con más casos" value={<span className="text-base">{f.top_office_30d ?? "Sin patrón"}</span>} helper="Concentración en el periodo" />
              <Stat label="Equipo recurrente" value={<span className="text-base">{f.top_equipment_30d ?? "Sin patrón"}</span>} helper={f.top_equipment_30d ? `${f.top_equipment_incidents_30d} incidencias en 30 días` : "Sin concentración destacable"} />
            </div>
          </>
        )}
      </Block>

      {/* 3 · Riesgo de falla por equipo */}
      <Block
        title="Equipos con mayor riesgo de falla"
        hint="Probabilidad de una nueva incidencia de hardware en los próximos 30 días. Priorice aquí el mantenimiento preventivo."
        icon={<Cpu className="size-4 text-casma" aria-hidden />}
      >
        {d.equipment_risk.length === 0 ? (
          <p className="py-6 text-center text-[0.82rem] text-tenue">Registre equipos para ver el análisis de riesgo.</p>
        ) : (
          <ol className="divide-y divide-linea">
            {d.equipment_risk.map((row) => (
              <li key={row.equipment_id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.85rem] font-semibold text-tinta">{row.patrimonial_code}: {row.name}</p>
                  <p className="mt-0.5 truncate text-[0.74rem] text-tenue">{row.office}</p>
                  {row.factors.length > 0 && <p className="mt-0.5 truncate text-[0.72rem] text-tenue-2">{row.factors.join(" · ")}</p>}
                </div>
                <div className="w-24 shrink-0 sm:w-32">
                  <div className="h-1.5 overflow-hidden rounded-full bg-papel-2">
                    <div className={cx("h-full rounded-full", row.risk > 0.6 ? "bg-red-500" : row.risk > 0.35 ? "bg-amber-500" : "bg-emerald-600")} style={{ width: pct(row.risk) }} />
                  </div>
                  <p className="mt-1 text-right text-[0.75rem] font-bold text-tinta">{pct(row.risk)}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Block>

      {/* 4 · Tendencias y modelos */}
      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Block title="Categorías: 30 días frente a los 30 anteriores" hint="Detecta cambios en el tipo de trabajo que llega al área." icon={<TrendingUp className="size-4 text-casma" aria-hidden />}>
          <ul className="space-y-2.5">
            {d.category_trend.filter((c) => c.last_30d || c.previous_30d).map((c) => (
              <li key={c.category}>
                <div className="flex items-baseline justify-between gap-3 text-[0.82rem]">
                  <span className="font-medium text-tinta-2">{c.label}</span>
                  <span className="text-tenue"><strong className="font-bold text-tinta">{c.last_30d}</strong> <span className="text-tenue-2">antes {c.previous_30d}</span></span>
                </div>
                <div className="mt-1 space-y-0.5">
                  <div className="h-1.5 rounded-full bg-casma" style={{ width: `${(c.last_30d / maxTrend) * 100}%` }} />
                  <div className="h-1 rounded-full bg-linea-fuerte" style={{ width: `${(c.previous_30d / maxTrend) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </Block>

        <Block title="Oficinas con más incidencias" hint="Dónde se concentra la carga durante el último mes.">
          {d.offices_30d.length === 0 ? (
            <p className="py-6 text-center text-[0.82rem] text-tenue">Sin incidencias en el periodo.</p>
          ) : (
            <ul className="space-y-2">
              {d.offices_30d.map((o) => (
                <li key={o.office} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-[0.82rem]">
                  <span className="truncate font-medium text-tinta-2">{o.office}</span>
                  <div className="h-2 overflow-hidden rounded-full bg-papel-2"><div className="h-full rounded-full bg-tinta" style={{ width: `${(o.count / maxOffice) * 100}%` }} /></div>
                  <span className="font-bold text-tinta">{o.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Block>
      </div>

      {d.model && (
        <Block title="Estado de los modelos" hint="Trazabilidad del entrenamiento: qué datos usa el sistema y con qué rendimiento." icon={<BrainCircuit className="size-4 text-casma" aria-hidden />}>
          <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
            <Row label="Versión" value={d.model.version} />
            <Row label="Entrenado" value={fmtDateTime(d.model.trained_at)} />
            <Row label="Representación de texto" value={d.model.backend} />
            <Row label="Clasificador (F1 interno)" value={metrics?.category?.f1_macro_cv != null ? pct(metrics.category.f1_macro_cv) : "–"} />
            <Row label="Prioridad" value={metrics?.priority?.mode ?? "–"} />
            <Row label="Riesgo de falla" value={metrics?.risk?.mode === "gradient_boosting" ? `Aprendido (AUC ${metrics.risk.roc_auc_holdout})` : "Modelo experto"} />
            {Object.entries(d.model.samples).map(([key, value]) => <Row key={key} label={`Muestras ${key}`} value={String(value)} />)}
          </dl>
          <p className="mt-4 border-t border-linea pt-3 text-[0.75rem] leading-5 text-tenue">
            El F1 se mide sobre el mismo corpus de entrenamiento, así que es una cifra optimista. La señal real es cuántas veces el técnico
            corrige la categoría en el detalle de la incidencia: cada corrección entra al siguiente entrenamiento.
          </p>
        </Block>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.7rem] font-bold uppercase tracking-[0.06em] text-tenue-2">{label}</dt>
      <dd className="mt-0.5 text-[0.83rem] font-semibold text-tinta">{value}</dd>
    </div>
  );
}
