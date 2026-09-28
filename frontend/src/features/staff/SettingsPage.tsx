import { Bell, ChevronRight, KeyRound, MonitorSmartphone, ScrollText, Settings, ShieldCheck, Signal, SlidersHorizontal, UserRound, Users } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { Card, cx } from "../../components/ui";
import { useMe } from "../../lib/session";

const readSetting = (key: string, fallback = true) => {
  const value = localStorage.getItem(key);
  if (value === null) return fallback;
  return value !== "false";
};

export function SettingsPage() {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const isAdmin = me?.staff?.role === "ADMIN";

  const [notificationsEnabled, setNotificationsEnabled] = useState(() => readSetting("helpdesk_notifications_enabled"));
  const [showConnection, setShowConnection] = useState(() => readSetting("helpdesk_show_connection"));

  const updatePreference = (key: "notificationsEnabled" | "showConnection", value: boolean) => {
    if (key === "notificationsEnabled") {
      setNotificationsEnabled(value);
      localStorage.setItem("helpdesk_notifications_enabled", String(value));
    } else {
      setShowConnection(value);
      localStorage.setItem("helpdesk_show_connection", String(value));
    }

    window.dispatchEvent(new CustomEvent("helpdesk-settings-changed", { detail: { [key]: value } }));
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="overflow-hidden rounded-3xl bg-[#111827] text-white shadow-[0_18px_45px_rgba(15,23,42,0.14)]">
        <div className="relative px-5 py-6 sm:px-7 sm:py-7">
          <div className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-casma/15 blur-3xl" aria-hidden />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-emerald-300">
                <Settings className="size-4" aria-hidden /> Centro de configuración TI
              </div>
              <h1 className="text-2xl font-extrabold tracking-[-0.03em] sm:text-3xl">Preferencias del centro de soporte</h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300 sm:text-base">
                Ajuste la experiencia de trabajo, seguridad y accesos administrativos sin modificar la operación de los tickets.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:flex">
              <StatusChip label="Notificaciones" value={notificationsEnabled ? "Activas" : "Desactivadas"} active={notificationsEnabled} />
              <StatusChip label="Conectividad" value={showConnection ? "Visible" : "Oculta"} active={showConnection} />
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
        <Card className="overflow-hidden border-slate-200/90 shadow-[0_12px_32px_rgba(15,23,42,0.055)]">
          <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-2xl bg-casma-claro text-casma-oscuro">
                <SlidersHorizontal className="size-5" aria-hidden />
              </span>
              <div>
                <h2 className="text-lg font-extrabold text-slate-950">Experiencia operativa</h2>
                <p className="mt-0.5 text-sm text-slate-500">Controles que afectan únicamente la interfaz del personal TI.</p>
              </div>
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            <PreferenceRow
              icon={<Bell className="size-5" />}
              iconClass="bg-amber-50 text-amber-700"
              title="Notificaciones del panel"
              description="Reciba avisos de nuevas incidencias, asignaciones y alertas mientras trabaja en el sistema."
              enabled={notificationsEnabled}
              onToggle={() => updatePreference("notificationsEnabled", !notificationsEnabled)}
            />
            <PreferenceRow
              icon={<Signal className="size-5" />}
              iconClass="bg-sky-50 text-sky-700"
              title="Estado de conexión"
              description="Muestra el indicador En línea / Offline para confirmar si los cambios se están sincronizando."
              enabled={showConnection}
              onToggle={() => updatePreference("showConnection", !showConnection)}
            />
          </div>
        </Card>

        <Card className="border-slate-200/90 p-5 shadow-[0_12px_32px_rgba(15,23,42,0.055)] sm:p-6">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-slate-900 text-white">
              <ShieldCheck className="size-5" aria-hidden />
            </span>
            <div>
              <h2 className="text-lg font-extrabold text-slate-950">Cuenta y seguridad</h2>
              <p className="mt-1 text-sm leading-5 text-slate-500">Mantenga sus datos y acceso protegidos.</p>
            </div>
          </div>

          <div className="mt-5 space-y-2">
            <QuickAction
              icon={<UserRound className="size-4" />}
              title="Mi perfil"
              description="Datos personales y rol"
              onClick={() => navigate("/soporte/perfil")}
            />
            <QuickAction
              icon={<KeyRound className="size-4" />}
              title="Seguridad y contraseña"
              description="Actualizar credenciales de acceso"
              onClick={() => navigate("/soporte/clave")}
            />
          </div>
        </Card>
      </div>

      {isAdmin && (
        <Card className="overflow-hidden border-slate-200/90 shadow-[0_12px_32px_rgba(15,23,42,0.055)]">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-2xl bg-amber-50 text-amber-700">
                <ShieldCheck className="size-5" aria-hidden />
              </span>
              <div>
                <h2 className="text-lg font-extrabold text-slate-950">Administración del sistema</h2>
                <p className="mt-0.5 text-sm text-slate-500">Accesos directos a las áreas críticas del Help Desk.</p>
              </div>
            </div>
            <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">Solo administrador TI</span>
          </div>

          <div className="grid gap-3 p-4 sm:grid-cols-3 sm:p-5">
            <AdminTile
              icon={<MonitorSmartphone className="size-5" />}
              title="Dispositivos"
              description="Autorizar, rechazar o revocar equipos vinculados."
              onClick={() => navigate("/soporte/dispositivos")}
            />
            <AdminTile
              icon={<Users className="size-5" />}
              title="Personal TI"
              description="Técnicos, roles, especialidades y acceso."
              onClick={() => navigate("/soporte/personal")}
            />
            <AdminTile
              icon={<ScrollText className="size-5" />}
              title="Auditoría"
              description="Trazabilidad de acciones y eventos del sistema."
              onClick={() => navigate("/soporte/auditoria")}
            />
          </div>
        </Card>
      )}
    </div>
  );
}

