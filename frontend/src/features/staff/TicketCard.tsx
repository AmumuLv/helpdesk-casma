import { Cpu, Eye, Phone, Sparkles, Star, User, Wrench } from "lucide-react";
import { useState, type ReactNode } from "react";
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
        "group relative flex flex-col gap-4 overflow-hidden rounded-2xl border border-linea bg-white p-4 shadow-[0_6px_18px_rgba(31,41,55,0.045)] transition-all duration-200 hover:-translate-y-0.5 hover:border-casma/25 hover:shadow-[0_14px_30px_rgba(31,41,55,0.085)] sm:flex-row",
        t.priority === "ALTA" && t.status !== "RESUELTO" && "border-l-4 border-l-alerta",
      )}
    >
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-casma/20 to-transparent opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />

      {t.attachments[0] && (
        <button
          onClick={() => setPhoto(true)}
          className="h-32 shrink-0 overflow-hidden rounded-xl border border-linea bg-papel shadow-sm transition hover:border-casma/30 hover:shadow-md sm:size-24"
          aria-label="Ampliar foto"
        >
          <img src={t.attachments[0].url} alt="" loading="lazy" className="size-full object-cover transition-transform duration-200 hover:scale-[1.03]" />
        </button>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-papel px-2 py-1 font-mono text-xs font-bold tracking-wide text-tenue ring-1 ring-linea">{t.number}</span>
          <Badge className="border-casma/20 bg-casma text-white shadow-sm">{t.office_name}</Badge>
          <PriorityBadge priority={t.priority} />
          <StatusBadge status={t.status} />
          <CategoryBadge category={t.category} />
          <time className="ml-auto text-xs font-medium text-tenue" dateTime={t.created_at} title={fmtDateTime(t.created_at)}>{fmtAgo(t.created_at)}</time>
        </div>

        <button onClick={onOpen} className="group/title text-left focus-visible:rounded-lg">
          <h3 className="text-lg font-extrabold leading-snug tracking-[-0.02em] text-tinta transition group-hover/title:text-casma-oscuro">{t.subject}</h3>
          {t.description && <p className="mt-1 line-clamp-2 text-sm leading-5 text-tenue">{t.description}</p>}
        </button>

        <div className="flex flex-wrap gap-2 text-xs font-medium text-tenue">
          {t.reporter_name && <Meta icon={<User className="size-3.5" />} text={t.reporter_name} />}
          {t.contact_phone && <Meta icon={<Phone className="size-3.5" />} text={t.contact_phone} />}
          {t.equipment && <Meta icon={<Cpu className="size-3.5" />} text={`${t.equipment.patrimonial_code}${t.equipment.ip_address ? ` · IP ${t.equipment.ip_address}` : ""}`} />}
        </div>

        {t.ai?.related_alert && <p className="rounded-xl border border-alerta/20 bg-alerta-claro px-3 py-2 text-sm font-bold text-alerta shadow-sm">{t.ai.related_alert}</p>}
        {t.ai && t.status !== "RESUELTO" && t.ai.similar_cases[0]?.resolution && (
          <p className="flex items-start gap-2 rounded-xl border border-casma/10 bg-casma-claro/45 px-3 py-2 text-sm leading-5 text-tinta/85">
            <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg bg-white text-casma shadow-sm"><Sparkles className="size-3.5" aria-hidden /></span>
            <span><strong className="text-casma-oscuro">Caso parecido:</strong> {t.ai.similar_cases[0].resolution}</span>
          </p>
        )}
        {t.status === "RESUELTO" && t.resolution && (
          <p className="rounded-xl border border-hecho/15 bg-hecho-claro/45 px-3 py-2 text-sm leading-5 shadow-sm">
            <strong>Cierre ({t.resolution.resolved_by_name}):</strong> {t.resolution.notes}
            {t.resolution.confirmed_by_user === false && <span className="font-bold text-alerta"> La oficina indica que sigue fallando.</span>}
          </p>
        )}
      </div>

      <aside className="flex shrink-0 flex-col gap-2.5 rounded-xl border border-linea bg-papel/55 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] sm:w-56">
        {t.status !== "RESUELTO" ? (
          <>
            <div className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-lg bg-casma-claro text-casma-oscuro"><Wrench className="size-4" /></span>
              <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-tenue">Técnico asignado</p>
            </div>
            <Select
              aria-label="Asignar técnico"
              value={t.assigned_to_id ?? ""}
              disabled={assign.isPending}
              onChange={(e) => assign.mutate({ id: t.id, body: { technician_id: e.target.value || null } })}
              className="h-11 bg-white text-sm"
            >
              <option value="">Sin asignar</option>
              {techs.data?.filter((s) => s.active).map((s) => (
                <option key={s.id} value={s.id}>{s.id === suggested ? "★ " : ""}{s.full_name} ({s.open_tickets})</option>
              ))}
            </Select>
            {suggested && !t.assigned_to_id && (
              <p className="flex items-center gap-1 text-xs font-medium text-tenue"><Star className="size-3 text-sol" /> Sugerido: {t.ai?.suggested_technician_name}</p>
            )}
            <Button size="sm" variant="success" className="mt-1 w-full" onClick={onOpen}><Wrench className="size-4" /> Atender y resolver</Button>
          </>
        ) : (
          <Button size="sm" variant="secondary" className="w-full" loading={reopen.isPending} onClick={() => reopen.mutate({ id: t.id })}>Reabrir</Button>
        )}
        <Button size="sm" variant="ghost" className="w-full" onClick={onOpen}><Eye className="size-4" /> Ver detalle</Button>
      </aside>

      <Modal open={photo} onClose={() => setPhoto(false)} title={`Foto de ${t.number}`} wide>
        {t.attachments[0] && <img src={t.attachments[0].url} alt={`Foto adjunta a ${t.number}`} className="mx-auto max-h-[75dvh] rounded-xl" />}
      </Modal>
    </article>
  );
}

function Meta({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-linea bg-papel/70 px-2 py-1.5">
      <span className="text-casma">{icon}</span>
      <span>{text}</span>
    </span>
  );
}
