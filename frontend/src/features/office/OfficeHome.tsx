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
    <div className="flex flex-col gap-10">
      {data.alerts.map((a) => (
        <div key={a.title} role="status" className="flex gap-4 rounded-2xl border-2 border-sol bg-sol-claro p-5">
          <Megaphone className="size-8 shrink-0 text-[#7a5200]" aria-hidden />
          <div>
            <p className="text-xl font-bold">{a.title}</p>
            <p>{a.message}</p>
          </div>
        </div>
      ))}

      {pendingConfirm.map((t) => (
        <Link key={t.id} to={`/oficina/reporte/${t.id}`} className="flex items-center gap-4 rounded-2xl border-2 border-hecho bg-hecho-claro p-5">
          <div className="flex-1">
            <p className="text-xl font-bold">Soporte TI terminó: «{t.subject}»</p>
            <p>Toque aquí para decirnos si ya funciona.</p>
          </div>
          <ChevronRight className="size-8 shrink-0" aria-hidden />
        </Link>
      ))}

      <section className="flex flex-col gap-5">
        <div>
          <h1 className="text-3xl font-bold sm:text-4xl">¿Qué problema tiene?</h1>
          <p className="mt-1 text-tenue">Toque el botón que se parezca a su problema.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ISSUE_ORDER.map((key) => {
            const issue = ISSUES[key];
            const Icon = issue.icon;
            return (
              <Link key={key} to={`/oficina/reportar/${key}`} className="tecla min-h-28">
                <span className={`grid size-16 shrink-0 place-items-center rounded-2xl ${issue.tone}`}><Icon className="size-9" aria-hidden /></span>
                <span>
                  <span className="block text-xl font-bold leading-tight">{issue.title}</span>
                  <span className="mt-1 block text-base text-tenue">{issue.hint}</span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {data.open_tickets.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-2xl font-bold">Sus reportes</h2>
          <ul className="flex flex-col gap-3">
            {data.open_tickets.map((t) => (
              <li key={t.id}>
                <Link to={`/oficina/reporte/${t.id}`} className="flex items-center gap-4 rounded-2xl border border-linea bg-white p-4 hover:border-casma">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={t.status} />
                      <span className="text-base text-tenue">{fmtAgo(t.created_at)}</span>
                    </div>
                    <p className="mt-1 truncate text-xl font-bold">{t.subject}</p>
                    {t.assigned_to_name && t.status !== "RESUELTO" && <p className="text-base text-tenue">Lo atiende: {t.assigned_to_name}</p>}
                  </div>
                  <ChevronRight className="size-7 shrink-0 text-tenue" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
