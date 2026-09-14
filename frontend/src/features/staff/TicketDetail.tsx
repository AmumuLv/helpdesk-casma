import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BrainCircuit, RefreshCw, Trash } from "lucide-react";
import { useState } from "react";
import { useToast } from "../../components/Toasts";
import { Badge, Button, CategoryBadge, cx, ErrorBox, Modal, PriorityBadge, Select, Spinner, StatusBadge, Textarea } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { CATEGORIES, CATEGORY_LABEL, EQUIPMENT_LABEL, fmtDateTime, pct, PRIORITY_LABEL } from "../../lib/labels";
import type { Ticket, TicketCategory, TicketPriority } from "../../lib/types";
import { useIsAdmin, useTechnicians, useTicketAction } from "./hooks";

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
  const resolve = useTicketAction<{ notes: string }>((id) => `/tickets/${id}/resolve`, "POST", "Incidencia resuelta");
  const reopen = useTicketAction((id) => `/tickets/${id}/reopen`, "POST", "Incidencia reabierta");
  const reanalyze = useTicketAction((id) => `/tickets/${id}/reanalyze`, "POST", "Análisis actualizado");
  const remove = useMutation({
    mutationFn: () => api(`/tickets/${t.id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tickets"] }); qc.invalidateQueries({ queryKey: ["kpis"] }); toast({ tone: "success", title: "Incidencia eliminada" }); onClose(); },
    onError: (err) => toast({ tone: "danger", title: "No se pudo eliminar", body: errorMessage(err) }),
  });
  const [noteText, setNoteText] = useState("");
  const [visible, setVisible] = useState(false);
  const [resolution, setResolution] = useState("");
  const suggestedFix = t.ai?.similar_cases.find((c) => c.resolution)?.resolution;
  const ai = t.ai;

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
            <Textarea rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="Qué se hizo para solucionarlo (la oficina lo verá)" />
            <Button variant="success" loading={resolve.isPending} disabled={resolution.trim().length < 5}
              onClick={() => resolve.mutate({ id: t.id, body: { notes: resolution.trim() } })}>Marcar como resuelto</Button>
          </section>
        ) : (
          <section className="flex flex-col gap-2 rounded-xl bg-hecho-claro p-4">
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
          <ol className="flex flex-col gap-3 border-l-2 border-linea pl-4">
            {[...t.timeline].reverse().map((e, i) => (
              <li key={i} className={cx(e.internal && "text-tenue")}>
                <p className="text-xs">{fmtDateTime(e.at)}, {e.actor}{e.internal && " (interno)"}</p>
                <p className="text-sm">{e.text}</p>
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
            <AiBlock title={`Prioridad sugerida: ${PRIORITY_LABEL[ai.priority]}`} items={ai.priority_reasons} />
            {ai.suggested_technician_name && <AiBlock title={`Técnico sugerido: ${ai.suggested_technician_name}`} items={ai.technician_reasons} />}
            {ai.equipment_risk != null && (
              <div className="flex flex-col gap-1">
                <p className="text-sm font-bold">Riesgo de nueva falla (30 días): {pct(ai.equipment_risk)}</p>
                <div className="h-2 overflow-hidden rounded-full bg-white/15"><div className={cx("h-full", ai.equipment_risk > 0.6 ? "bg-alerta" : ai.equipment_risk > 0.35 ? "bg-sol" : "bg-hecho")} style={{ width: pct(ai.equipment_risk) }} /></div>
                {ai.equipment_risk_factors.length > 0 && <ul className="list-disc pl-5 text-xs text-white/75">{ai.equipment_risk_factors.map((f) => <li key={f}>{f}</li>)}</ul>}
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

const Info = ({ label, value }: { label: string; value?: string | null }) => (
  <div className="min-w-0"><dt className="text-tenue">{label}</dt><dd className="truncate font-bold">{value || "–"}</dd></div>
);

const AiBlock = ({ title, items }: { title: string; items?: string[] }) => (
  <div>
    <p className="text-sm font-bold">{title}</p>
    {items && items.length > 0 && <ul className="list-disc pl-5 text-xs text-white/75">{items.map((r) => <li key={r}>{r}</li>)}</ul>}
  </div>
);
