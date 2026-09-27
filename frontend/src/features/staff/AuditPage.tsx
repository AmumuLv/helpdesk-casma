import { useQuery } from "@tanstack/react-query";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Card, ErrorBox, Input, Spinner } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { fmtDateTime } from "../../lib/labels";
import { PageHeader } from "./PageHeader";

type Log = { at: string; actor_type: string; actor_name: string | null; action: string; target_type: string | null; target_id: string | null; ip: string | null; details: Record<string, unknown> };

function logDetail(log: Log) {
  return Object.entries(log.details).map(([k, v]) => `${k}: ${String(v)}`).join(", ") || log.target_type || "Sin detalle adicional";
}

function isWarning(log: Log) {
  return log.action.includes("failed") || log.action.includes("denied");
}

export function AuditPage() {
  const logs = useQuery({ queryKey: ["audit"], queryFn: () => api<Log[]>("/admin/audit?limit=500") });
  const [filter, setFilter] = useState("");
  const f = filter.trim().toLowerCase();
  const rows = (logs.data ?? []).filter((l) => !f || `${l.action} ${l.actor_name ?? ""} ${l.ip ?? ""}`.toLowerCase().includes(f));

  return (
    <div>
      <PageHeader title="Auditoría" description="Registro de accesos y acciones administrativas." />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar por acción, persona o IP" className="max-w-md" aria-label="Filtrar auditoría" />
        {!logs.isLoading && !logs.error && <span className="text-sm font-medium text-tenue">{rows.length} registro{rows.length === 1 ? "" : "s"}</span>}
      </div>
      {logs.isLoading ? <Spinner /> : logs.error ? <ErrorBox message={errorMessage(logs.error)} /> : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-linea md:hidden">
            {rows.map((l, i) => (
              <article key={i} className={isWarning(l) ? "bg-alerta-claro/60 p-4" : "bg-white p-4"}>
                <div className="flex items-start gap-3">
                  <span className={isWarning(l) ? "grid size-10 shrink-0 place-items-center rounded-xl bg-alerta-claro text-alerta" : "grid size-10 shrink-0 place-items-center rounded-xl bg-casma-claro text-casma-oscuro"}>
                    {isWarning(l) ? <ShieldAlert className="size-5" /> : <ShieldCheck className="size-5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-bold text-tinta">{l.actor_name ?? "Sistema"}</p>
                        <p className="text-xs font-semibold uppercase tracking-[0.06em] text-tenue">{l.actor_type}</p>
                      </div>
                      <time className="text-xs font-medium text-tenue">{fmtDateTime(l.at)}</time>
                    </div>
                    <p className={isWarning(l) ? "mt-3 font-bold text-alerta" : "mt-3 font-bold text-tinta"}>{l.action}</p>
                    <p className="mt-1 break-words text-sm leading-5 text-tenue">{logDetail(l)}</p>
                    <p className="mt-2 text-xs text-tenue">IP: <span className="font-semibold text-tinta">{l.ip ?? "–"}</span></p>
                  </div>
                </div>
              </article>
            ))}
            {!rows.length && <div className="p-8 text-center text-tenue">No hay registros que coincidan con el filtro.</div>}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-linea bg-papel text-tenue">
                <tr><th className="p-3">Fecha</th><th className="p-3">Quién</th><th className="p-3">Acción</th><th className="p-3">Detalle</th><th className="p-3">IP</th></tr>
              </thead>
              <tbody className="divide-y divide-linea">
                {rows.map((l, i) => (
                  <tr key={i} className={isWarning(l) ? "bg-alerta-claro/50" : "transition hover:bg-casma-claro/25"}>
                    <td className="whitespace-nowrap p-3">{fmtDateTime(l.at)}</td>
                    <td className="p-3">{l.actor_name ?? "–"}<p className="text-xs text-tenue">{l.actor_type}</p></td>
                    <td className="p-3 font-bold">{l.action}</td>
                    <td className="max-w-xs truncate p-3 text-tenue" title={JSON.stringify(l.details)}>{logDetail(l)}</td>
                    <td className="p-3">{l.ip ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
