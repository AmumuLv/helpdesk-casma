import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, BrainCircuit, CheckCheck, FileText, MessageCircle, Paperclip, Send, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, ErrorBox, Select, Spinner, Textarea, cx } from "../../components/ui";
import { useToast } from "../../components/Toasts";
import { api, errorMessage } from "../../lib/api";
import { fmtDateTime, PRIORITY_LABEL } from "../../lib/labels";
import type { Ticket, TicketPriority } from "../../lib/types";
import { useTechnicians } from "../staff/hooks";

type AttentionState = "POR_ATENDER" | "EN_ATENCION" | "ESPERANDO_RESPUESTA" | "EN_ESPERA" | "CERRADA";
type ReassignmentReason = "OTRA_ESPECIALIDAD" | "TECNICO_NO_DISPONIBLE" | "DISTRIBUCION_CARGA" | "COMPLEJIDAD" | "RESPONSABLE_TI" | "OTRO";

type ConversationAttachment = {
  id: string;
  url: string;
  filename: string;
  content_type: string;
  width: number | null;
  height: number | null;
};

type ConversationMessage = {
  id: string;
  at: string;
  author_type: "staff" | "office";
  author_name: string;
  text: string;
  attachments: ConversationAttachment[];
  seen_by_staff_at: string | null;
  seen_by_office_at: string | null;
};

type ConversationData = {
  attention_state: AttentionState;
  attention_label: string;
  office_attention_label: string;
  messages: ConversationMessage[];
  unread_for_staff: number;
  unread_for_office: number;
};

type AssistantData = {
  summary: string;
  missing_info: string[];
  suggested_questions: string[];
  suggested_reply: string;
  priority_suggestion: TicketPriority | null;
  priority_reason: string | null;
  recommended_technician_id: string | null;
  recommended_technician_name: string | null;
  technician_reasons: string[];
  keep_current_technician: boolean;
  handoff_summary: string;
};

type ReassignResult = {
  assigned_to_id: string | null;
  assigned_to_name: string | null;
  handoff_summary: string | null;
};

const REASSIGNMENT_LABEL: Record<ReassignmentReason, string> = {
  OTRA_ESPECIALIDAD: "Otra especialidad",
  TECNICO_NO_DISPONIBLE: "Técnico no disponible",
  DISTRIBUCION_CARGA: "Distribución de carga",
  COMPLEJIDAD: "Complejidad del caso",
  RESPONSABLE_TI: "Decisión del responsable TI",
  OTRO: "Otro motivo",
};

