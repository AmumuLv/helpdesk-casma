import { KeyRound, Settings, ShieldCheck, UserRound } from "lucide-react";
import { useNavigate } from "react-router";
import { Button, Card, Spinner } from "../../components/ui";
import { CATEGORY_LABEL } from "../../lib/labels";
import { useMe } from "../../lib/session";

export function ProfilePage() {
  const { data: me, isLoading } = useMe();
  const navigate = useNavigate();

  if (isLoading) return <Spinner label="Cargando perfil" />;
  if (!me?.staff) return null;

  const staff = me.staff;
  const initials = staff.full_name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <div className="space-y-5 sm:space-y-6">
      <header className="flex flex-col gap-2">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-casma-oscuro">Cuenta</p>
        <h1 className="text-2xl font-bold tracking-tight text-tinta sm:text-3xl">Mi perfil</h1>
        <p className="max-w-2xl text-sm leading-6 text-tenue sm:text-base">
          Revise la información de su cuenta y acceda a las opciones de seguridad y configuración.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)]">
        <Card className="overflow-hidden">
          <div className="border-b border-linea bg-slate-50/80 p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-[#EAB308] text-xl font-bold text-[#111827] shadow-sm">
                {initials}
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-xl font-bold text-tinta sm:text-2xl">{staff.full_name}</h2>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-tenue">
                  <span>@{staff.username}</span>
                  <span aria-hidden>·</span>
                  <span className="inline-flex items-center gap-1.5 font-semibold text-tinta">
                    <ShieldCheck className="size-4 text-amber-600" aria-hidden />
                    {staff.role === "ADMIN" ? "Administrador TI" : "Técnico"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
            <div className="rounded-xl border border-linea bg-white p-4">
              <p className="text-xs font-bold uppercase tracking-[0.08em] text-tenue">Usuario</p>
              <p className="mt-1.5 break-words text-base font-bold text-tinta">{staff.username}</p>
            </div>
            <div className="rounded-xl border border-linea bg-white p-4">
              <p className="text-xs font-bold uppercase tracking-[0.08em] text-tenue">Rol</p>
              <p className="mt-1.5 text-base font-bold text-tinta">{staff.role === "ADMIN" ? "Administrador TI" : "Técnico"}</p>
            </div>
            <div className="rounded-xl border border-linea bg-white p-4 sm:col-span-2">
              <p className="text-xs font-bold uppercase tracking-[0.08em] text-tenue">Especialidades</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {staff.specialties.length > 0 ? (
                  staff.specialties.map((specialty) => (
                    <span key={specialty} className="rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">
                      {CATEGORY_LABEL[specialty]}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-tenue">Sin especialidades registradas.</span>
                )}
              </div>
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-700">
                <UserRound className="size-5" aria-hidden />
              </span>
              <div>
                <h2 className="text-lg font-bold text-tinta">Cuenta administrativa</h2>
                <p className="mt-1 text-sm leading-5 text-tenue">El perfil del sidebar abre esta página para evitar duplicar su información en el encabezado.</p>
              </div>
            </div>
          </Card>

          <Card className="p-5 sm:p-6">
            <h2 className="text-lg font-bold text-tinta">Acciones de cuenta</h2>
            <p className="mt-1 text-sm leading-5 text-tenue">Administre su seguridad y sus preferencias del panel.</p>
            <div className="mt-4 grid gap-2">
              <Button variant="secondary" className="w-full justify-start" onClick={() => navigate("/soporte/clave")}>
                <KeyRound className="size-4" aria-hidden /> Cambiar contraseña
              </Button>
              <Button variant="secondary" className="w-full justify-start" onClick={() => navigate("/soporte/configuracion")}>
                <Settings className="size-4" aria-hidden /> Configuración
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
