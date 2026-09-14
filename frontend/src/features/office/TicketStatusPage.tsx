import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, CircleCheck, Lightbulb, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { Button, cx, ErrorBox, Spinner } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { fmtDateTime } from "../../lib/labels";
import type { OfficeTicket, TicketStatus } from "../../lib/types";

const STEPS: { status: TicketStatus; label: string }[] = [
  { status: "PENDIENTE", label: "Recibido" },
  { status: "EN_PROCESO", label: "En atención" },
  { status: "RESUELTO", label: "Terminado" },
];

export function TicketStatusPage() {
  const { id } = useParams();
  const [search, setSearch] = useSearchParams();
  const [banner] = useState(() => (search.has("repetido") ? "repetido" : search.has("nuevo") ? "nuevo" : null));
  useEffect(() => {
    if (search.size) setSearch({}, { replace: true });
  }, [search, setSearch]);
  const qc = useQueryClient();
  const { data: t, isLoading, error } = useQuery({
    queryKey: ["office-ticket", id],
    queryFn: () => api<OfficeTicket>(`/office/tickets/${id}`),
    refetchInterval: 30_000,
  });
  const confirm = useMutation({
    mutationFn: (solved: boolean) => api<OfficeTicket>(`/office/tickets/${id}/confirm`, { json: { solved } }),
    onSuccess: (data) => {
      qc.setQueryData(["office-ticket", id], data);
      qc.invalidateQueries({ queryKey: ["office-home"] });
    },
  });

  if (isLoading) return <Spinner />;
  if (!t) return <ErrorBox message={errorMessage(error)} />;

  const current = STEPS.findIndex((s) => s.status === t.status);
  const statusMessage = t.status === "RESUELTO" ? null
    : t.status === "EN_PROCESO" && t.assigned_to_name ? `${t.assigned_to_name} está atendiendo su reporte.` : t.user_message;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <Link to="/oficina" className="inline-flex w-fit items-center gap-2 rounded-xl px-2 py-2 text-xl font-bold text-casma hover:bg-casma-claro">
        <ArrowLeft className="size-7" aria-hidden /> Volver al inicio
      </Link>

      {banner && (
        <div className="flex flex-col items-center gap-3 rounded-3xl bg-hecho-claro p-6 text-center">
          <CircleCheck className="size-16 text-hecho" aria-hidden />
          <p className="text-3xl font-bold">{banner === "repetido" ? "Ya teníamos su reporte" : "¡Reporte enviado!"}</p>
          <p className="text-xl">{banner === "repetido" ? "Agregamos lo que nos dijo al reporte que ya existía." : "Soporte TI ya fue avisado."}</p>
        </div>
      )}

      <section className="flex flex-col gap-2">
        <p className="text-tenue">Reporte {t.number}</p>
        <h1 className="text-3xl font-bold leading-tight">{t.subject}</h1>
        {t.equipment_code && <p className="text-tenue">Equipo {t.equipment_code}</p>}
      </section>

      <ol className="grid grid-cols-3 gap-2" aria-label="Estado del reporte">
        {STEPS.map((s, i) => (
          <li key={s.status} className="flex flex-col items-center gap-2 text-center">
            <span className={cx("grid size-14 place-items-center rounded-full border-4 text-xl font-bold",
              i < current ? "border-hecho bg-hecho text-white" : i === current ? "border-casma bg-casma text-white" : "border-linea bg-white text-tenue")}
              aria-current={i === current ? "step" : undefined}>
              {i < current || (i === current && t.status === "RESUELTO") ? <Check className="size-7" /> : i + 1}
            </span>
            <span className={cx("text-lg", i === current ? "font-bold" : "text-tenue")}>{s.label}</span>
          </li>
        ))}
      </ol>

      {statusMessage && <p className="rounded-2xl border border-linea bg-white p-5 text-xl">{statusMessage}</p>}

      {t.status === "RESUELTO" && (
        <section className="flex flex-col gap-4 rounded-3xl border-2 border-casma bg-white p-5">
          {t.resolution_notes && <p className="text-xl"><strong>Lo que hizo Soporte TI:</strong> {t.resolution_notes}</p>}
          {t.confirmed_by_user === null ? (
            <>
              <p className="text-2xl font-bold">¿Ya funciona?</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Button size="xl" variant="success" loading={confirm.isPending && confirm.variables} onClick={() => confirm.mutate(true)}>
                  <Check className="size-8" /> Sí, ya funciona
                </Button>
                <Button size="xl" variant="danger" loading={confirm.isPending && !confirm.variables} onClick={() => confirm.mutate(false)}>
                  <X className="size-8" /> No, sigue fallando
                </Button>
              </div>
            </>
          ) : (
            <p className="text-xl font-bold text-hecho">Gracias por confirmar.</p>
          )}
          {confirm.error && <ErrorBox message={errorMessage(confirm.error)} />}
        </section>
      )}

      {t.status !== "RESUELTO" && t.user_tips.length > 0 && (
        <section className="flex flex-col gap-3 rounded-2xl bg-sol-claro p-5">
          <h2 className="flex items-center gap-2 text-2xl font-bold"><Lightbulb className="size-7" aria-hidden /> Mientras espera, puede probar</h2>
          <ul className="flex list-disc flex-col gap-2 pl-6 text-xl">
            {t.user_tips.map((tip) => <li key={tip}>{tip}</li>)}
          </ul>
        </section>
      )}

      {t.attachments[0] && <img src={t.attachments[0].url} alt="Foto enviada" className="max-h-72 w-full rounded-2xl object-cover" />}

      <section className="flex flex-col gap-3">
        <h2 className="text-2xl font-bold">Historial</h2>
        <ol className="flex flex-col gap-3 border-l-4 border-linea pl-5">
          {[...t.timeline].reverse().map((e, i) => (
            <li key={i}>
              <p className="text-base text-tenue">{fmtDateTime(e.at)}</p>
              <p className="text-lg">{e.text}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
