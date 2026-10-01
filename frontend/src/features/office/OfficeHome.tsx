import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Megaphone } from "lucide-react";
import { Link } from "react-router";
import { ErrorBox, Spinner, StatusBadge } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { fmtAgo } from "../../lib/labels";
import type { OfficeHome as Home } from "../../lib/types";
import { ISSUES, ISSUE_ORDER } from "./issues";

export const useOfficeHome = () => useQuery({ queryKey: ["office-home"], queryFn: () => api<Home>("/office/home"), refetchInterval: 60_000 });

export function OfficeHome() {
  const { data, isLoading, error } = useOfficeHome();
  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorBox message={errorMessage(error)} />;

  const pendingConfirm = data.open_tickets.filter((t) => t.status === "RESUELTO" && t.confirmed_by_user === null);

  return (
    <div className="flex flex-col gap-8">
      {data.alerts.map((a) => (
        <div key={a.title} role="status" className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <Megaphone className="size-6 shrink-0 text-amber-700" aria-hidden />
          <div>
            <p className="text-lg font-bold text-amber-950">{a.title}</p>
            <p className="text-base leading-6 text-amber-900">{a.message}</p>
          </div>
        </div>
      ))}

      {pendingConfirm.map((t) => (
        <Link key={t.id} to={`/oficina/reporte/${t.id}`} className="flex items-center gap-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 transition hover:border-emerald-400">
          <div className="flex-1">
            <p className="text-lg font-bold text-emerald-950">Soporte TI terminó: «{t.subject}»</p>
            <p className="text-base text-emerald-900">Toque aquí para decirnos si ya funciona.</p>
          </div>
          <ChevronRight className="size-6 shrink-0 text-emerald-700" aria-hidden />
        </Link>
      ))}

      <section className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">¿Qué problema tiene?</h1>
          <p className="mt-1 text-base text-tenue">Toque el botón que se parezca a su problema.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ISSUE_ORDER.map((key) => {
            const issue = ISSUES[key];
            const Icon = issue.icon;
            return (
              <Link key={key} to={`/oficina/reportar/${key}`} className="tecla">
                <span className={`grid size-12 shrink-0 place-items-center rounded-xl ${issue.tone}`}><Icon className="size-6" aria-hidden /></span>
                <span className="tecla-titulo">{issue.title}</span>
                <span className="tecla-ayuda">{issue.hint}</span>
              </Link>
            );
          })}
        </div>
      </section>

      {data.open_tickets.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-bold">Sus reportes</h2>
          <ul className="flex flex-col gap-2">
            {data.open_tickets.map((t) => (
              <li key={t.id}>
                <Link to={`/oficina/reporte/${t.id}`} className="flex items-center gap-4 rounded-xl border border-linea bg-white p-4 transition hover:border-casma/40 hover:bg-casma-claro/30">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={t.status} />
                      <span className="text-sm text-tenue">{fmtAgo(t.created_at)}</span>
                    </div>
                    <p className="mt-1 truncate text-lg font-bold">{t.subject}</p>
                    {t.assigned_to_name && t.status !== "RESUELTO" && <p className="text-base text-tenue">Lo atiende: {t.assigned_to_name}</p>}
                  </div>
                  <ChevronRight className="size-6 shrink-0 text-tenue" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
