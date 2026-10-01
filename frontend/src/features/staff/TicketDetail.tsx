import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  BrainCircuit,
  ChevronDown,
  Clock3,
  History,
  MessageCircle,
  PauseCircle,
  Phone,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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

type ReassignmentReason = "OTRA_ESPECIALIDAD" | "TECNICO_NO_DISPONIBLE" | "DISTRIBUCION_CARGA" | "COMPLEJIDAD" | "RESPONSABLE_TI" | "OTRO";
const REASSIGNMENT_LABEL: Record<ReassignmentReason, string> = {
  OTRA_ESPECIALIDAD: "Otra especialidad",
  TECNICO_NO_DISPONIBLE: "Técnico no disponible",
  DISTRIBUCION_CARGA: "Distribución de carga",
  COMPLEJIDAD: "Complejidad del caso",
  RESPONSABLE_TI: "Decisión del responsable TI",
  OTRO: "Otro motivo",
};

type ReassignResult = {
  assigned_to_id: string | null;
  assigned_to_name: string | null;
  handoff_summary: string | null;
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

type TicketTab = "attention" | "management" | "history";

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

  const [activeTab, setActiveTab] = useState<TicketTab>("attention");
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [resolution, setResolution] = useState("");
  const [resolutionType, setResolutionType] = useState<ResolutionType>("SOLUCIONADO");
  const [waitReason, setWaitReason] = useState<WaitReason>("REPUESTO");
  const [waitNote, setWaitNote] = useState("");
  const [resumeNote, setResumeNote] = useState("");
  const [selectedTech, setSelectedTech] = useState(t.assigned_to_id ?? "");
  const [reassignReason, setReassignReason] = useState<"" | ReassignmentReason>("");
  const [reassignNote, setReassignNote] = useState("");

  useEffect(() => setSelectedTech(t.assigned_to_id ?? ""), [t.id, t.assigned_to_id]);

  const changingExisting = !!t.assigned_to_id && selectedTech !== (t.assigned_to_id ?? "");
  const assignmentChanged = selectedTech !== (t.assigned_to_id ?? "");
  const reassign = useMutation({
    mutationFn: () => api<ReassignResult>(`/tickets/${t.id}/reassign`, {
      method: "POST",
      json: {
        technician_id: selectedTech || null,
        reason: changingExisting ? reassignReason || null : null,
        note: reassignNote.trim() || null,
      },
    }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["ticket", t.id] });
      qc.invalidateQueries({ queryKey: ["workboard"] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
      qc.invalidateQueries({ queryKey: ["ticket-audit", t.id] });
      setReassignReason("");
      setReassignNote("");
      toast({
        tone: "success",
        title: result.assigned_to_name ? "Responsable actualizado" : "Incidencia sin asignar",
        body: result.handoff_summary ? "Se guardó un resumen de transferencia en la actividad interna." : undefined,
      });
    },
    onError: (err) => toast({ tone: "danger", title: "No se pudo cambiar el responsable", body: errorMessage(err) }),
  });

  const suggestedFix = t.ai?.similar_cases.find((c) => c.resolution)?.resolution;
  const ai = t.ai;
  const assistedReport = t.channel === "TELEFONO";
  const canClose = resolution.trim().length >= 5;

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
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge className="border-tinta bg-tinta text-white">{t.office_name}</Badge>
            <StatusBadge status={t.status} />
            <PriorityBadge priority={t.priority} />
            <CategoryBadge category={t.category} />
          </div>

          <p className="whitespace-pre-wrap text-[0.92rem] leading-6 text-tinta">{t.description || "Sin descripción adicional."}</p>

          <dl className="grid gap-x-6 gap-y-3 border-t border-linea pt-3.5 sm:grid-cols-2 lg:grid-cols-4">
            <Row label="Reportante" value={t.reporter_name || "No identificado"} />
            <Row label="Teléfono" value={t.contact_phone || "—"} />
            <Row label="Responsable" value={t.assigned_to_name || "Sin asignar"} />
            <Row label="Registada" value={fmtDateTime(t.created_at)} />
          </dl>

          {assistedReport && (
            <p className="notice border-amber-200 bg-amber-50 text-amber-900">
              <Phone className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span><span className="notice-strong">Reporte registrado por soporte.</span> El chat sigue perteneciendo al portal de la oficina y no envía mensajes al número telefónico.</span>
            </p>
          )}
        </div>

        <details className="group border-t border-linea">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-[0.8rem] font-semibold text-tenue transition hover:bg-papel-2 [&::-webkit-details-marker]:hidden sm:px-5">
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
            Datos del reporte, ubicación y adjuntos
            {t.attachments.length > 0 && <Badge className="border-linea bg-papel-2 text-tenue">{t.attachments.length} adjuntos</Badge>}
          </summary>
          <div className="grid gap-x-6 gap-y-3 border-t border-linea bg-papel-2/40 px-4 py-4 sm:grid-cols-2 lg:grid-cols-3 sm:px-5">
            <Row label="Oficina" value={t.office_name} />
            <Row label="Ubicación" value={t.office_location} />
            <Row label="Canal" value={t.channel.toLowerCase()} />
            {t.equipment && <>
              <Row label="Código patrimonial" value={t.equipment.patrimonial_code} />
              <Row label="Equipo" value={[EQUIPMENT_LABEL[t.equipment.type], t.equipment.brand, t.equipment.model].filter(Boolean).join(" ")} />
              <Row label="IP / hostname" value={[t.equipment.ip_address, t.equipment.hostname].filter(Boolean).join(" / ")} />
            </>}
          </div>
          {t.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t border-linea px-4 py-4 sm:px-5">
              {t.attachments.map((a) => (
                <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-lg border border-linea bg-white p-1.5">
                  <img src={a.url} alt="Foto adjunta" className="max-h-48 rounded-md object-contain" />
                </a>
              ))}
            </div>
          )}
        </details>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="segmented" role="tablist" aria-label="Secciones de la incidencia">
          <button type="button" role="tab" aria-selected={activeTab === "attention"} onClick={() => setActiveTab("attention")}><MessageCircle className="size-3.5" aria-hidden /> Atención</button>
          <button type="button" role="tab" aria-selected={activeTab === "management"} onClick={() => setActiveTab("management")}><Wrench className="size-3.5" aria-hidden /> Gestión</button>
          <button type="button" role="tab" aria-selected={activeTab === "history"} onClick={() => setActiveTab("history")}><History className="size-3.5" aria-hidden /> Historial</button>
        </div>
        <Button variant="selected" size="sm" onClick={() => setAssistantOpen(true)}>
          <Sparkles className="size-4 text-casma" aria-hidden /> Asistente IA
        </Button>
      </div>

      {activeTab === "attention" && (
        <div className="flex flex-col gap-4">
          <section className="panel overflow-hidden">
            <div className="panel-head"><div><p className="eyebrow">Atención</p><h3 className="mt-1 text-[0.95rem] font-bold text-tinta">Conversación con la oficina</h3></div></div>
            <StaffTicketConversation ticket={t} embedded />
          </section>

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="panel p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="eyebrow">Estado de atención</p>
                  <h3 className="mt-1 flex items-center gap-2 text-[0.95rem] font-bold text-tinta">
                    {t.follow_up.state === "EN_ESPERA" ? <PauseCircle className="size-4 text-violet-700" aria-hidden /> : <Clock3 className="size-4 text-sky-700" aria-hidden />}
                    {t.status === "RESUELTO" ? "Atención finalizada" : t.follow_up.label}
                  </h3>
                  <p className="mt-1 text-[0.8rem] leading-5 text-tenue">{t.follow_up.detail}</p>
                </div>
                <span className="shrink-0 rounded-md bg-papel-2 px-2 py-1 text-[0.72rem] font-medium text-tenue">Última actividad: {fmtDateTime(t.follow_up.last_activity_at)}</span>
              </div>

              {t.status !== "RESUELTO" && (
                t.follow_up.state === "EN_ESPERA" ? (
                  <div className="mt-4 flex flex-col gap-3">
                    <div className="rounded-lg border border-violet-200 bg-violet-50 p-3">
                      <p className="text-[0.68rem] font-bold uppercase tracking-[0.07em] text-violet-700">Motivo de espera</p>
                      <p className="mt-1 text-[0.85rem] font-bold text-tinta">{t.follow_up.wait_reason_label}</p>
                      {t.follow_up.wait_note && <p className="mt-1 text-[0.8rem] text-tenue">{t.follow_up.wait_note}</p>}
                    </div>
                    <Textarea rows={2} value={resumeNote} onChange={(e) => setResumeNote(e.target.value)} placeholder="Nota opcional al reanudar" />
                    <Button variant="secondary" className="w-fit" loading={resume.isPending} onClick={() => resume.mutate({ id: t.id, body: { note: resumeNote.trim() || undefined } }, { onSuccess: () => setResumeNote("") })}>
                      <PlayCircle className="size-4" /> Reanudar atención
                    </Button>
                  </div>
                ) : (
                  <div className="mt-4 flex flex-col gap-3">
                    <label className="flex flex-col gap-1.5"><span className="label">Poner en espera por</span>
                      <Select value={waitReason} onChange={(e) => setWaitReason(e.target.value as WaitReason)}>
                        {WAIT_REASONS.map((reason) => <option key={reason} value={reason}>{WAIT_LABEL[reason]}</option>)}
                      </Select>
                    </label>
                    <Textarea rows={2} value={waitNote} onChange={(e) => setWaitNote(e.target.value)} placeholder="Contexto opcional, por ejemplo: repuesto solicitado al almacén" />
                    <Button variant="secondary" className="w-fit" disabled={!t.assigned_to_id} loading={wait.isPending} onClick={() => wait.mutate({ id: t.id, body: { reason: waitReason, note: waitNote.trim() || undefined } }, { onSuccess: () => setWaitNote("") })}>
                      <PauseCircle className="size-4" /> Marcar en espera
                    </Button>
                  </div>
                )
              )}
            </section>

            <section className="panel p-4 sm:p-5">
              {t.status !== "RESUELTO" ? (
                <div className="flex flex-col gap-3.5">
                  <div>
                    <p className="eyebrow">Finalizar atención</p>
                    <h3 className="mt-1 text-[0.95rem] font-bold text-tinta">Cerrar incidencia</h3>
                    <p className="mt-1 text-[0.8rem] leading-5 text-tenue">Registra la solución aplicada para conservarla en el historial.</p>
                  </div>
                  <label className="flex flex-col gap-1.5"><span className="label">Resultado</span>
                    <Select value={resolutionType} onChange={(e) => setResolutionType(e.target.value as ResolutionType)}>
                      {RESOLUTION_TYPES.map((type) => <option key={type} value={type}>{RESOLUTION_LABEL[type]}</option>)}
                    </Select>
                  </label>
                  <Textarea rows={4} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="Describe brevemente qué se hizo y cómo quedó el servicio." />
                  {suggestedFix && !resolution && <Button size="sm" variant="ghost" className="w-fit" onClick={() => setResolution(suggestedFix)}>Usar solución de un caso parecido</Button>}
                  <Button variant="primary" className="w-fit" loading={resolve.isPending} disabled={!canClose} onClick={() => resolve.mutate({ id: t.id, body: { notes: resolution.trim(), tipo_resolucion: resolutionType } })}>
                    Cerrar incidencia
                  </Button>
                </div>
              ) : (
                <div>
                  <p className="eyebrow">Incidencia cerrada</p>
                  <h3 className="mt-1 text-[0.95rem] font-bold text-tinta">Solución registrada</h3>
                  {t.resolution?.tipo_resolucion && <p className="mt-3 text-[0.85rem]"><strong>Resultado:</strong> {RESOLUTION_LABEL[t.resolution.tipo_resolucion]}</p>}
                  <p className="mt-1 text-[0.85rem] leading-6 text-tenue">{t.resolution?.notes || "Sin detalle de solución."}</p>
                  <Button variant="secondary" size="sm" className="mt-4" loading={reopen.isPending} onClick={() => confirm(`¿Reabrir la incidencia ${t.number}?`) && reopen.mutate({ id: t.id })}>Reabrir incidencia</Button>
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {activeTab === "management" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="panel p-4 sm:p-5">
            <p className="eyebrow">Responsable</p>
            <h3 className="mt-1 text-[0.95rem] font-bold text-tinta">Asignación y transferencia</h3>
            <p className="mt-1 text-[0.8rem] leading-5 text-tenue">Cambia el técnico cuando exista una razón operativa. El historial conserva la transferencia.</p>
            <div className="mt-4 flex flex-col gap-3">
              <Select value={selectedTech} disabled={t.status === "RESUELTO" || reassign.isPending} onChange={(e) => setSelectedTech(e.target.value)} aria-label="Técnico responsable">
                <option value="">Sin asignar</option>
                {techs.data?.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.id === ai?.suggested_technician_id ? "★ " : ""}{s.full_name} ({s.open_tickets} activas)</option>)}
              </Select>
              {changingExisting && (
                <div className="grid gap-3 rounded-lg border border-amber-200 bg-amber-50/70 p-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1.5"><span className="label">Motivo de reasignación</span>
                    <Select value={reassignReason} onChange={(e) => setReassignReason(e.target.value as ReassignmentReason)}>
                      <option value="">Seleccionar motivo…</option>
                      {(Object.keys(REASSIGNMENT_LABEL) as ReassignmentReason[]).map((reason) => <option key={reason} value={reason}>{REASSIGNMENT_LABEL[reason]}</option>)}
                    </Select>
                  </label>
                  <label className="flex flex-col gap-1.5"><span className="label">Contexto opcional</span>
                    <Textarea rows={2} value={reassignNote} onChange={(e) => setReassignNote(e.target.value)} placeholder="Ejemplo: requiere experiencia en redes" />
                  </label>
                </div>
              )}
              <Button variant="primary" className="w-fit" disabled={!assignmentChanged || (changingExisting && !reassignReason)} loading={reassign.isPending} onClick={() => reassign.mutate()}>
                <ArrowRightLeft className="size-4" /> {t.assigned_to_id ? "Actualizar responsable" : "Asignar responsable"}
              </Button>
            </div>
          </section>

          <section className="panel p-4 sm:p-5">
            <p className="eyebrow">Clasificación</p>
            <h3 className="mt-1 text-[0.95rem] font-bold text-tinta">Categoría y prioridad</h3>
            <div className="mt-4 flex flex-col gap-3.5">
              <label className="flex flex-col gap-1.5"><span className="label">Categoría</span>
                <Select value={t.category} onChange={(e) => patch.mutate({ id: t.id, body: { category: e.target.value as TicketCategory } })}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                </Select>
              </label>
              <label className="flex flex-col gap-1.5"><span className="label">Prioridad</span>
                <Select value={t.priority} onChange={(e) => patch.mutate({ id: t.id, body: { priority: e.target.value as TicketPriority } })}>
                  {(["BAJA", "MEDIA", "ALTA"] as TicketPriority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
                </Select>
              </label>
              <p className="notice"><Sparkles className="mt-0.5 size-4 shrink-0 text-casma" aria-hidden /><span>Origen de la prioridad: <span className="notice-strong">{PRIORITY_SOURCE_LABEL[t.priority_source] ?? t.priority_source}</span>. Cada corrección entrena las recomendaciones de IA.</span></p>
            </div>
          </section>

          <section className="panel p-4 sm:p-5 lg:col-span-2">
            <p className="eyebrow">Equipo TI</p>
            <h3 className="mt-1 text-[0.95rem] font-bold text-tinta">Nota interna</h3>
            <p className="mt-1 text-[0.8rem] text-tenue">Información privada para el personal de soporte; no se muestra a la oficina.</p>
            <Textarea className="mt-3.5" rows={3} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Escribe una nota interna para el equipo TI" />
            <div className="mt-3 flex justify-end">
              <Button size="sm" variant="primary" loading={note.isPending} disabled={noteText.trim().length < 2} onClick={() => note.mutate({ id: t.id, body: { text: noteText.trim(), visible_to_office: false } }, { onSuccess: () => setNoteText("") })}>Guardar nota interna</Button>
            </div>
          </section>

          {isAdmin && (
            <section className="rounded-xl border border-alerta/20 bg-alerta-claro/50 p-4 lg:col-span-2">
              <p className="text-[0.85rem] font-bold text-alerta">Zona administrativa</p>
              <p className="mt-1 text-[0.8rem] text-tenue">Eliminar una incidencia es una acción excepcional y queda registrada en auditoría.</p>
              <Button variant="danger" size="sm" className="mt-3" loading={remove.isPending} onClick={() => confirm(`¿Eliminar la incidencia ${t.number}? Quedará registrado en la auditoría.`) && remove.mutate()}>
                <Trash className="size-4" /> Eliminar incidencia
              </Button>
            </section>
          )}
        </div>
      )}

      {activeTab === "history" && (
        <section className="panel overflow-hidden">
          <div className="panel-head">
            <div><p className="eyebrow">Historial</p><h3 className="mt-1 text-[0.95rem] font-bold text-tinta">Actividad y auditoría</h3></div>
            <span className="shrink-0 rounded-md bg-papel-2 px-2 py-1 text-[0.75rem] font-semibold text-tenue">{history.length} registros</span>
          </div>

          <div className="p-4 sm:p-5">
            {t.status === "RESUELTO" && t.resolution && (
              <div className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 p-3.5">
                <p className="text-[0.68rem] font-bold uppercase tracking-[0.07em] text-emerald-700">Última solución</p>
                <p className="mt-1.5 text-[0.85rem] leading-6 text-tinta">{t.resolution.notes || "Sin detalle de solución."}</p>
                <p className="mt-1.5 text-[0.75rem] text-tenue">Atendida por {t.resolution.resolved_by_name || "personal TI"}.</p>
              </div>
            )}

            {auditTrail.error && <p className="mb-4 text-[0.78rem] text-alerta">No se pudo cargar la auditoría completa.</p>}

            <ol className="ml-2 flex flex-col border-l border-line pl-5">
              {history.map((item) => (
                <li key={item.key} className="relative pb-4 last:pb-0">
                  <span className={cx("absolute -left-[1.45rem] top-1.5 size-2.5 rounded-full ring-2 ring-white", item.source === "audit" ? "bg-casma" : item.internal ? "bg-amber-400" : "bg-hecho")} aria-hidden />
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.72rem] text-tenue-2">
                    <span>{fmtDateTime(item.at)}</span>
                    <span className="font-semibold text-tinta-2">{item.actor}</span>
                    {item.source === "audit" && <Badge className="border-casma/25 bg-casma-claro text-casma-oscuro">Auditoría</Badge>}
                    {item.source !== "audit" && item.internal && <Badge className="border-linea bg-papel-2 text-tenue">Interno</Badge>}
                  </div>
                  <p className={cx("mt-0.5 text-[0.85rem] leading-6", item.internal && item.source !== "audit" ? "text-tenue" : "text-tinta")}>{item.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}

      {assistantOpen && (
        <div className="fixed inset-0 z-[90] bg-tinta/40" onClick={() => setAssistantOpen(false)}>
          <aside className="ml-auto flex h-full w-full max-w-md flex-col bg-white" style={{ boxShadow: "var(--shadow-pop)" }} onClick={(event) => event.stopPropagation()}>
            <header className="flex items-start justify-between gap-3 border-b border-linea px-5 py-3.5">
              <div className="min-w-0">
                <p className="eyebrow flex items-center gap-1.5"><BrainCircuit className="size-3.5" aria-hidden /> Asistente IA</p>
                <h3 className="mt-1 text-[0.95rem] font-bold text-tinta">{t.number}</h3>
                <p className="mt-0.5 text-[0.75rem] text-tenue">Análisis contextual de esta incidencia</p>
              </div>
              <button type="button" onClick={() => setAssistantOpen(false)} className="grid size-9 shrink-0 place-items-center rounded-lg text-tenue transition hover:bg-papel-2 hover:text-tinta" aria-label="Cerrar asistente"><X className="size-4.5" /></button>
            </header>

            <div className="flex-1 overflow-y-auto p-4">
              {!ai ? (
                <div className="rounded-xl border border-dashed border-linea bg-papel-2/50 p-6 text-center">
                  <BrainCircuit className="mx-auto size-6 text-casma" aria-hidden />
                  <p className="mt-2.5 text-[0.9rem] font-bold text-tinta">Aún no hay análisis disponible</p>
                  <p className="mx-auto mt-1 max-w-xs text-[0.8rem] leading-5 text-tenue">Solicite un análisis para obtener clasificación, prioridad y casos similares.</p>
                  <Button className="mt-4" variant="primary" size="sm" loading={reanalyze.isPending} onClick={() => reanalyze.mutate({ id: t.id })}><RefreshCw className="size-4" /> Analizar incidencia</Button>
                </div>
              ) : (
                <div className="flex flex-col gap-3.5">
                  <div className="rounded-xl bg-tinta p-3.5 text-white">
                    <p className="text-[0.68rem] font-bold uppercase tracking-[0.08em] text-amber-300">Resumen</p>
                    <p className="mt-1.5 text-[0.83rem] leading-6">{ai.briefing}</p>
                  </div>

                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <AiCard label="Categoría sugerida" value={CATEGORY_LABEL[ai.category]} helper={`${pct(ai.category_confidence)} de confianza`} />
                    <AiCard label="Prioridad sugerida" value={PRIORITY_LABEL[ai.priority]} helper={`Puntaje ${pct(ai.priority_score)}`} />
                    <AiCard label="Técnico sugerido" value={ai.suggested_technician_name || "Sin sugerencia"} helper={ai.technician_reasons[0]} />
                    <AiCard label="Riesgo de nueva falla" value={ai.equipment_risk != null ? pct(ai.equipment_risk) : "Sin dato"} helper={ai.equipment_risk_factors[0]} />
                  </div>

                  {t.follow_up.ai_summary && (
                    <div className="rounded-xl border border-casma/20 bg-casma-claro/50 p-3.5">
                      <p className="text-[0.8rem] font-bold text-casma-oscuro">Seguimiento sugerido</p>
                      <p className="mt-1 text-[0.83rem] leading-6 text-tinta">{t.follow_up.ai_summary}</p>
                      {t.follow_up.ai_recommendation && <p className="mt-1.5 text-[0.8rem] text-tenue"><strong className="text-tinta">Recomendación:</strong> {t.follow_up.ai_recommendation}</p>}
                    </div>
                  )}

                  {ai.priority !== t.priority && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5">
                      <p className="text-[0.85rem] font-bold text-tinta">La IA propone cambiar la prioridad</p>
                      <p className="mt-1 text-[0.8rem] text-tenue">Actual: {PRIORITY_LABEL[t.priority]} · Sugerida: {PRIORITY_LABEL[ai.priority]}</p>
                      <Button className="mt-3" size="sm" variant="primary" loading={applyAiPriority.isPending} onClick={() => applyAiPriority.mutate({ id: t.id, body: { priority: ai.priority, model_version: ai.model_version } })}>
                        <ShieldCheck className="size-4" /> Aplicar recomendación
                      </Button>
                    </div>
                  )}

                  {ai.similar_cases.length > 0 && (
                    <div>
                      <p className="text-[0.85rem] font-bold text-tinta">Casos parecidos</p>
                      <ul className="mt-2 flex flex-col gap-2">
                        {ai.similar_cases.slice(0, 3).map((c) => (
                          <li key={c.ticket_id} className="rounded-lg border border-linea bg-papel-2/50 p-3">
                            <p className="text-[0.8rem] font-semibold text-tinta">{c.number} · {pct(c.score)} similar</p>
                            <p className="mt-0.5 text-[0.78rem] text-tenue">{c.subject}</p>
                            {c.resolution && <p className="mt-1.5 text-[0.75rem] text-hecho">Solución: {c.resolution}</p>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>

            <footer className="border-t border-linea p-3.5">
              <Button variant="secondary" className="w-full" loading={reanalyze.isPending} onClick={() => reanalyze.mutate({ id: t.id })}>
                <RefreshCw className={cx("size-4", reanalyze.isPending && "animate-spin")} /> Actualizar análisis
              </Button>
            </footer>
          </aside>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.68rem] font-bold uppercase tracking-[0.06em] text-tenue-2">{label}</dt>
      <dd className="mt-0.5 truncate text-[0.85rem] font-semibold text-tinta">{value || "—"}</dd>
    </div>
  );
}

function AiCard({ label, value, helper }: { label: string; value: string; helper?: string }) {
  return (
    <div className="stat">
      <p className="stat-label">{label}</p>
      <p className="mt-1 text-[0.9rem] font-bold text-tinta">{value}</p>
      {helper && <p className="mt-1 text-[0.72rem] leading-4 text-tenue">{helper}</p>}
    </div>
  );
}

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
