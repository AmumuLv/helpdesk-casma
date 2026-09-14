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
    <article className={cx("flex flex-col gap-3 p-4 sm:flex-row", t.priority === "ALTA" && t.status !== "RESUELTO" && "border-l-4 border-alerta bg-alerta-claro/30")}>
      {t.attachments[0] && (
        <button onClick={() => setPhoto(true)} className="h-32 shrink-0 overflow-hidden rounded-xl border border-linea sm:size-24" aria-label="Ampliar foto">
          <img src={t.attachments[0].url} alt="" loading="lazy" className="size-full object-cover" />
        </button>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold text-tenue">{t.number}</span>
          <Badge className="border-tinta bg-tinta text-white">{t.office_name}</Badge>
          <PriorityBadge priority={t.priority} />
          <StatusBadge status={t.status} />
          <CategoryBadge category={t.category} />
          <time className="ml-auto text-sm text-tenue" dateTime={t.created_at} title={fmtDateTime(t.created_at)}>{fmtAgo(t.created_at)}</time>
        </div>
        <button onClick={onOpen} className="text-left">
          <h3 className="text-lg font-bold hover:text-casma">{t.subject}</h3>
          {t.description && <p className="line-clamp-2 text-tenue">{t.description}</p>}
        </button>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-tenue">
          {t.reporter_name && <span className="flex items-center gap-1"><User className="size-4" />{t.reporter_name}</span>}
          {t.contact_phone && <span className="flex items-center gap-1"><Phone className="size-4" />{t.contact_phone}</span>}
          {t.equipment && <span className="flex items-center gap-1"><Cpu className="size-4" />{t.equipment.patrimonial_code}{t.equipment.ip_address && `, IP ${t.equipment.ip_address}`}</span>}
        </div>
        {t.ai?.related_alert && <p className="text-sm font-bold text-alerta">{t.ai.related_alert}</p>}
        {t.ai && t.status !== "RESUELTO" && t.ai.similar_cases[0]?.resolution && (
          <p className="flex items-start gap-1.5 text-sm"><Sparkles className="mt-0.5 size-4 shrink-0 text-casma" aria-hidden />Caso parecido: {t.ai.similar_cases[0].resolution}</p>
        )}
        {t.status === "RESUELTO" && t.resolution && (
          <p className="text-sm"><strong>Solución ({t.resolution.resolved_by_name}):</strong> {t.resolution.notes}
            {t.resolution.confirmed_by_user === false && <span className="font-bold text-alerta"> La oficina indica que sigue fallando.</span>}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-col gap-2 sm:w-52">
        {t.status !== "RESUELTO" ? (
          <>
            <Select aria-label="Asignar técnico" value={t.assigned_to_id ?? ""} disabled={assign.isPending}
              onChange={(e) => assign.mutate({ id: t.id, body: { technician_id: e.target.value || null } })} className="h-10 text-sm">
              <option value="">Sin asignar</option>
              {techs.data?.filter((s) => s.active).map((s) => (
                <option key={s.id} value={s.id}>{s.id === suggested ? "★ " : ""}{s.full_name} ({s.open_tickets})</option>
              ))}
            </Select>
            {suggested && !t.assigned_to_id && <p className="flex items-center gap-1 text-xs text-tenue"><Star className="size-3" /> Sugerido: {t.ai?.suggested_technician_name}</p>}
            <Button size="sm" variant="success" onClick={onOpen}>Atender y resolver</Button>
          </>
        ) : (
          <Button size="sm" variant="secondary" loading={reopen.isPending} onClick={() => reopen.mutate({ id: t.id })}>Reabrir</Button>
        )}
        <Button size="sm" variant="ghost" onClick={onOpen}>Ver detalle</Button>
      </div>
      <Modal open={photo} onClose={() => setPhoto(false)} title={`Foto de ${t.number}`} wide>
        {t.attachments[0] && <img src={t.attachments[0].url} alt={`Foto adjunta a ${t.number}`} className="mx-auto max-h-[75dvh] rounded-xl" />}
      </Modal>
    </article>
  );
}
