import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, ErrorBox, Input, Spinner } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { fmtDateTime } from "../../lib/labels";
import { PageHeader } from "./PageHeader";

type Log = { at: string; actor_type: string; actor_name: string | null; action: string; target_type: string | null; target_id: string | null; ip: string | null; details: Record<string, unknown> };

export function AuditPage() {
  const logs = useQuery({ queryKey: ["audit"], queryFn: () => api<Log[]>("/admin/audit?limit=500") });
  const [filter, setFilter] = useState("");
  const f = filter.trim().toLowerCase();
  const rows = (logs.data ?? []).filter((l) => !f || `${l.action} ${l.actor_name ?? ""} ${l.ip ?? ""}`.toLowerCase().includes(f));

  return (
    <div>
      <PageHeader title="Auditoría" description="Registro de accesos y acciones administrativas." />
      <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar por acción, persona o IP" className="mb-4 max-w-md" aria-label="Filtrar auditoría" />
      {logs.isLoading ? <Spinner /> : logs.error ? <ErrorBox message={errorMessage(logs.error)} /> : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-linea bg-papel text-tenue"><tr><th className="p-3">Fecha</th><th className="p-3">Quién</th><th className="p-3">Acción</th><th className="p-3">Detalle</th><th className="p-3">IP</th></tr></thead>
            <tbody className="divide-y divide-linea">
              {rows.map((l, i) => (
                <tr key={i} className={l.action.includes("failed") || l.action.includes("denied") ? "bg-alerta-claro/50" : ""}>
                  <td className="whitespace-nowrap p-3">{fmtDateTime(l.at)}</td>
                  <td className="p-3">{l.actor_name ?? "–"}<p className="text-xs text-tenue">{l.actor_type}</p></td>
                  <td className="p-3 font-bold">{l.action}</td>
                  <td className="max-w-xs truncate p-3 text-tenue" title={JSON.stringify(l.details)}>{Object.entries(l.details).map(([k, v]) => `${k}: ${String(v)}`).join(", ") || l.target_type || "–"}</td>
                  <td className="p-3">{l.ip ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
