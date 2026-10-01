import { KeyRound, Settings, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router";
import { Badge, Button, Card, Spinner } from "../../components/ui";
import { CATEGORY_LABEL } from "../../lib/labels";
import { useMe } from "../../lib/session";
import { PageHeader } from "./PageHeader";

export function ProfilePage() {
  const { data: me, isLoading } = useMe();
  const navigate = useNavigate();

  if (isLoading) return <Spinner label="Cargando perfil" />;
  if (!me?.staff) return null;

  const staff = me.staff;
  const initials = staff.full_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const isAdmin = staff.role === "ADMIN";

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Mi perfil" description="Su cuenta dentro del área de soporte." />

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-linea p-4 sm:flex-row sm:items-center sm:p-5">
          <span className="grid size-14 shrink-0 place-items-center rounded-xl bg-casma text-lg font-bold text-white">{initials}</span>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold text-tinta">{staff.full_name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-[0.82rem] text-tenue">@{staff.username}</span>
              <Badge className={isAdmin ? "border-casma/30 bg-casma-claro text-casma-oscuro" : "border-linea bg-papel-2 text-tenue"}>
                <ShieldCheck className="size-3" aria-hidden /> {isAdmin ? "Administrador TI" : "Técnico"}
              </Badge>
            </div>
          </div>
        </div>

        <div className="panel-body">
          <p className="text-[0.68rem] font-bold uppercase tracking-[0.07em] text-tenue-2">Especialidades</p>
          <p className="mt-0.5 text-[0.8rem] text-tenue">La IA usa estas especialidades para sugerir a quién asignar cada caso.</p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {staff.specialties.length > 0
              ? staff.specialties.map((specialty) => (
                  <Badge key={specialty} className="border-linea bg-papel-2 text-tinta-2">{CATEGORY_LABEL[specialty]}</Badge>
                ))
              : <span className="text-[0.82rem] text-tenue">Sin especialidades registradas.</span>}
          </div>
        </div>
      </Card>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Button variant="secondary" className="justify-start" onClick={() => navigate("/soporte/clave")}>
          <KeyRound className="size-4" aria-hidden /> Cambiar contraseña
        </Button>
        <Button variant="secondary" className="justify-start" onClick={() => navigate("/soporte/configuracion")}>
          <Settings className="size-4" aria-hidden /> Preferencias del sistema
        </Button>
      </div>
    </div>
  );
}
