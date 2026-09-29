import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, FileText, MessageCircle, Paperclip, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, ErrorBox, Spinner, Textarea, cx } from "../../components/ui";
import { useToast } from "../../components/Toasts";
import { api, errorMessage } from "../../lib/api";
import { fmtDateTime } from "../../lib/labels";
import type { Ticket } from "../../lib/types";

type AttentionState = "POR_ATENDER" | "EN_ATENCION" | "ESPERANDO_RESPUESTA" | "EN_ESPERA" | "CERRADA";

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
        <p className="mt-1 text-sm text-tenue">La conversación de esta incidencia aparecerá aquí.</p>
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
            <div className={cx("max-w-[92%] rounded-2xl px-4 py-3 text-sm shadow-sm sm:max-w-[78%]", mine ? "bg-casma text-white" : "border border-linea bg-white text-tinta")}>
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

export function StaffTicketConversation({ ticket, embedded = false }: { ticket: Ticket; embedded?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
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

  const canSend = text.trim().length > 0 || !!file;
  const assistedReport = ticket.channel === "TELEFONO";

  return (
    <section className={cx("flex flex-col gap-5", !embedded && "rounded-3xl border border-linea bg-white p-5 shadow-sm sm:p-6")}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex gap-3">
          {!embedded && <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-casma-claro text-casma-oscuro"><MessageCircle className="size-5" /></div>}
          <div>
            <p className="text-sm font-bold text-tinta">Soporte TI ↔ {ticket.office_name}</p>
            <p className="mt-1 text-xs leading-5 text-tenue">Mensajes visibles en el portal de la oficina y separados de las notas internas.</p>
          </div>
        </div>
        {conversation.data && <span className={cx("rounded-full border px-3 py-1.5 text-xs font-bold", attentionTone(conversation.data.attention_state))}>{conversation.data.attention_label}</span>}
      </div>

      {assistedReport && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
          Este reporte fue registrado manualmente por soporte. El chat se ve en el portal de <strong>{ticket.office_name}</strong>; no se envía automáticamente al teléfono del reportante.
        </div>
      )}

      {conversation.isLoading ? <Spinner label="Cargando conversación" /> : conversation.error ? <ErrorBox message={errorMessage(conversation.error)} /> : conversation.data ? <MessageList data={conversation.data} viewer="staff" /> : null}

      {ticket.status !== "RESUELTO" && (
        <div className="rounded-2xl border border-linea bg-papel/35 p-4 sm:p-5">
          <div className="mb-3">
            <p className="text-sm font-bold text-tinta">Responder</p>
            <p className="mt-1 text-xs text-tenue">La respuesta quedará asociada a esta incidencia.</p>
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
