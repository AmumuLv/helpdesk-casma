import { Cpu, Phone, Sparkles, Star, User } from "lucide-react";
import { useState } from "react";
import { Badge, Button, CategoryBadge, cx, Modal, PriorityBadge, Select, StatusBadge } from "../../components/ui";
import { fmtAgo, fmtDateTime } from "../../lib/labels";
import type { Ticket } from "../../lib/types";
import { useTechnicians, useTicketAction } from "./hooks";

export function TicketCard({ ticket: t, onOpen }: { ticket: Ticket; onOpen: () => void }) {
  const techs = useTechnicians();
  const assign = useTicketAction<{ technician_id: string | null }>((id) => `/tickets/${id}/assign`, "POST", "Técnico asignado");
  const reopen = useTicketAction((id) => `/tickets/${id}/reopen`, "POST", "Incidencia reabierta");
  const [photo, setPhoto] = useState(false);
  const suggested = t.ai?.suggested_technician_id;

  return (
    <article
      className={cx(
        "relative flex flex-col gap-4 overflow-hidden rounded-2xl border border-linea bg-white p-4 shadow-[0_5px_16px_rgba(31,41,55,0.04)] transition-all hover:border-casma/20 hover:shadow-[0_10px_24px_rgba(31,41,55,0.075)] sm:flex-row",
        t.priority === "ALTA" && t.status !== "RESUELTO" && "border-l-4 border-l-alerta",
      )}
    >
      {t.attachments[0] && (
        <button
          onClick={() => setPhoto(true)}
          className="h-32 shrink-0 overflow-hidden rounded-xl border border-linea bg-papel shadow-sm transition hover:border-casma/30 sm:size-24"
          aria-label="Ampliar foto"
        >
          <img src={t.attachments[0].url} alt="" loading="lazy" className="size-full object-cover" />
        </button>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs font-bold tracking-wide text-tenue">{t.number}</span>
          <Badge className="border-casma/20 bg-casma text-white">{t.office_name}</Badge>
          <PriorityBadge priority={t.priority} />
          <StatusBadge status={t.status} />
          <CategoryBadge category={t.category} />
          <time className="ml-auto text-xs font-medium text-tenue" dateTime={t.created_at} title={fmtDateTime(t.created_at)}>{fmtAgo(t.created_at)}</time>
        </div>

        <button onClick={onOpen} className="group text-left">
          <h3 className="text-lg font-bold leading-snug tracking-tight text-tinta transition group-hover:text-casma-oscuro">{t.subject}</h3>
          {t.description && <p className="mt-1 line-clamp-2 text-sm leading-5 text-tenue">{t.description}</p>}
        </button>

        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs font-medium text-tenue">
          {t.reporter_name && <span className="flex items-center gap-1.5"><User className="size-3.5 text-casma" />{t.reporter_name}</span>}
          {t.contact_phone && <span className="flex items-center gap-1.5"><Phone className="size-3.5 text-casma" />{t.contact_phone}</span>}
          {t.equipment && <span className="flex items-center gap-1.5"><Cpu className="size-3.5 text-casma" />{t.equipment.patrimonial_code}{t.equipment.ip_address && ` · IP ${t.equipment.ip_address}`}</span>}
        </div>

        {t.ai?.related_alert && <p className="rounded-lg border border-alerta/20 bg-alerta-claro px-3 py-2 text-sm font-bold text-alerta">{t.ai.related_alert}</p>}
        {t.ai && t.status !== "RESUELTO" && t.ai.similar_cases[0]?.resolution && (
          <p className="flex items-start gap-2 rounded-lg border border-casma/10 bg-casma-claro/45 px-3 py-2 text-sm leading-5 text-tinta/85">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-casma" aria-hidden />
            <span><strong className="text-casma-oscuro">Caso parecido:</strong> {t.ai.similar_cases[0].resolution}</span>
          </p>
        )}
        {t.status === "RESUELTO" && t.resolution && (
          <p className="rounded-lg border border-hecho/15 bg-hecho-claro/45 px-3 py-2 text-sm leading-5">
            <strong>Cierre ({t.resolution.resolved_by_name}):</strong> {t.resolution.notes}
            {t.resolution.confirmed_by_user === false && <span className="font-bold text-alerta"> La oficina indica que sigue fallando.</span>}
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-t border-linea pt-3 sm:w-52 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
        {t.status !== "RESUELTO" ? (
          <>
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-tenue">Técnico asignado</p>
            <Select
              aria-label="Asignar técnico"
              value={t.assigned_to_id ?? ""}
              disabled={assign.isPending}
              onChange={(e) => assign.mutate({ id: t.id, body: { technician_id: e.target.value || null } })}
              className="h-10 text-sm"
            >
              <option value="">Sin asignar</option>
              {techs.data?.filter((s) => s.active).map((s) => (
                <option key={s.id} value={s.id}>{s.id === suggested ? "★ " : ""}{s.full_name} ({s.open_tickets})</option>
              ))}
            </Select>
            {suggested && !t.assigned_to_id && (
              <p className="flex items-center gap-1 text-xs font-medium text-tenue"><Star className="size-3 text-sol" /> Sugerido: {t.ai?.suggested_technician_name}</p>
            )}
            <Button size="sm" variant="success" className="mt-1 w-full" onClick={onOpen}>Atender y resolver</Button>
          </>
        ) : (
          <Button size="sm" variant="secondary" className="w-full" loading={reopen.isPending} onClick={() => reopen.mutate({ id: t.id })}>Reabrir</Button>
        )}
        <Button size="sm" variant="ghost" className="w-full" onClick={onOpen}>Ver detalle</Button>
      </div>

      <Modal open={photo} onClose={() => setPhoto(false)} title={`Foto de ${t.number}`} wide>
        {t.attachments[0] && <img src={t.attachments[0].url} alt={`Foto adjunta a ${t.number}`} className="mx-auto max-h-[75dvh] rounded-xl" />}
      </Modal>
    </article>
  );
}
