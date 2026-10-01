import { useQuery } from "@tanstack/react-query";
import { Search, ShieldAlert, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Card, EmptyState, ErrorBox, Input, Spinner, cx } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { fmtDateTime } from "../../lib/labels";
import { PageHeader } from "./PageHeader";

type Log = {
  at: string; actor_type: string; actor_name: string | null;
  action: string; target_type: string | null; target_id: string | null;
  ip: string | null; details: Record<string, unknown>;
};

function detail(log: Log) {
  return Object.entries(log.details).map(([key, value]) => `${key}: ${String(value)}`).join(" · ") || log.target_type || "Sin detalle adicional";
}

const isWarning = (log: Log) => log.action.includes("failed") || log.action.includes("denied");

/** Auditoría: quién hizo qué, cuándo y desde dónde. */
export function AuditPage() {
  const logs = useQuery({ queryKey: ["audit"], queryFn: () => api<Log[]>("/admin/audit?limit=500") });
  const [filter, setFilter] = useState("");

  const needle = filter.trim().toLowerCase();
  const rows = (logs.data ?? []).filter((log) => !needle || `${log.action} ${log.actor_name ?? ""} ${log.ip ?? ""}`.toLowerCase().includes(needle));

  return (
    <div>
      <PageHeader
        title="Auditoría"
        description="Registro de accesos y acciones administrativas del sistema."
        meta={!logs.isLoading && !logs.error && <p className="text-[0.78rem] text-tenue"><strong className="font-bold text-tinta">{rows.length}</strong> registros</p>}
      />

      <div className="toolbar rounded-t-xl">
        <div className="relative min-w-0 flex-1 sm:max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-tenue-2" aria-hidden />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar por acción, persona o IP" aria-label="Filtrar auditoría" className="pl-8" />
        </div>
      </div>

      {logs.isLoading ? <Spinner /> : logs.error ? <ErrorBox message={errorMessage(logs.error)} /> : rows.length === 0 ? (
        <Card><EmptyState icon={<ShieldCheck />} title="No hay registros que coincidan con el filtro" /></Card>
      ) : (
        <>
          <ul className="divide-y divide-linea md:hidden">
            {rows.map((log, index) => (
              <li key={index} className={cx("p-4", isWarning(log) && "bg-alerta-claro/50")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[0.85rem] font-bold text-tinta">{log.actor_name ?? "Sistema"}</p>
                    <p className="text-[0.72rem] uppercase tracking-[0.06em] text-tenue-2">{log.actor_type}</p>
                  </div>
                  <time className="shrink-0 text-[0.72rem] text-tenue">{fmtDateTime(log.at)}</time>
                </div>
                <p className={cx("mt-2 text-[0.82rem] font-semibold", isWarning(log) ? "text-alerta" : "text-tinta")}>{log.action}</p>
                <p className="mt-0.5 break-words text-[0.76rem] leading-5 text-tenue">{detail(log)}</p>
                <p className="mt-1 text-[0.72rem] text-tenue-2">IP {log.ip ?? "–"}</p>
              </li>
            ))}
          </ul>

          <Card className="hidden overflow-hidden md:block">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-44">Fecha</th>
                    <th>Quién</th>
                    <th>Acción</th>
                    <th>Detalle</th>
                    <th className="w-32">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((log, index) => (
                    <tr key={index} className={isWarning(log) ? "bg-alerta-claro/50" : undefined}>
                      <td className="whitespace-nowrap text-[0.78rem] text-tenue">{fmtDateTime(log.at)}</td>
                      <td>
                        <span className="flex items-center gap-1.5">
                          {isWarning(log)
                            ? <ShieldAlert className="size-3.5 shrink-0 text-alerta" aria-hidden />
                            : <ShieldCheck className="size-3.5 shrink-0 text-tenue-2" aria-hidden />}
                          <span className="truncate text-[0.82rem] font-semibold text-tinta">{log.actor_name ?? "Sistema"}</span>
                        </span>
                        <span className="mt-0.5 block text-[0.72rem] text-tenue-2">{log.actor_type}</span>
                      </td>
                      <td className={cx("text-[0.82rem] font-semibold", isWarning(log) && "text-alerta")}>{log.action}</td>
                      <td className="max-w-sm truncate text-[0.78rem] text-tenue" title={JSON.stringify(log.details)}>{detail(log)}</td>
                      <td className="text-[0.78rem] text-tenue">{log.ip ?? "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
