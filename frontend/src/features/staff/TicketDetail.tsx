import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BrainCircuit, History, RefreshCw, ShieldCheck, Trash } from "lucide-react";
import { useMemo, useState } from "react";
import { useToast } from "../../components/Toasts";
import { Badge, Button, CategoryBadge, cx, ErrorBox, Modal, PriorityBadge, Select, Spinner, StatusBadge, Textarea } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { CATEGORIES, CATEGORY_LABEL, EQUIPMENT_LABEL, fmtDateTime, pct, PRIORITY_LABEL } from "../../lib/labels";
import type { ResolutionType, Ticket, TicketCategory, TicketPriority } from "../../lib/types";
import { useIsAdmin, useTechnicians, useTicketAction } from "./hooks";

const RESOLUTION_LABEL: Record<ResolutionType, string> = {
  SOLUCIONADO: "Solucionado",
  REPARADO: "Reparado",
  REEMPLAZADO: "Reemplazado",
  OBSOLETO: "Obsoleto",
  IRREPARABLE: "Irreparable",
  BAJA_PATRIMONIAL: "Baja patrimonial",
  DERIVADO: "Derivado",
};
const RESOLUTION_TYPES = Object.keys(RESOLUTION_LABEL) as ResolutionType[];

type TicketAuditEvent = {
  at: string;
  actor_type: string;
  actor_name: string | null;
  action: string;
  details: Record<string, unknown>;
};

type HistoryItem = {
  key: string;
  at: string;
  actor: string;
  text: string;
  internal: boolean;
  source: "timeline" | "audit";
};

export function TicketDetail({ ticketId, onClose }: { ticketId: string | null; onClose: () => void }) {
  const { data: t, isLoading, error } = useQuery({
    queryKey: ["ticket", ticketId],
    queryFn: () => api<Ticket>(`/tickets/${ticketId}`),
    enabled: !!ticketId,
  });
  return (
    <Modal open={!!ticketId} onClose={onClose} title={t ? `${t.number}: ${t.subject}` : "Incidencia"} wide>
      {isLoading ? <Spinner /> : !t ? <ErrorBox message={errorMessage(error)} /> : <Detail t={t} onClose={onClose} />}
    </Modal>
  );
}

