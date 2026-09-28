import { Bell, KeyRound, MonitorSmartphone, ScrollText, Settings, ShieldCheck, Signal, UserRound, Users } from "lucide-react";
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
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex items-start gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-800 shadow-sm">
          <Settings className="size-5" aria-hidden />
        </span>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-casma-oscuro">Preferencias</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-[-0.03em] text-slate-950 sm:text-3xl">Configuración</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
            Ajustes rápidos para la experiencia del personal TI, cuenta y accesos administrativos.
          </p>
        </div>
      </header>

      <Card className="overflow-hidden border-slate-200/90 shadow-[0_10px_28px_rgba(15,23,42,0.05)]">
        <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
          <h2 className="text-base font-extrabold text-slate-950">Preferencias del sistema</h2>
          <p className="mt-1 text-sm text-slate-500">Cambios visuales que no afectan la lógica ni los tickets.</p>
        </div>
        <div className="divide-y divide-slate-100">
          <PreferenceRow
            icon={<Bell className="size-5" />}
            iconClass="bg-amber-50 text-amber-700"
            title="Notificaciones del panel"
            description="Avisos de nuevas incidencias, asignaciones y alertas del soporte."
            enabled={notificationsEnabled}
            onToggle={() => updatePreference("notificationsEnabled", !notificationsEnabled)}
          />
          <PreferenceRow
            icon={<Signal className="size-5" />}
            iconClass="bg-sky-50 text-sky-700"
            title="Estado de conexión"
            description="Muestra En línea / Offline para saber si los cambios se están sincronizando."
            enabled={showConnection}
            onToggle={() => updatePreference("showConnection", !showConnection)}
          />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-slate-200/90 p-5 shadow-[0_10px_28px_rgba(15,23,42,0.05)] sm:p-6">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-900 text-white">
              <ShieldCheck className="size-5" aria-hidden />
            </span>
            <div>
              <h2 className="text-base font-extrabold text-slate-950">Cuenta y seguridad</h2>
              <p className="mt-1 text-sm text-slate-500">Perfil y credenciales de acceso.</p>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            <QuickAction icon={<UserRound className="size-4" />} title="Mi perfil" onClick={() => navigate("/soporte/perfil")} />
            <QuickAction icon={<KeyRound className="size-4" />} title="Seguridad y contraseña" onClick={() => navigate("/soporte/clave")} />
          </div>
        </Card>

        {isAdmin && (
          <Card className="border-slate-200/90 p-5 shadow-[0_10px_28px_rgba(15,23,42,0.05)] sm:p-6">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-casma-claro text-casma-oscuro">
                <ShieldCheck className="size-5" aria-hidden />
              </span>
              <div>
                <h2 className="text-base font-extrabold text-slate-950">Administración TI</h2>
                <p className="mt-1 text-sm text-slate-500">Accesos directos del administrador.</p>
              </div>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              <QuickAction compact icon={<MonitorSmartphone className="size-4" />} title="Dispositivos" onClick={() => navigate("/soporte/dispositivos")} />
              <QuickAction compact icon={<Users className="size-4" />} title="Personal TI" onClick={() => navigate("/soporte/personal")} />
              <QuickAction compact icon={<ScrollText className="size-4" />} title="Auditoría" onClick={() => navigate("/soporte/auditoria")} />
            </div>
          </Card>
        )}
      </div>
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
    <div className="flex items-center gap-4 px-5 py-4 sm:px-6 sm:py-5">
      <span className={cx("grid size-10 shrink-0 place-items-center rounded-xl", iconClass)} aria-hidden>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-extrabold text-slate-950 sm:text-base">{title}</h3>
          <span className={cx(
            "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.05em]",
            enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500",
          )}>
            {enabled ? "Activo" : "Inactivo"}
          </span>
        </div>
        <p className="mt-1 text-sm leading-5 text-slate-500">{description}</p>
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

function QuickAction({ icon, title, onClick, compact = false }: { icon: ReactNode; title: string; onClick: () => void; compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "group flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white text-left transition hover:border-casma/25 hover:bg-casma-claro/30",
        compact ? "px-3 py-2.5" : "p-3",
      )}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600 transition group-hover:bg-white group-hover:text-casma-oscuro">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-900">{title}</span>
    </button>
  );
}
