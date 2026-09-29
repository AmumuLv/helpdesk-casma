import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BrainCircuit,
  Building2,
  ChevronDown,
  Clock3,
  History,
  MapPin,
  MessageCircle,
  PauseCircle,
  Phone,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  Trash,
  UserRound,
  Wrench,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useToast } from "../../components/Toasts";
import { Badge, Button, CategoryBadge, cx, ErrorBox, Modal, PriorityBadge, Select, Spinner, StatusBadge, Textarea } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { CATEGORIES, CATEGORY_LABEL, EQUIPMENT_LABEL, fmtDateTime, pct, PRIORITY_LABEL } from "../../lib/labels";
import type { ResolutionType, Ticket, TicketCategory, TicketPriority, WaitReason } from "../../lib/types";
import { StaffTicketConversation } from "../shared/TicketConversation";
import { useIsAdmin, useTechnicians, useTicketAction } from "./hooks";

const RESOLUTION_LABEL: Record<ResolutionType, string> = {
  SOLUCIONADO: "Solucionado",
  REPARADO: "Reparado",
  REQUIERE_REPUESTO: "Requiere compra de repuesto",
  REEMPLAZADO: "Reemplazado",
  OBSOLETO: "Obsoleto",
  IRREPARABLE: "Irreparable",
  BAJA_PATRIMONIAL: "Baja patrimonial",
  DERIVADO: "Derivado",
};
const RESOLUTION_TYPES = Object.keys(RESOLUTION_LABEL) as ResolutionType[];

const WAIT_LABEL: Record<WaitReason, string> = {
  REPUESTO: "Espera de repuesto",
  PROVEEDOR: "Espera de proveedor",
  AUTORIZACION: "Espera de autorización",
  USUARIO: "Espera de respuesta del usuario",
  DIAGNOSTICO_COMPLEJO: "Diagnóstico complejo",
  DEPENDENCIA_EXTERNA: "Dependencia externa",
  OTRO: "Otro motivo justificado",
};
const WAIT_REASONS = Object.keys(WAIT_LABEL) as WaitReason[];