function Detail({ t, onClose }: { t: Ticket; onClose: () => void }) {
  const isAdmin = useIsAdmin();
  const techs = useTechnicians();
  const qc = useQueryClient();
  const toast = useToast();
  const patch = useTicketAction<{ category?: TicketCategory; priority?: TicketPriority }>((id) => `/tickets/${id}`, "PATCH", "Clasificación corregida");
  const assign = useTicketAction<{ technician_id: string | null }>((id) => `/tickets/${id}/assign`, "POST", "Técnico asignado");
  const note = useTicketAction<{ text: string; visible_to_office: boolean }>((id) => `/tickets/${id}/notes`, "POST", "Nota agregada");
  const resolve = useTicketAction<{ notes: string; tipo_resolucion: ResolutionType }>((id) => `/tickets/${id}/resolve`, "POST", "Incidencia resuelta");
  const reopen = useTicketAction((id) => `/tickets/${id}/reopen`, "POST", "Incidencia reabierta");
  const reanalyze = useTicketAction((id) => `/tickets/${id}/reanalyze`, "POST", "Análisis actualizado");
  const applyAiPriority = useTicketAction<{ priority: TicketPriority; model_version: string }>(
    (id) => `/tickets/${id}/apply-ai-priority`,
    "POST",
    "Prioridad IA aplicada con supervisión",
  );
  const remove = useMutation({
    mutationFn: () => api(`/tickets/${t.id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tickets"] }); qc.invalidateQueries({ queryKey: ["kpis"] }); toast({ tone: "success", title: "Incidencia eliminada" }); onClose(); },
    onError: (err) => toast({ tone: "danger", title: "No se pudo eliminar", body: errorMessage(err) }),
  });
  const [noteText, setNoteText] = useState("");
  const [visible, setVisible] = useState(false);
  const [resolution, setResolution] = useState("");
  const [resolutionType, setResolutionType] = useState<ResolutionType>("SOLUCIONADO");
  const suggestedFix = t.ai?.similar_cases.find((c) => c.resolution)?.resolution;
  const ai = t.ai;

  const auditTrail = useQuery({
    queryKey: ["ticket-audit", t.id],
    queryFn: () => api<TicketAuditEvent[]>(`/tickets/${t.id}/audit`),
  });

  const history = useMemo<HistoryItem[]>(() => {
    const timelineItems: HistoryItem[] = t.timeline.map((entry, index) => ({
      key: `timeline-${index}-${entry.at}`,
      at: entry.at,
      actor: entry.actor,
      text: entry.text,
      internal: entry.internal,
      source: "timeline",
    }));
    const auditItems: HistoryItem[] = (auditTrail.data ?? []).map((entry, index) => ({
      key: `audit-${index}-${entry.at}-${entry.action}`,
      at: entry.at,
      actor: entry.actor_name || (entry.actor_type === "office" ? "Oficina" : "Sistema"),
      text: auditEventText(entry),
      internal: true,
      source: "audit",
    }));
    return [...timelineItems, ...auditItems].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }, [t.timeline, auditTrail.data]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="border-tinta bg-tinta text-white">{t.office_name}</Badge>
          <PriorityBadge priority={t.priority} />
          <StatusBadge status={t.status} />
          <CategoryBadge category={t.category} />
          <span className="text-sm text-tenue">{fmtDateTime(t.created_at)}, canal {t.channel.toLowerCase()}</span>
        </div>
        {t.description && <p className="whitespace-pre-wrap">{t.description}</p>}
        <dl className="grid grid-cols-2 gap-3 rounded-xl bg-papel p-4 text-sm sm:grid-cols-3">
          <Info label="Reporta" value={t.reporter_name} />
          <Info label="Teléfono" value={t.contact_phone} />
          <Info label="Ubicación" value={t.office_location} />
          {t.equipment && <>
            <Info label="Código patrimonial" value={t.equipment.patrimonial_code} />
            <Info label="Equipo" value={[EQUIPMENT_LABEL[t.equipment.type], t.equipment.brand, t.equipment.model].filter(Boolean).join(" ")} />
            <Info label="IP / hostname" value={[t.equipment.ip_address, t.equipment.hostname].filter(Boolean).join(" / ")} />
          </>}
        </dl>
        {t.attachments.map((a) => (
          <a key={a.id} href={a.url} target="_blank" rel="noreferrer"><img src={a.url} alt="Foto adjunta" className="max-h-80 rounded-xl border border-linea" /></a>
        ))}

        {t.status !== "RESUELTO" ? (
          <section className="flex flex-col gap-3 rounded-xl border-2 border-hecho/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold">Resolver</h3>
              {suggestedFix && !resolution && (
                <Button size="sm" variant="ghost" onClick={() => setResolution(suggestedFix)}>Usar solución del caso parecido</Button>
              )}
            </div>
            <label className="flex flex-col gap-1 text-sm font-bold">Tipo de resolución
              <Select value={resolutionType} onChange={(e) => setResolutionType(e.target.value as ResolutionType)}>
                {RESOLUTION_TYPES.map((type) => <option key={type} value={type}>{RESOLUTION_LABEL[type]}</option>)}
              </Select>
            </label>
            <Textarea rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="Qué se hizo para solucionarlo (la oficina lo verá)" />
            <Button variant="success" loading={resolve.isPending} disabled={resolution.trim().length < 5}
              onClick={() => resolve.mutate({ id: t.id, body: { notes: resolution.trim(), tipo_resolucion: resolutionType } })}>Marcar como resuelto</Button>
          </section>
        ) : (
          <section className="flex flex-col gap-2 rounded-xl bg-hecho-claro p-4">
            {t.resolution?.tipo_resolucion && <p className="text-sm"><strong>Tipo de resolución:</strong> {RESOLUTION_LABEL[t.resolution.tipo_resolucion]}</p>}
            <p><strong>Solución de {t.resolution?.resolved_by_name}:</strong> {t.resolution?.notes}</p>
            {t.resolution?.confirmed_by_user != null && <p className="text-sm font-bold">{t.resolution.confirmed_by_user ? "La oficina confirmó que funciona." : "La oficina indicó que sigue fallando."}</p>}
            <Button variant="secondary" size="sm" className="w-fit" loading={reopen.isPending} onClick={() => reopen.mutate({ id: t.id })}>Reabrir</Button>
          </section>
        )}

        <section className="flex flex-col gap-3">
          <h3 className="font-bold">Seguimiento</h3>
          <div className="flex flex-col gap-2">
            <Textarea rows={2} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Agregar nota" />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-casma" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> Visible para la oficina</label>
              <Button size="sm" loading={note.isPending} disabled={noteText.trim().length < 2}
                onClick={() => note.mutate({ id: t.id, body: { text: noteText.trim(), visible_to_office: visible } }, { onSuccess: () => setNoteText("") })}>Agregar nota</Button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <History className="size-5 text-casma" aria-hidden />
            <h3 className="font-bold">Historial del ticket</h3>
            {auditTrail.isLoading && <span className="text-xs text-tenue">Cargando auditoría…</span>}
          </div>
          {auditTrail.error && <p className="text-xs text-alerta">No se pudo cargar la auditoría; se muestra el seguimiento del ticket.</p>}
          <ol className="relative ml-2 flex flex-col gap-0 border-l-2 border-linea pl-6">
            {history.map((item) => (
              <li key={item.key} className="relative pb-5 last:pb-0">
                <span
                  className={cx(
                    "absolute -left-[31px] top-1.5 size-3 rounded-full border-2 border-white",
                    item.source === "audit" ? "bg-casma" : item.internal ? "bg-sol" : "bg-hecho",
                  )}
                  aria-hidden
                />
                <div className={cx("rounded-xl border p-3", item.source === "audit" ? "border-casma/20 bg-casma-claro/40" : "border-linea bg-white")}>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-tenue">
                    <span>{fmtDateTime(item.at)}</span>
                    <span>•</span>
                    <span className="font-bold text-tinta">{item.actor}</span>
                    {item.source === "audit" ? (
                      <Badge className="border-casma/30 bg-white text-casma"><ShieldCheck className="mr-1 size-3" /> Auditoría</Badge>
                    ) : item.internal ? (
                      <Badge className="border-linea bg-papel text-tenue">Interno</Badge>
                    ) : null}
                  </div>
                  <p className={cx("mt-1 text-sm", item.internal && item.source !== "audit" && "text-tenue")}>{item.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <aside className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 rounded-xl border border-linea p-4">
          <label className="flex flex-col gap-1 text-sm font-bold">Técnico
            <Select value={t.assigned_to_id ?? ""} disabled={assign.isPending || t.status === "RESUELTO"} onChange={(e) => assign.mutate({ id: t.id, body: { technician_id: e.target.value || null } })}>
              <option value="">Sin asignar</option>
              {techs.data?.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.id === ai?.suggested_technician_id ? "★ " : ""}{s.full_name} ({s.open_tickets})</option>)}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-bold">Categoría
            <Select value={t.category} onChange={(e) => patch.mutate({ id: t.id, body: { category: e.target.value as TicketCategory } })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-bold">Prioridad
            <Select value={t.priority} onChange={(e) => patch.mutate({ id: t.id, body: { priority: e.target.value as TicketPriority } })}>
              {(["BAJA", "MEDIA", "ALTA"] as TicketPriority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </Select>
          </label>
          <p className="text-xs text-tenue">Corregir la categoría o prioridad enseña a la IA.</p>
        </div>

        {ai && (
          <div className="flex flex-col gap-3 rounded-xl bg-tinta p-4 text-white">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-bold"><BrainCircuit className="size-5 text-sol" /> Asistente IA</h3>
              <button onClick={() => reanalyze.mutate({ id: t.id })} className="rounded p-1 text-white/70 hover:bg-white/10" aria-label="Volver a analizar">
                <RefreshCw className={cx("size-4", reanalyze.isPending && "animate-spin")} />
              </button>
            </div>
            <p className="text-sm">{ai.briefing}</p>
            <AiBlock title={`Categoría sugerida: ${CATEGORY_LABEL[ai.category]} (${pct(ai.category_confidence)})`} />
            <AiBlock title={`Prioridad sugerida: ${PRIORITY_LABEL[ai.priority]} · puntaje ${pct(ai.priority_score)}`} items={ai.priority_reasons} />
            {ai.priority !== t.priority ? (
              <div className="rounded-xl border border-sol/40 bg-white/10 p-3">
                <p className="text-sm font-bold text-sol">La IA discrepa de la prioridad actual</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  <span>Actual:</span>
                  <span className="rounded bg-white/10 px-2 py-1 font-bold">{PRIORITY_LABEL[t.priority]}</span>
                  <span>→ IA:</span>
                  <span className="rounded bg-sol/20 px-2 py-1 font-bold text-sol">{PRIORITY_LABEL[ai.priority]}</span>
                </div>
                <p className="mt-2 text-xs text-white/65">
                  La IA no cambia la prioridad automáticamente. Al aceptar, su decisión quedará registrada a nombre del técnico.
                </p>
                <Button
                  className="mt-3 w-full"
                  variant="secondary"
                  loading={applyAiPriority.isPending}
                  onClick={() => applyAiPriority.mutate({
                    id: t.id,
                    body: { priority: ai.priority, model_version: ai.model_version },
                  })}
                >
                  <ShieldCheck className="size-4" /> Aplicar recomendación IA
                </Button>
              </div>
            ) : (
              <div className="rounded-lg border border-hecho/30 bg-white/10 p-2 text-xs text-white/75">
                La prioridad actual coincide con la recomendación de IA.
              </div>
            )}
            {ai.suggested_technician_name && <AiBlock title={`Técnico sugerido: ${ai.suggested_technician_name}`} items={ai.technician_reasons} />}
            {ai.equipment_risk != null && (
              <div className="flex flex-col gap-1">
                <p className="text-sm font-bold">Riesgo de nueva falla (30 días): {pct(ai.equipment_risk)}</p>
                <div className="h-2 overflow-hidden rounded-full bg-white/15"><div className={cx("h-full", ai.equipment_risk > 0.6 ? "bg-alerta" : ai.equipment_risk > 0.35 ? "bg-sol" : "bg-hecho")} style={{ width: pct(ai.equipment_risk) }} /></div>
                {ai.equipment_risk_factors.length > 0 && <ul className="list-disc pl-5 text-xs text-white/75">{ai.equipment_risk_factors.map((f) => <li key={f}>{f}</li>)}</ul>}
              </div>
            )}
            {(ai.historical_patterns.length > 0 || ai.historical_recommendations.length > 0) && (
              <div className="flex flex-col gap-2 rounded-xl border border-sol/30 bg-white/10 p-3">
                <p className="text-sm font-bold text-sol">Contexto histórico del equipo</p>
                {ai.historical_patterns.length > 0 && (
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-white/60">Patrones detectados</p>
                    <ul className="mt-1 list-disc pl-5 text-xs text-white/85">
                      {ai.historical_patterns.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </div>
                )}
                {ai.historical_evidence.length > 0 && (
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-white/60">Evidencia</p>
                    <ul className="mt-1 list-disc pl-5 text-xs text-white/75">
                      {ai.historical_evidence.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </div>
                )}
                {ai.historical_recommendations.length > 0 && (
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-white/60">Recomendación inicial</p>
                    <ol className="mt-1 list-decimal pl-5 text-xs text-sol">
                      {ai.historical_recommendations.map((item) => <li key={item}>{item}</li>)}
                    </ol>
                  </div>
                )}
              </div>
            )}
            {ai.similar_cases.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-bold">Casos parecidos resueltos</p>
                {ai.similar_cases.map((c) => (
                  <div key={c.ticket_id} className="rounded-lg bg-white/10 p-2 text-xs">
                    <p className="font-bold">{c.number} ({pct(c.score)} similar)</p>
                    <p className="text-white/80">{c.subject}</p>
                    {c.resolution && <p className="mt-1 text-sol">Solución: {c.resolution}</p>}
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-white/50">Modelo {ai.model_version}</p>
          </div>
        )}
        {isAdmin && (
          <Button variant="danger" size="sm" loading={remove.isPending} onClick={() => confirm(`¿Eliminar la incidencia ${t.number}? Quedará registrado en la auditoría.`) && remove.mutate()}>
            <Trash className="size-4" /> Eliminar incidencia
          </Button>
        )}
      </aside>
    </div>
  );
}

const AUDIT_ACTION_LABEL: Record<string, string> = {
  "ticket.created": "Ticket registrado",
  "ticket.viewed": "Ticket abierto por el técnico",
  "ticket.classification_updated": "Clasificación actualizada",
  "ticket.ai_priority_applied": "Recomendación de prioridad IA aceptada",
  "ticket.assigned": "Asignación de técnico actualizada",
  "ticket.note_added": "Nota registrada",
  "ticket.resolved": "Ticket resuelto",
  "ticket.reopened": "Ticket reabierto",
  "ticket.reanalysis_requested": "Reanálisis de IA solicitado",
  "ticket.deleted": "Ticket eliminado",
};

function auditEventText(event: TicketAuditEvent): string {
  const base = AUDIT_ACTION_LABEL[event.action] ?? event.action.replace(/^ticket\./, "").replaceAll("_", " ");
  if (event.action === "ticket.assigned") {
    const name = typeof event.details.technician_name === "string" ? event.details.technician_name : null;
    return name ? `${base}: ${name}.` : `${base}: sin técnico asignado.`;
  }
  if (event.action === "ticket.ai_priority_applied") {
    const previous = typeof event.details.previous_priority === "string" ? event.details.previous_priority : null;
    const applied = typeof event.details.applied_priority === "string" ? event.details.applied_priority : null;
    const score = typeof event.details.ai_score === "number" ? Math.round(event.details.ai_score * 100) : null;
    if (previous && applied) {
      return `El técnico aceptó la recomendación IA: ${previous} → ${applied}${score != null ? ` (puntaje ${score}%)` : ""}.`;
    }
    return "El técnico aceptó la recomendación de prioridad propuesta por la IA.";
  }
  if (event.action === "ticket.classification_updated") {
    const category = typeof event.details.category === "string" ? event.details.category : null;
    const priority = typeof event.details.priority === "string" ? event.details.priority : null;
    const changes = [category && `categoría ${category}`, priority && `prioridad ${priority}`].filter(Boolean).join(", ");
    return changes ? `${base}: ${changes}.` : base;
  }
  if (event.action === "ticket.note_added") {
    return event.details.visible_to_office ? "Se registró una nota visible para la oficina." : "Se registró una nota interna.";
  }
  if (event.action === "ticket.resolved" && typeof event.details.resolution_type === "string") {
    return `${base}: ${event.details.resolution_type.replaceAll("_", " ").toLowerCase()}.`;
  }
  return base;
}

const Info = ({ label, value }: { label: string; value?: string | null }) => (
  <div className="min-w-0"><dt className="text-tenue">{label}</dt><dd className="truncate font-bold">{value || "–"}</dd></div>
);

const AiBlock = ({ title, items }: { title: string; items?: string[] }) => (
  <div>
    <p className="text-sm font-bold">{title}</p>
    {items && items.length > 0 && <ul className="list-disc pl-5 text-xs text-white/75">{items.map((r) => <li key={r}>{r}</li>)}</ul>}
  </div>
);
