import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, FileText, MessageCircle, Paperclip, Phone, Send } from "lucide-react";
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
    <a href={item.url} target="_blank" rel="noreferrer" className="mt-2 block overflow-hidden rounded-lg border border-current/10 bg-white/90 p-2 text-[0.75rem] font-semibold text-tinta hover:underline">
      {image ? <img src={item.url} alt={item.filename} className="mb-1.5 max-h-48 rounded-md object-contain" /> : <FileText className="mb-1 size-4" />}
      {item.filename}
    </a>
  );
}

function MessageList({ data, viewer }: { data: ConversationData; viewer: "staff" | "office" }) {
  if (!data.messages.length) {
    return (
      <div className="rounded-xl border border-dashed border-linea bg-papel-2/50 px-5 py-10 text-center">
        <MessageCircle className="mx-auto size-5 text-casma" aria-hidden />
        <p className="mt-2 text-[0.9rem] font-bold text-tinta">A├║n no hay mensajes</p>
        <p className="mt-0.5 text-[0.8rem] text-tenue">La conversaci├│n de esta incidencia aparecer├í aqu├¡.</p>
      </div>
    );
  }
  return (
    <div className="flex max-h-[30rem] flex-col gap-3 overflow-y-auto rounded-xl bg-papel-2/50 p-3">
      {data.messages.map((message) => {
        const mine = message.author_type === viewer;
        const seen = viewer === "staff" ? message.seen_by_office_at : message.seen_by_staff_at;
        return (
          <div key={message.id} className={cx("flex", mine ? "justify-end" : "justify-start")}>
            <div className={cx("max-w-[92%] rounded-xl px-3.5 py-2.5 text-[0.85rem] sm:max-w-[78%]", mine ? "bg-casma text-white" : "border border-linea bg-white text-tinta")}>
              <div className={cx("mb-1 flex flex-wrap items-center gap-x-2 text-[0.7rem]", mine ? "text-white/70" : "text-tenue")}>
                <span className="font-semibold">{message.author_name}</span>
                <span>{fmtDateTime(message.at)}</span>
              </div>
              {message.text && <p className="whitespace-pre-wrap leading-6">{message.text}</p>}
              {message.attachments.map((item) => <AttachmentView key={item.id} item={item} />)}
              {mine && seen && <p className="mt-1.5 flex items-center justify-end gap-1 text-[0.68rem] text-white/70"><CheckCheck className="size-3" /> Visto</p>}
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
    <section className={cx("flex flex-col gap-3.5", !embedded && "panel p-4 sm:p-5")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {!embedded && <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-casma-claro text-casma-oscuro"><MessageCircle className="size-4" aria-hidden /></span>}
          <div>
            <p className="text-[0.85rem] font-bold text-tinta">Soporte TI Ôåö {ticket.office_name}</p>
            <p className="mt-0.5 text-[0.75rem] leading-5 text-tenue">Visible en el portal de la oficina, separado de las notas internas.</p>
          </div>
        </div>
        {conversation.data && <span className={cx("rounded-md border px-2 py-1 text-[0.75rem] font-semibold", attentionTone(conversation.data.attention_state))}>{conversation.data.attention_label}</span>}
      </div>

      {assistedReport && (
        <p className="notice border-amber-200 bg-amber-50 text-amber-900">
          <Phone className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>Reporte registrado manualmente por soporte. El chat se ve en el portal de <strong>{ticket.office_name}</strong>; no se env├¡a al tel├®fono del reportante.</span>
        </p>
      )}

      {conversation.isLoading ? <Spinner label="Cargando conversaci├│n" /> : conversation.error ? <ErrorBox message={errorMessage(conversation.error)} /> : conversation.data ? <MessageList data={conversation.data} viewer="staff" /> : null}

      {ticket.status !== "RESUELTO" && (
        <div className="rounded-xl border border-linea bg-papel-2/50 p-3.5">
          <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Escribe una respuesta clara para la oficinaÔÇª" />
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-linea bg-white px-2.5 py-1.5 text-[0.8rem] font-semibold text-tinta-2 transition hover:bg-papel-2">
                <Paperclip className="size-4" aria-hidden /> <span className="max-w-[12rem] truncate">{file ? file.name : "Adjuntar imagen o PDF"}</span>
                <input className="hidden" type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
              {file && <button type="button" className="text-[0.78rem] font-semibold text-tenue hover:text-alerta" onClick={() => setFile(null)}>Quitar</button>}
            </div>
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <Button size="sm" variant="secondary" disabled={!canSend} loading={send.isPending && send.variables === false} onClick={() => send.mutate(false)}><Send className="size-4" /> Enviar</Button>
              <Button size="sm" variant="primary" disabled={!canSend || !ticket.assigned_to_id} loading={send.isPending && send.variables === true} onClick={() => send.mutate(true)}>Enviar y esperar respuesta</Button>
            </div>
          </div>
          {!ticket.assigned_to_id && <p className="mt-3 text-[0.75rem] font-semibold text-amber-700">Asigna un responsable antes de usar ┬½Enviar y esperar respuesta┬╗.</p>}
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
    <section className="panel flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-linea pb-3.5">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold"><MessageCircle className="size-4.5 text-casma" aria-hidden /> Conversaci├│n con Soporte TI</h2>
          <p className="mt-0.5 text-[0.85rem] text-tenue">Puede responder y adjuntar una captura o PDF sin salir del reporte.</p>
        </div>
        {conversation.data && <span className={cx("rounded-md border px-2 py-1 text-[0.8rem] font-semibold", attentionTone(conversation.data.attention_state))}>{conversation.data.office_attention_label}</span>}
      </div>
      {conversation.isLoading ? <Spinner label="Cargando conversaci├│n" /> : conversation.error ? <ErrorBox message={errorMessage(conversation.error)} /> : conversation.data ? <MessageList data={conversation.data} viewer="office" /> : null}
      {!closed && conversation.data?.attention_state !== "CERRADA" && (
        <div className="rounded-xl border border-linea bg-papel-2/50 p-3.5">
          <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Escriba una respuesta para Soporte TIÔÇª" />
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-lg border border-linea bg-white px-3 py-2 text-[0.85rem] font-semibold text-tinta-2 transition hover:bg-papel-2">
                <Paperclip className="size-4" aria-hidden /> <span className="max-w-[12rem] truncate">{file ? file.name : "Adjuntar archivo"}</span>
                <input className="hidden" type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
              {file && <button type="button" className="text-[0.8rem] text-tenue hover:text-alerta" onClick={() => setFile(null)}>Quitar</button>}
            </div>
            <Button variant="primary" disabled={!canSend} loading={send.isPending} onClick={() => send.mutate()}><Send className="size-4" /> Enviar respuesta</Button>
          </div>
          {send.error && <div className="mt-2"><ErrorBox message={errorMessage(send.error)} /></div>}
        </div>
      )}
    </section>
  );
}