const PRIORITY_SOURCE_LABEL: Record<string, string> = {
  LOCAL: "Triaje local",
  TECNICO: "Técnico",
  IA: "IA",
  IA_SUPERVISADA: "IA supervisada",
};

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
  const note = useTicketAction<{ text: string; visible_to_office: boolean }>((id) => `/tickets/${id}/notes`, "POST", "Nota interna guardada");
  const wait = useTicketAction<{ reason: WaitReason; note?: string }>((id) => `/tickets/${id}/wait`, "POST", "Incidencia puesta en espera");
  const resume = useTicketAction<{ note?: string }>((id) => `/tickets/${id}/resume`, "POST", "Atención reanudada");
  const resolve = useTicketAction<{ notes: string; tipo_resolucion: ResolutionType }>((id) => `/tickets/${id}/resolve`, "POST", "Incidencia cerrada");
  const reopen = useTicketAction((id) => `/tickets/${id}/reopen`, "POST", "Incidencia reabierta");
  const reanalyze = useTicketAction((id) => `/tickets/${id}/reanalyze`, "POST", "Análisis actualizado");
  const applyAiPriority = useTicketAction<{ priority: TicketPriority; model_version: string }>(
    (id) => `/tickets/${id}/apply-ai-priority`,
    "POST",
    "Prioridad IA aplicada con supervisión",
  );
  const remove = useMutation({
    mutationFn: () => api(`/tickets/${t.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tickets"] });
      qc.invalidateQueries({ queryKey: ["workboard"] });
      qc.invalidateQueries({ queryKey: ["kpis"] });
      qc.invalidateQueries({ queryKey: ["follow-up-metrics"] });
      toast({ tone: "success", title: "Incidencia eliminada" });
      onClose();
    },
    onError: (err) => toast({ tone: "danger", title: "No se pudo eliminar", body: errorMessage(err) }),
  });

  const [noteText, setNoteText] = useState("");
  const [resolution, setResolution] = useState("");
  const [resolutionType, setResolutionType] = useState<ResolutionType>("SOLUCIONADO");
  const [waitReason, setWaitReason] = useState<WaitReason>("REPUESTO");
  const [waitNote, setWaitNote] = useState("");
  const [resumeNote, setResumeNote] = useState("");
  const suggestedFix = t.ai?.similar_cases.find((c) => c.resolution)?.resolution;
  const ai = t.ai;
  const assistedReport = t.channel === "TELEFONO";

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

  const canClose = resolution.trim().length >= 5;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <section className="rounded-3xl border border-linea bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border-tinta bg-tinta text-white">{t.office_name}</Badge>
            <PriorityBadge priority={t.priority} />
            <StatusBadge status={t.status} />
            <CategoryBadge category={t.category} />
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-[0.1em] text-tenue">Resumen de la incidencia</p>
            <p className="mt-2 whitespace-pre-wrap text-base leading-7 text-tinta">{t.description || "Sin descripción adicional."}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard icon={<UserRound className="size-5" />} label="Reportante" value={t.reporter_name || "No identificado"} helper={assistedReport ? "Contacto registrado por soporte" : "Reportado desde la oficina"} />
            <SummaryCard icon={<Building2 className="size-5" />} label="Oficina" value={t.office_name} helper={t.office_location || "Ubicación no registrada"} />
            <SummaryCard icon={<Wrench className="size-5" />} label="Técnico responsable" value={t.assigned_to_name || "Sin asignar"} helper={t.follow_up.label} />
            <SummaryCard icon={<MessageCircle className="size-5" />} label="Comunicación" value={`Portal de ${t.office_name}`} helper={assistedReport ? "El teléfono del reportante no recibe este chat" : "Conversación disponible dentro del reporte"} />
          </div>

          {assistedReport && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
              <strong>Reporte asistido por soporte.</strong> El nombre y teléfono identifican al reportante, pero la conversación del sistema pertenece al portal de la oficina. Una persona sin acceso a ese portal no recibe los mensajes únicamente por haber dejado su número telefónico.
            </div>
          )}
        </div>
      </section>

      <Accordion title="Conversación con la oficina" subtitle="Mensajes y respuesta del caso" icon={<MessageCircle className="size-5" />} defaultOpen>
        <StaffTicketConversation ticket={t} embedded />
      </Accordion>

      <Accordion title="Datos completos del reporte" subtitle="Solicitante, ubicación, equipo y archivos" icon={<UserRound className="size-5" />}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <InfoCard label="Reportante" value={t.reporter_name} />
          <InfoCard label="Teléfono" value={t.contact_phone} icon={<Phone className="size-4" />} />
          <InfoCard label="Oficina" value={t.office_name} icon={<Building2 className="size-4" />} />
          <InfoCard label="Ubicación" value={t.office_location} icon={<MapPin className="size-4" />} />
          <InfoCard label="Canal de registro" value={t.channel.toLowerCase()} />
          <InfoCard label="Registrada" value={fmtDateTime(t.created_at)} />
          {t.equipment && <>
            <InfoCard label="Código patrimonial" value={t.equipment.patrimonial_code} />
            <InfoCard label="Equipo" value={[EQUIPMENT_LABEL[t.equipment.type], t.equipment.brand, t.equipment.model].filter(Boolean).join(" ")} />
            <InfoCard label="IP / hostname" value={[t.equipment.ip_address, t.equipment.hostname].filter(Boolean).join(" / ")} />
          </>}
        </div>
        {t.attachments.length > 0 && (
          <div className="mt-5 border-t border-linea pt-5">
            <p className="mb-3 text-sm font-bold text-tinta">Adjuntos originales</p>
            <div className="flex flex-wrap gap-3">
              {t.attachments.map((a) => (
                <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-xl border border-linea bg-papel/40 p-2">
                  <img src={a.url} alt="Foto adjunta" className="max-h-64 rounded-lg object-contain" />
                </a>
              ))}
            </div>
          </div>
        )}
      </Accordion>

      <Accordion title="Gestión técnica" subtitle="Responsable, categoría y prioridad" icon={<Wrench className="size-5" />}>
        <div className="grid gap-4 md:grid-cols-3">
          <label className="flex flex-col gap-1.5 text-sm font-bold">Técnico
            <Select value={t.assigned_to_id ?? ""} disabled={assign.isPending || t.status === "RESUELTO" || !!t.assigned_to_id} onChange={(e) => assign.mutate({ id: t.id, body: { technician_id: e.target.value || null } })}>
              <option value="">Sin asignar</option>
              {techs.data?.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.id === ai?.suggested_technician_id ? "★ " : ""}{s.full_name} ({s.open_tickets})</option>)}
            </Select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-bold">Categoría
            <Select value={t.category} onChange={(e) => patch.mutate({ id: t.id, body: { category: e.target.value as TicketCategory } })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </Select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-bold">Prioridad
            <Select value={t.priority} onChange={(e) => patch.mutate({ id: t.id, body: { priority: e.target.value as TicketPriority } })}>
              {(["BAJA", "MEDIA", "ALTA"] as TicketPriority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </Select>
          </label>
        </div>
        <div className="mt-4 rounded-xl bg-papel/45 p-3 text-xs leading-5 text-tenue">
          <p>Origen de prioridad: <strong className="text-tinta">{PRIORITY_SOURCE_LABEL[t.priority_source] ?? t.priority_source}</strong>.</p>
          {t.assigned_to_id && <p className="mt-1">Para reasignar a otro técnico usa el bloque de responsable dentro de la conversación; allí se registra el motivo y se conserva el contexto.</p>}
        </div>
      </Accordion>

      {t.status !== "RESUELTO" && (
        <Accordion title="Seguimiento de atención" subtitle={t.follow_up.label} icon={t.follow_up.state === "EN_ESPERA" ? <PauseCircle className="size-5" /> : <Clock3 className="size-5" />}>
          <div className={cx("rounded-2xl border p-4", t.follow_up.state === "EN_ESPERA" ? "border-violet-200 bg-violet-50/65" : "border-sky-100 bg-sky-50/55")}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-bold text-tinta">{t.follow_up.label}</h3>
                <p className="mt-1 text-sm leading-6 text-tenue">{t.follow_up.detail}</p>
              </div>
              <span className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-tenue shadow-sm">Última actividad: {fmtDateTime(t.follow_up.last_activity_at)}</span>
            </div>

            {t.follow_up.ai_summary && (
              <div className="mt-4 rounded-xl border border-casma/15 bg-white p-4">
                <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-casma-oscuro"><BrainCircuit className="size-4" /> IA de seguimiento</p>
                <p className="mt-2 text-sm leading-6 text-tinta">{t.follow_up.ai_summary}</p>
                {t.follow_up.ai_recommendation && <p className="mt-2 text-sm text-tenue"><strong className="text-tinta">Recomendación:</strong> {t.follow_up.ai_recommendation}</p>}
              </div>
            )}

            {t.follow_up.state === "EN_ESPERA" ? (
              <div className="mt-4 grid gap-3">
                <div className="rounded-xl border border-violet-200 bg-white p-3 text-sm">
                  <p className="text-xs font-bold uppercase tracking-[0.08em] text-violet-700">Motivo registrado</p>
                  <p className="mt-1 font-bold text-tinta">{t.follow_up.wait_reason_label}</p>
                  {t.follow_up.wait_note && <p className="mt-1 text-tenue">{t.follow_up.wait_note}</p>}
                </div>
                <Textarea rows={2} value={resumeNote} onChange={(e) => setResumeNote(e.target.value)} placeholder="Nota opcional al reanudar" />
                <Button variant="secondary" loading={resume.isPending} onClick={() => resume.mutate({ id: t.id, body: { note: resumeNote.trim() || undefined } }, { onSuccess: () => setResumeNote("") })}>
                  <PlayCircle className="size-4" /> Reanudar atención
                </Button>
              </div>
            ) : (
              <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1.5fr_auto] md:items-end">
                <label className="flex flex-col gap-1 text-sm font-bold">Motivo de espera
                  <Select value={waitReason} onChange={(e) => setWaitReason(e.target.value as WaitReason)}>
                    {WAIT_REASONS.map((reason) => <option key={reason} value={reason}>{WAIT_LABEL[reason]}</option>)}
                  </Select>
                </label>
                <label className="flex flex-col gap-1 text-sm font-bold">Contexto opcional
                  <Textarea rows={2} value={waitNote} onChange={(e) => setWaitNote(e.target.value)} placeholder="Ejemplo: repuesto solicitado al almacén" />
                </label>
                <Button variant="secondary" disabled={!t.assigned_to_id} loading={wait.isPending} onClick={() => wait.mutate({ id: t.id, body: { reason: waitReason, note: waitNote.trim() || undefined } }, { onSuccess: () => setWaitNote("") })}>
                  <PauseCircle className="size-4" /> Marcar en espera
                </Button>
              </div>
            )}
          </div>
        </Accordion>
      )}

      {ai && (
        <Accordion title="Asistente IA" subtitle={`${CATEGORY_LABEL[ai.category]} · ${pct(ai.category_confidence)} de confianza`} icon={<BrainCircuit className="size-5" />}>
          <div className="rounded-2xl bg-tinta p-5 text-white">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-sol">Resumen del análisis</p>
                <p className="mt-2 text-sm leading-6">{ai.briefing}</p>
              </div>
              <button onClick={() => reanalyze.mutate({ id: t.id })} className="rounded-lg p-2 text-white/70 hover:bg-white/10" aria-label="Volver a analizar">
                <RefreshCw className={cx("size-4", reanalyze.isPending && "animate-spin")} />
              </button>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <AiBlock title={`Categoría sugerida: ${CATEGORY_LABEL[ai.category]} (${pct(ai.category_confidence)})`} />
              <AiBlock title={`Prioridad sugerida: ${PRIORITY_LABEL[ai.priority]} · ${pct(ai.priority_score)}`} items={ai.priority_reasons} />
              {ai.suggested_technician_name && <AiBlock title={`Técnico sugerido: ${ai.suggested_technician_name}`} items={ai.technician_reasons} />}
              {ai.equipment_risk != null && <AiBlock title={`Riesgo de nueva falla: ${pct(ai.equipment_risk)}`} items={ai.equipment_risk_factors} />}
            </div>
            {ai.priority !== t.priority && (
              <div className="mt-4 rounded-xl border border-sol/40 bg-white/10 p-4">
                <p className="text-sm font-bold text-sol">La IA propone una prioridad diferente</p>
                <p className="mt-1 text-xs text-white/70">Actual: {PRIORITY_LABEL[t.priority]} · Sugerida: {PRIORITY_LABEL[ai.priority]}. La decisión final sigue siendo del personal TI.</p>
                <Button className="mt-3" variant="secondary" loading={applyAiPriority.isPending} onClick={() => applyAiPriority.mutate({ id: t.id, body: { priority: ai.priority, model_version: ai.model_version } })}>
                  <ShieldCheck className="size-4" /> Aplicar recomendación IA
                </Button>
              </div>
            )}
            {ai.similar_cases.length > 0 && (
              <div className="mt-4 border-t border-white/15 pt-4">
                <p className="text-sm font-bold">Casos parecidos resueltos</p>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  {ai.similar_cases.map((c) => (
                    <div key={c.ticket_id} className="rounded-xl bg-white/10 p-3 text-xs">
                      <p className="font-bold">{c.number} · {pct(c.score)} similar</p>
                      <p className="mt-1 text-white/80">{c.subject}</p>
                      {c.resolution && <p className="mt-2 text-sol">Solución: {c.resolution}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Accordion>
      )}

      <Accordion title={t.status === "RESUELTO" ? "Resultado y reapertura" : "Cerrar incidencia"} subtitle={t.status === "RESUELTO" ? "Solución registrada" : "Finaliza el caso cuando el problema esté atendido"} icon={<ShieldCheck className="size-5" />}>
        {t.status !== "RESUELTO" ? (
          <div className="grid gap-4">
            <label className="flex flex-col gap-1.5 text-sm font-bold">Resultado de la atención
              <Select value={resolutionType} onChange={(e) => setResolutionType(e.target.value as ResolutionType)}>
                {RESOLUTION_TYPES.map((type) => <option key={type} value={type}>{RESOLUTION_LABEL[type]}</option>)}
              </Select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-bold">Solución aplicada
              <Textarea rows={4} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="Describe qué se hizo y cómo quedó el equipo o servicio." />
            </label>
            {suggestedFix && !resolution && <Button size="sm" variant="ghost" className="w-fit" onClick={() => setResolution(suggestedFix)}>Usar solución de un caso parecido</Button>}
            <Button variant="success" loading={resolve.isPending} disabled={!canClose} onClick={() => resolve.mutate({ id: t.id, body: { notes: resolution.trim(), tipo_resolucion: resolutionType } })}>Cerrar incidencia</Button>
          </div>
        ) : (
          <div className="rounded-2xl border border-hecho/30 bg-hecho-claro p-4">
            {t.resolution?.tipo_resolucion && <p className="text-sm"><strong>Resultado:</strong> {RESOLUTION_LABEL[t.resolution.tipo_resolucion]}</p>}
            <p className="mt-2 leading-6"><strong>Solución de {t.resolution?.resolved_by_name || "personal TI"}:</strong> {t.resolution?.notes || "Sin detalle de solución."}</p>
            {t.resolution?.confirmed_by_user != null && <p className="mt-2 text-sm font-bold">{t.resolution.confirmed_by_user ? "La oficina confirmó que funciona." : "La oficina indicó que sigue fallando."}</p>}
            <Button variant="secondary" size="sm" className="mt-4" loading={reopen.isPending} onClick={() => confirm(`¿Reabrir la incidencia ${t.number}?`) && reopen.mutate({ id: t.id })}>Reabrir incidencia</Button>
          </div>
        )}
      </Accordion>

      <Accordion title="Nota interna TI" subtitle="Información privada para el equipo de soporte" icon={<Wrench className="size-5" />}>
        <Textarea rows={3} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Escribe una nota interna para el equipo TI" />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-tenue">No se muestra a la oficina. Para hablar con ella usa la conversación.</p>
          <Button size="sm" loading={note.isPending} disabled={noteText.trim().length < 2} onClick={() => note.mutate({ id: t.id, body: { text: noteText.trim(), visible_to_office: false } }, { onSuccess: () => setNoteText("") })}>Guardar nota interna</Button>
        </div>
      </Accordion>

      <Accordion title="Actividad y auditoría" subtitle={`${history.length} registros del caso`} icon={<History className="size-5" />}>
        {auditTrail.error && <p className="mb-3 text-xs text-alerta">No se pudo cargar la auditoría completa.</p>}
        <ol className="relative ml-2 flex flex-col border-l-2 border-linea pl-6">
          {history.map((item) => (
            <li key={item.key} className="relative pb-5 last:pb-0">
              <span className={cx("absolute -left-[31px] top-1.5 size-3 rounded-full border-2 border-white", item.source === "audit" ? "bg-casma" : item.internal ? "bg-sol" : "bg-hecho")} aria-hidden />
              <div className={cx("rounded-xl border p-3", item.source === "audit" ? "border-casma/20 bg-casma-claro/40" : "border-linea bg-white")}>
                <div className="flex flex-wrap items-center gap-2 text-xs text-tenue">
                  <span>{fmtDateTime(item.at)}</span><span>•</span><span className="font-bold text-tinta">{item.actor}</span>
                  {item.source === "audit" ? <Badge className="border-casma/30 bg-white text-casma"><ShieldCheck className="mr-1 size-3" /> Auditoría</Badge> : item.internal ? <Badge className="border-linea bg-papel text-tenue">Interno</Badge> : null}
                </div>
                <p className={cx("mt-1 text-sm leading-6", item.internal && item.source !== "audit" && "text-tenue")}>{item.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </Accordion>

      {isAdmin && (
        <div className="flex justify-end pt-1">
          <Button variant="danger" size="sm" loading={remove.isPending} onClick={() => confirm(`¿Eliminar la incidencia ${t.number}? Quedará registrado en la auditoría.`) && remove.mutate()}>
            <Trash className="size-4" /> Eliminar incidencia
          </Button>
        </div>
      )}
    </div>
  );
}

function Accordion({ title, subtitle, icon, children, defaultOpen = false }: { title: string; subtitle?: string; icon: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="overflow-hidden rounded-2xl border border-linea bg-white shadow-sm">
      <button type="button" className="flex w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-papel/55 sm:px-5" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-casma-claro text-casma-oscuro">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold text-tinta">{title}</span>
          {subtitle && <span className="mt-0.5 block truncate text-xs text-tenue">{subtitle}</span>}
        </span>
        <ChevronDown className={cx("size-5 shrink-0 text-tenue transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="border-t border-linea p-4 sm:p-5">{children}</div>}
    </section>
  );
}

function SummaryCard({ icon, label, value, helper }: { icon: ReactNode; label: string; value: string; helper?: string }) {
  return (
    <div className="rounded-2xl border border-linea bg-papel/35 p-4">
      <div className="flex items-center gap-2 text-casma-oscuro">{icon}<p className="text-xs font-bold uppercase tracking-[0.06em]">{label}</p></div>
      <p className="mt-2 break-words font-bold text-tinta">{value}</p>
      {helper && <p className="mt-1 text-xs leading-5 text-tenue">{helper}</p>}
    </div>
  );
}

function InfoCard({ label, value, icon }: { label: string; value?: string | null; icon?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl border border-linea bg-papel/35 p-4">
      <div className="flex items-center gap-2 text-xs font-semibold text-tenue">{icon}{label}</div>
      <p className="mt-1 break-words font-bold text-tinta">{value || "–"}</p>
    </div>
  );
}

const AiBlock = ({ title, items }: { title: string; items?: string[] }) => (
  <div className="rounded-xl bg-white/10 p-3">
    <p className="text-sm font-bold">{title}</p>
    {items && items.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs leading-5 text-white/75">{items.map((r) => <li key={r}>{r}</li>)}</ul>}
  </div>
);

const AUDIT_ACTION_LABEL: Record<string, string> = {
  "ticket.created": "Ticket registrado",
  "ticket.viewed": "Ticket abierto por el técnico",
  "ticket.classification_updated": "Clasificación actualizada",
  "ticket.ai_priority_applied": "Recomendación de prioridad IA aceptada",
  "ticket.assigned": "Asignación de técnico actualizada",
  "ticket.reassigned": "Responsable reasignado",
  "ticket.note_added": "Nota registrada",
  "ticket.message.sent": "Mensaje enviado a la oficina",
  "ticket.message.office_sent": "Respuesta recibida de la oficina",
  "ticket.resolved": "Ticket resuelto",
  "ticket.reopened": "Ticket reabierto",
  "ticket.waiting": "Atención puesta en espera",
  "ticket.resumed": "Atención reanudada",
  "ticket.reanalysis_requested": "Reanálisis de IA solicitado",
  "ticket.deleted": "Ticket eliminado",
};

function auditEventText(event: TicketAuditEvent): string {
  const base = AUDIT_ACTION_LABEL[event.action] ?? event.action.replace(/^ticket\./, "").replaceAll("_", " ");
  if (event.action === "ticket.assigned" || event.action === "ticket.reassigned") {
    const name = typeof event.details.technician_name === "string" ? event.details.technician_name : null;
    const reason = typeof event.details.reason === "string" ? event.details.reason.replaceAll("_", " ").toLowerCase() : null;
    if (name && reason) return `${base}: ${name}. Motivo: ${reason}.`;
    return name ? `${base}: ${name}.` : `${base}: sin técnico asignado.`;
  }
  if (event.action === "ticket.ai_priority_applied") {
    const previous = typeof event.details.previous_priority === "string" ? event.details.previous_priority : null;
    const applied = typeof event.details.applied_priority === "string" ? event.details.applied_priority : null;
    const score = typeof event.details.ai_score === "number" ? Math.round(event.details.ai_score * 100) : null;
    if (previous && applied) return `El técnico aceptó la recomendación IA: ${previous} → ${applied}${score != null ? ` (puntaje ${score}%)` : ""}.`;
    return "El técnico aceptó la recomendación de prioridad propuesta por la IA.";
  }
  if (event.action === "ticket.classification_updated") {
    const category = typeof event.details.category === "string" ? event.details.category : null;
    const priority = typeof event.details.priority === "string" ? event.details.priority : null;
    const changes = [category && `categoría ${category}`, priority && `prioridad ${priority}`].filter(Boolean).join(", ");
    return changes ? `${base}: ${changes}.` : base;
  }
  if (event.action === "ticket.note_added") return event.details.visible_to_office ? "Se registró una nota visible para la oficina." : "Se registró una nota interna.";
  if (event.action === "ticket.resolved" && typeof event.details.resolution_type === "string") return `${base}: ${event.details.resolution_type.replaceAll("_", " ").toLowerCase()}.`;
  if (event.action === "ticket.waiting" && typeof event.details.wait_reason === "string") return `${base}: ${event.details.wait_reason.replaceAll("_", " ").toLowerCase()}.`;
  return base;
}