function attentionTone(state: AttentionState) {
  if (state === "CERRADA") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (state === "ESPERANDO_RESPUESTA") return "border-violet-200 bg-violet-50 text-violet-800";
  if (state === "EN_ESPERA") return "border-slate-200 bg-slate-50 text-slate-700";
  if (state === "EN_ATENCION") return "border-sky-200 bg-sky-50 text-sky-800";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

function AttachmentView({ item }: { item: ConversationAttachment }) {
  const image = item.content_type.startsWith("image/");
  return (
    <a href={item.url} target="_blank" rel="noreferrer" className="mt-3 block overflow-hidden rounded-xl border border-current/10 bg-white/90 p-3 text-xs font-semibold text-tinta hover:underline">
      {image ? <img src={item.url} alt={item.filename} className="mb-2 max-h-52 rounded-lg object-contain" /> : <FileText className="mb-1 size-5" />}
      {item.filename}
    </a>
  );
}

function MessageList({ data, viewer }: { data: ConversationData; viewer: "staff" | "office" }) {
  if (!data.messages.length) {
    return (
      <div className="rounded-2xl border border-dashed border-linea bg-papel/40 px-5 py-9 text-center">
        <div className="mx-auto grid size-11 place-items-center rounded-full bg-white text-casma shadow-sm"><MessageCircle className="size-5" /></div>
        <p className="mt-3 font-bold text-tinta">Aún no hay mensajes</p>
        <p className="mt-1 text-sm text-tenue">La conversación entre Soporte TI y la oficina aparecerá aquí.</p>
      </div>
    );
  }
  return (
    <div className="flex max-h-[520px] flex-col gap-4 overflow-y-auto rounded-2xl bg-papel/25 p-3 pr-2 sm:p-4">
      {data.messages.map((message) => {
        const mine = message.author_type === viewer;
        const seen = viewer === "staff" ? message.seen_by_office_at : message.seen_by_staff_at;
        return (
          <div key={message.id} className={cx("flex", mine ? "justify-end" : "justify-start")}>
            <div className={cx("max-w-[88%] rounded-2xl px-4 py-3 text-sm shadow-sm sm:max-w-[76%]", mine ? "bg-casma text-white" : "border border-linea bg-white text-tinta")}>
              <div className={cx("mb-1.5 flex flex-wrap items-center gap-2 text-[11px]", mine ? "text-white/70" : "text-tenue")}>
                <span className="font-bold">{message.author_name}</span>
                <span>{fmtDateTime(message.at)}</span>
              </div>
              {message.text && <p className="whitespace-pre-wrap leading-6">{message.text}</p>}
              {message.attachments.map((item) => <AttachmentView key={item.id} item={item} />)}
              {mine && seen && <p className="mt-2 flex items-center justify-end gap-1 text-[10px] text-white/70"><CheckCheck className="size-3" /> Visto</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function StaffTicketConversation({ ticket }: { ticket: Ticket }) {
  const qc = useQueryClient();
  const toast = useToast();
  const techs = useTechnicians();
  const conversation = useQuery({
    queryKey: ["ticket-conversation", ticket.id],
    queryFn: () => api<ConversationData>(`/tickets/${ticket.id}/conversation`),
    refetchInterval: 15_000,
  });
  const read = useMutation({
    mutationFn: () => api<ConversationData>(`/tickets/${ticket.id}/conversation/read`, { method: "POST" }),
    onSuccess: (data) => qc.setQueryData(["ticket-conversation", ticket.id], data),
  });
  useEffect(() => {
    if ((conversation.data?.unread_for_staff ?? 0) > 0 && !read.isPending) read.mutate();
  }, [conversation.data?.unread_for_staff]);

  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [assistant, setAssistant] = useState<AssistantData | null>(null);
  const send = useMutation({
    mutationFn: (waitForReply: boolean) => {
      const form = new FormData();
      form.append("text", text.trim());
      form.append("wait_for_reply", String(waitForReply));
      if (file) form.append("attachment", file);
      return api<ConversationData>(`/tickets/${ticket.id}/conversation/messages`, { form });
    },
    onSuccess: (data) => {
      qc.setQueryData(["ticket-conversation", ticket.id], data);
      qc.invalidateQueries({ queryKey: ["ticket", ticket.id] });
      qc.invalidateQueries({ queryKey: ["workboard"] });
      qc.invalidateQueries({ queryKey: ["follow-up-metrics"] });
      setText("");
      setFile(null);
      toast({ tone: "success", title: "Mensaje enviado" });
    },
    onError: (err) => toast({ tone: "danger", title: "No se pudo enviar", body: errorMessage(err) }),
  });
  const assistantMutation = useMutation({
    mutationFn: () => api<AssistantData>(`/tickets/${ticket.id}/conversation/assistant`),
    onSuccess: setAssistant,
    onError: (err) => toast({ tone: "danger", title: "No se pudo consultar la IA", body: errorMessage(err) }),
  });

  const [selectedTech, setSelectedTech] = useState(ticket.assigned_to_id ?? "");
  const [reason, setReason] = useState<"" | ReassignmentReason>("");
  const [reasonNote, setReasonNote] = useState("");
  useEffect(() => setSelectedTech(ticket.assigned_to_id ?? ""), [ticket.assigned_to_id, ticket.id]);
  const changingExisting = !!ticket.assigned_to_id && selectedTech !== (ticket.assigned_to_id ?? "");
  const assignmentChanged = selectedTech !== (ticket.assigned_to_id ?? "");
  const reassign = useMutation({
    mutationFn: () => api<ReassignResult>(`/tickets/${ticket.id}/reassign`, {
      method: "POST",
      json: {
        technician_id: selectedTech || null,
        reason: changingExisting ? reason || null : null,
        note: reasonNote.trim() || null,
      },
    }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["ticket", ticket.id] });
      qc.invalidateQueries({ queryKey: ["workboard"] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
      qc.invalidateQueries({ queryKey: ["ticket-audit", ticket.id] });
      setReason("");
      setReasonNote("");
      toast({ tone: "success", title: result.assigned_to_name ? "Responsable actualizado" : "Incidencia sin asignar", body: result.handoff_summary ? "La IA dejó un resumen de transferencia en la actividad interna." : undefined });
    },
    onError: (err) => toast({ tone: "danger", title: "No se pudo cambiar el responsable", body: errorMessage(err) }),
  });

  const canSend = text.trim().length > 0 || !!file;
  const recommendedId = assistant?.recommended_technician_id ?? ticket.ai?.suggested_technician_id ?? null;
  const activeTechs = useMemo(() => (techs.data ?? []).filter((item) => item.active), [techs.data]);

  return (
    <section className="flex flex-col gap-5 rounded-3xl border border-linea bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-linea pb-4">
        <div className="flex gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-casma-claro text-casma-oscuro"><MessageCircle className="size-5" /></div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-casma-oscuro">Conversación y atención</p>
            <h3 className="mt-1 text-xl font-bold text-tinta">Soporte TI ↔ {ticket.office_name}</h3>
            <p className="mt-1 text-sm leading-5 text-tenue">Mensajes públicos separados de las notas internas y de la auditoría.</p>
          </div>
        </div>
        {conversation.data && <span className={cx("rounded-full border px-3 py-1.5 text-xs font-bold", attentionTone(conversation.data.attention_state))}>{conversation.data.attention_label}</span>}
      </div>

      {conversation.isLoading ? <Spinner label="Cargando conversación" /> : conversation.error ? <ErrorBox message={errorMessage(conversation.error)} /> : conversation.data ? <MessageList data={conversation.data} viewer="staff" /> : null}

      {ticket.status !== "RESUELTO" && (
        <div className="rounded-2xl border border-linea bg-papel/35 p-4 sm:p-5">
          <div className="mb-3">
            <p className="text-sm font-bold text-tinta">Responder a la oficina</p>
            <p className="mt-1 text-xs text-tenue">El mensaje será visible para la oficina dentro de esta incidencia.</p>
          </div>
          <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Escribe una respuesta clara para la oficina…" />
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-linea bg-white px-4 py-2.5 text-sm font-semibold shadow-sm transition hover:bg-papel">
                <Paperclip className="size-4" /> {file ? file.name : "Adjuntar imagen o PDF"}
                <input className="hidden" type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
              {file && <button type="button" className="text-xs font-semibold text-tenue hover:underline" onClick={() => setFile(null)}>Quitar adjunto</button>}
            </div>
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <Button size="sm" variant="secondary" disabled={!canSend} loading={send.isPending && send.variables === false} onClick={() => send.mutate(false)}><Send className="size-4" /> Enviar</Button>
              <Button size="sm" disabled={!canSend || !ticket.assigned_to_id} loading={send.isPending && send.variables === true} onClick={() => send.mutate(true)}>Enviar y esperar respuesta</Button>
            </div>
          </div>
          {!ticket.assigned_to_id && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">Asigna un responsable antes de usar “Enviar y esperar respuesta”.</p>}
        </div>
      )}

      <div className="border-t border-linea pt-5">
        <div className="mb-3">
          <p className="flex items-center gap-2 text-sm font-bold text-tinta"><ArrowRightLeft className="size-4 text-casma" /> Responsable técnico</p>
          <p className="mt-1 text-xs text-tenue">Asigna o transfiere la atención sin perder el contexto del caso.</p>
        </div>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <Select value={selectedTech} disabled={ticket.status === "RESUELTO" || reassign.isPending} onChange={(e) => setSelectedTech(e.target.value)}>
            <option value="">Sin asignar</option>
            {activeTechs.map((tech) => <option key={tech.id} value={tech.id}>{tech.id === recommendedId ? "★ " : ""}{tech.full_name} ({tech.open_tickets} activas)</option>)}
          </Select>
          <Button variant="secondary" disabled={!assignmentChanged || (changingExisting && !reason)} loading={reassign.isPending} onClick={() => reassign.mutate()}><ArrowRightLeft className="size-4" /> {ticket.assigned_to_id ? "Cambiar responsable" : "Asignar"}</Button>
        </div>
      </div>

      {changingExisting && (
        <div className="grid gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-bold">Motivo de reasignación
            <Select value={reason} onChange={(e) => setReason(e.target.value as ReassignmentReason)}>
              <option value="">Seleccionar motivo…</option>
              {(Object.keys(REASSIGNMENT_LABEL) as ReassignmentReason[]).map((key) => <option key={key} value={key}>{REASSIGNMENT_LABEL[key]}</option>)}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-bold">Contexto opcional
            <Textarea rows={2} value={reasonNote} onChange={(e) => setReasonNote(e.target.value)} placeholder="Ejemplo: requiere experiencia en redes" />
          </label>
        </div>
      )}

      <div className="rounded-2xl border border-casma/20 bg-casma-claro/30 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="flex items-center gap-2 text-sm font-bold text-casma-oscuro"><BrainCircuit className="size-4" /> Asistente IA del chat</p>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-tenue">Analiza la conversación junto con casos similares y carga técnica. Solo propone; tú confirmas cualquier acción.</p>
          </div>
          <Button size="sm" variant="secondary" loading={assistantMutation.isPending} onClick={() => assistantMutation.mutate()}><Sparkles className="size-4" /> Analizar conversación</Button>
        </div>
        {assistant && (
          <div className="mt-4 grid gap-3 text-sm">
            <p>{assistant.summary}</p>
            {assistant.missing_info.length > 0 && <div><p className="font-bold">Información que conviene confirmar</p><ul className="mt-1 list-disc pl-5 text-tenue">{assistant.missing_info.map((item) => <li key={item}>{item}</li>)}</ul></div>}
            <div className="rounded-xl border border-linea bg-white p-4">
              <p className="font-bold">Respuesta sugerida</p>
              <p className="mt-1 leading-5 text-tenue">{assistant.suggested_reply}</p>
              <Button size="sm" variant="ghost" className="mt-2" onClick={() => setText(assistant.suggested_reply)}>Usar respuesta sugerida</Button>
            </div>
            {assistant.priority_suggestion && <p><strong>Prioridad sugerida:</strong> {PRIORITY_LABEL[assistant.priority_suggestion]}{assistant.priority_reason ? ` · ${assistant.priority_reason}` : ""}</p>}
            {assistant.recommended_technician_name && <div><p className="font-bold">Responsable recomendado: {assistant.recommended_technician_name}</p><ul className="mt-1 list-disc pl-5 text-tenue">{assistant.technician_reasons.map((item) => <li key={item}>{item}</li>)}</ul></div>}
            {assistant.keep_current_technician && <p className="rounded-xl bg-emerald-50 p-3 text-emerald-800">La IA recomienda mantener al responsable actual para conservar continuidad.</p>}
            <details className="rounded-xl border border-linea bg-white p-4"><summary className="cursor-pointer font-bold">Resumen de transferencia IA</summary><p className="mt-2 leading-5 text-tenue">{assistant.handoff_summary}</p></details>
          </div>
        )}
      </div>
    </section>
  );
}

export function OfficeTicketConversation({ ticketId, closed = false }: { ticketId: string; closed?: boolean }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const conversation = useQuery({
    queryKey: ["office-ticket-conversation", ticketId],
    queryFn: () => api<ConversationData>(`/office/tickets/${ticketId}/conversation`),
    refetchInterval: 15_000,
  });
  const read = useMutation({
    mutationFn: () => api<ConversationData>(`/office/tickets/${ticketId}/conversation/read`, { method: "POST" }),
    onSuccess: (data) => qc.setQueryData(["office-ticket-conversation", ticketId], data),
  });
  useEffect(() => {
    if ((conversation.data?.unread_for_office ?? 0) > 0 && !read.isPending) read.mutate();
  }, [conversation.data?.unread_for_office]);
  const send = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append("text", text.trim());
      if (file) form.append("attachment", file);
      return api<ConversationData>(`/office/tickets/${ticketId}/conversation/messages`, { form });
    },
    onSuccess: (data) => {
      qc.setQueryData(["office-ticket-conversation", ticketId], data);
      qc.invalidateQueries({ queryKey: ["office-ticket", ticketId] });
      qc.invalidateQueries({ queryKey: ["office-home"] });
      setText("");
      setFile(null);
    },
  });
  const canSend = text.trim().length > 0 || !!file;

  return (
    <section className="flex flex-col gap-5 rounded-3xl border border-linea bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-linea pb-4">
        <div><h2 className="flex items-center gap-2 text-2xl font-bold"><MessageCircle className="size-6 text-casma" /> Conversación con Soporte TI</h2><p className="mt-1 text-base text-tenue">Puede responder y adjuntar una captura o PDF sin salir del reporte.</p></div>
        {conversation.data && <span className={cx("rounded-full border px-3 py-1.5 text-sm font-bold", attentionTone(conversation.data.attention_state))}>{conversation.data.office_attention_label}</span>}
      </div>
      {conversation.isLoading ? <Spinner label="Cargando conversación" /> : conversation.error ? <ErrorBox message={errorMessage(conversation.error)} /> : conversation.data ? <MessageList data={conversation.data} viewer="office" /> : null}
      {!closed && conversation.data?.attention_state !== "CERRADA" && (
        <div className="rounded-2xl border border-linea bg-papel/40 p-4 sm:p-5">
          <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Escriba una respuesta para Soporte TI…" />
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-linea bg-white px-4 py-2.5 font-semibold shadow-sm"><Paperclip className="size-4" /> {file ? file.name : "Adjuntar archivo"}<input className="hidden" type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
              {file && <button type="button" className="text-sm text-tenue hover:underline" onClick={() => setFile(null)}>Quitar</button>}
            </div>
            <Button disabled={!canSend} loading={send.isPending} onClick={() => send.mutate()}><Send className="size-5" /> Enviar respuesta</Button>
          </div>
          {send.error && <div className="mt-2"><ErrorBox message={errorMessage(send.error)} /></div>}
        </div>
      )}
    </section>
  );
}