function PreferenceRow({
  icon,
  iconClass,
  title,
  description,
  enabled,
  onToggle,
}: {
  icon: ReactNode;
  iconClass: string;
  title: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center gap-4 px-5 py-5 sm:px-6">
      <span className={cx("grid size-11 shrink-0 place-items-center rounded-2xl", iconClass)} aria-hidden>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-extrabold text-slate-950 sm:text-base">{title}</h3>
          <span className={cx(
            "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em]",
            enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500",
          )}>
            {enabled ? "Activo" : "Inactivo"}
          </span>
        </div>
        <p className="mt-1 max-w-2xl text-sm leading-5 text-slate-500">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={onToggle}
        className={cx(
          "relative h-7 w-12 shrink-0 rounded-full border transition-all focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-casma/15",
          enabled ? "border-casma bg-casma" : "border-slate-300 bg-slate-200",
        )}
        aria-label={`${enabled ? "Desactivar" : "Activar"} ${title.toLowerCase()}`}
      >
        <span className={cx(
          "absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform",
          enabled ? "translate-x-5" : "translate-x-0.5",
        )} />
      </button>
    </div>
  );
}

function QuickAction({ icon, title, description, onClick }: { icon: ReactNode; title: string; description: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-left transition hover:border-casma/25 hover:bg-casma-claro/30 hover:shadow-sm"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-700 transition group-hover:bg-white group-hover:text-casma-oscuro">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-slate-900">{title}</span>
        <span className="mt-0.5 block text-xs text-slate-500">{description}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-casma" aria-hidden />
    </button>
  );
}

function AdminTile({ icon, title, description, onClick }: { icon: ReactNode; title: string; description: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-32 flex-col items-start rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-casma/25 hover:shadow-[0_12px_24px_rgba(15,23,42,0.07)]"
    >
      <span className="grid size-10 place-items-center rounded-xl bg-casma-claro text-casma-oscuro">{icon}</span>
      <span className="mt-4 text-sm font-extrabold text-slate-950">{title}</span>
      <span className="mt-1 text-xs leading-5 text-slate-500">{description}</span>
      <span className="mt-auto flex items-center gap-1 pt-3 text-xs font-bold text-casma-oscuro">
        Abrir <ChevronRight className="size-3.5 transition group-hover:translate-x-0.5" />
      </span>
    </button>
  );
}

function StatusChip({ label, value, active }: { label: string; value: string; active: boolean }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">{label}</p>
      <p className="mt-1 flex items-center gap-2 text-sm font-bold text-white">
        <span className={cx("size-2 rounded-full", active ? "bg-emerald-400" : "bg-slate-500")} aria-hidden /> {value}
      </p>
    </div>
  );
}
