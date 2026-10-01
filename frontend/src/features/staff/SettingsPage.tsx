import { Bell, KeyRound, MonitorSmartphone, ScrollText, ShieldCheck, Signal, UserRound, Users } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { Badge, Card, cx } from "../../components/ui";
import { useMe } from "../../lib/session";
import { PageHeader } from "./PageHeader";

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
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Configuración" description="Preferencias de la interfaz y accesos a su cuenta." />

      <div className="flex flex-col gap-4">
        <Card className="overflow-hidden">
          <div className="panel-head"><div><h2 className="panel-title">Preferencias del sistema</h2><p className="panel-sub">Cambios visuales que no afectan la lógica ni los tickets.</p></div></div>
          <div className="divide-y divide-linea">
            <PreferenceRow
              icon={<Bell className="size-4" />}
              iconClass="bg-amber-50 text-amber-700"
              title="Notificaciones del panel"
              description="Avisos de nuevas incidencias, asignaciones y alertas del soporte."
              enabled={notificationsEnabled}
              onToggle={() => updatePreference("notificationsEnabled", !notificationsEnabled)}
            />
            <PreferenceRow
              icon={<Signal className="size-4" />}
              iconClass="bg-sky-50 text-sky-700"
              title="Estado de conexión"
              description="Muestra «En línea / Offline» para saber si los cambios se están sincronizando."
              enabled={showConnection}
              onToggle={() => updatePreference("showConnection", !showConnection)}
            />
          </div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="overflow-hidden">
            <div className="panel-head">
              <h2 className="flex items-center gap-2 panel-title"><UserRound className="size-4 text-casma" aria-hidden /> Cuenta</h2>
            </div>
            <div className="grid gap-2 p-4">
              <QuickAction icon={<UserRound className="size-4" />} title="Mi perfil" onClick={() => navigate("/soporte/perfil")} />
              <QuickAction icon={<KeyRound className="size-4" />} title="Cambiar contraseña" onClick={() => navigate("/soporte/clave")} />
            </div>
          </Card>

          {isAdmin && (
            <Card className="overflow-hidden">
              <div className="panel-head">
                <h2 className="flex items-center gap-2 panel-title"><ShieldCheck className="size-4 text-casma" aria-hidden /> Administración TI</h2>
              </div>
              <div className="grid gap-2 p-4 sm:grid-cols-3 lg:grid-cols-1">
                <QuickAction icon={<MonitorSmartphone className="size-4" />} title="Dispositivos" onClick={() => navigate("/soporte/dispositivos")} />
                <QuickAction icon={<Users className="size-4" />} title="Personal TI" onClick={() => navigate("/soporte/personal")} />
                <QuickAction icon={<ScrollText className="size-4" />} title="Auditoría" onClick={() => navigate("/soporte/auditoria")} />
              </div>
            </Card>
          )}
        </div>
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
    <div className="flex items-center gap-3.5 px-4 py-3.5 sm:px-5">
      <span className={cx("grid size-8 shrink-0 place-items-center rounded-lg", iconClass)} aria-hidden>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[0.88rem] font-bold text-tinta">{title}</h3>
          <Badge className={enabled ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-linea bg-papel-2 text-tenue"}>{enabled ? "Activo" : "Inactivo"}</Badge>
        </div>
        <p className="mt-0.5 text-[0.78rem] leading-5 text-tenue">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={onToggle}
        className={cx(
          "relative h-6 w-10 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-casma/15",
          enabled ? "border-casma bg-casma" : "border-linea-fuerte bg-papel-2",
        )}
        aria-label={`${enabled ? "Desactivar" : "Activar"} ${title.toLowerCase()}`}
      >
        <span className={cx("absolute top-0.5 size-4.5 rounded-full bg-white transition-transform", enabled ? "translate-x-[1.15rem]" : "translate-x-0.5")} />
      </button>
    </div>
  );
}

function QuickAction({ icon, title, onClick }: { icon: ReactNode; title: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group flex w-full items-center gap-2.5 rounded-lg border border-linea bg-white px-3 py-2.5 text-left transition hover:border-casma/30 hover:bg-casma-claro/40">
      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-papel-2 text-tenue transition group-hover:bg-white group-hover:text-casma-oscuro">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-[0.85rem] font-semibold text-tinta">{title}</span>
    </button>
  );
}
