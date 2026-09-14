import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Fragment } from "react";
import { Activity, BrainCircuit, Radar, RefreshCw, TriangleAlert } from "lucide-react";
import { useToast } from "../../components/Toasts";
import { Button, Card, cx, ErrorBox, Spinner } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { CATEGORY_LABEL, fmtDateTime, pct } from "../../lib/labels";
import { useInsights, useIsAdmin } from "./hooks";
import { PageHeader } from "./PageHeader";

export function AIInsightsPage() {
  const insights = useInsights();
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
  const maxTrend = Math.max(1, ...d.category_trend.flatMap((c) => [c.last_30d, c.previous_30d]));
  const maxOffice = Math.max(1, ...d.offices_30d.map((o) => o.count));
  const metrics = d.model?.metrics as { category?: { f1_macro_cv?: number }; risk?: { mode?: string; roc_auc_holdout?: number }; priority?: { mode?: string } } | undefined;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Análisis con IA" description="Mantenimiento predictivo, tendencias y detección de fallas masivas."
        actions={<>
          <Button variant="secondary" loading={scan.isPending} onClick={() => scan.mutate()}><Radar className="size-4" /> Buscar fallas masivas</Button>
          {isAdmin && <Button variant="secondary" loading={retrain.isPending} onClick={() => retrain.mutate()}><RefreshCw className="size-4" /> Reentrenar</Button>}
        </>} />

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
            {!d.equipment_risk.length && <p className="text-tenue">Registre equipos para ver el ranking.</p>}
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
