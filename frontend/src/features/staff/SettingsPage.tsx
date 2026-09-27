import { Bell, KeyRound, MonitorSmartphone, ScrollText, Settings, ShieldCheck, UserRound, Users } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Button, Card } from "../../components/ui";
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
    <div className="space-y-5 sm:space-y-6">
      <header className="flex flex-col gap-2">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-casma-oscuro">Preferencias</p>
        <h1 className="text-2xl font-bold tracking-tight text-tinta sm:text-3xl">Configuración</h1>
        <p className="max-w-2xl text-sm leading-6 text-tenue sm:text-base">
          Ajuste el comportamiento del encabezado y acceda a las herramientas administrativas del sistema.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-700">
              <Bell className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold text-tinta">Notificaciones del panel</h2>
              <p className="mt-1 text-sm leading-5 text-tenue">Muestra avisos visuales cuando llegan incidencias, asignaciones, alertas o dispositivos pendientes.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={notificationsEnabled}
              onClick={() => updatePreference("notificationsEnabled", !notificationsEnabled)}
              className={`relative h-7 w-12 shrink-0 rounded-full border transition ${notificationsEnabled ? "border-emerald-600 bg-emerald-600" : "border-slate-300 bg-slate-200"}`}
              aria-label="Activar o desactivar notificaciones del panel"
            >
              <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform ${notificationsEnabled ? "translate-x-5" : "translate-x-0.5"}`} />
            </button>
          </div>
        </Card>

        <Card className="p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-700">
              <Settings className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold text-tinta">Estado de conexión</h2>
              <p className="mt-1 text-sm leading-5 text-tenue">Muestra u oculta el indicador “En línea / Offline” del encabezado.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={showConnection}
              onClick={() => updatePreference("showConnection", !showConnection)}
              className={`relative h-7 w-12 shrink-0 rounded-full border transition ${showConnection ? "border-emerald-600 bg-emerald-600" : "border-slate-300 bg-slate-200"}`}
              aria-label="Mostrar u ocultar el estado de conexión"
            >
              <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform ${showConnection ? "translate-x-5" : "translate-x-0.5"}`} />
            </button>
          </div>
        </Card>
      </div>

      <Card className="p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-casma-claro text-casma-oscuro">
            <UserRound className="size-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-lg font-bold text-tinta">Cuenta y seguridad</h2>
            <p className="mt-1 text-sm leading-5 text-tenue">Accesos rápidos a su perfil y contraseña.</p>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Button variant="secondary" onClick={() => navigate("/soporte/perfil")}>
            <UserRound className="size-4" aria-hidden /> Mi perfil
          </Button>
          <Button variant="secondary" onClick={() => navigate("/soporte/clave")}>
            <KeyRound className="size-4" aria-hidden /> Cambiar contraseña
          </Button>
        </div>
      </Card>

      {isAdmin && (
        <Card className="p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#111827] text-amber-400">
              <ShieldCheck className="size-5" aria-hidden />
            </span>
            <div>
              <h2 className="text-lg font-bold text-tinta">Administración del sistema</h2>
              <p className="mt-1 text-sm leading-5 text-tenue">Atajos a las áreas que solo puede gestionar el administrador TI.</p>
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <Button variant="secondary" className="justify-start" onClick={() => navigate("/soporte/dispositivos")}>
              <MonitorSmartphone className="size-4" aria-hidden /> Dispositivos
            </Button>
            <Button variant="secondary" className="justify-start" onClick={() => navigate("/soporte/personal")}>
              <Users className="size-4" aria-hidden /> Personal TI
            </Button>
            <Button variant="secondary" className="justify-start" onClick={() => navigate("/soporte/auditoria")}>
              <ScrollText className="size-4" aria-hidden /> Auditoría
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
