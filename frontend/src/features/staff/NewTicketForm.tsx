import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, ClipboardCheck, Layers3, PhoneCall, Sparkles, UserRound, UserRoundPlus, WifiOff, Wrench } from "lucide-react";
import { useDeferredValue, useState, type FormEvent, type ReactNode } from "react";
import { PhotoPicker } from "../../components/PhotoPicker";
import { useToast } from "../../components/Toasts";
import { Button, Card, ErrorBox, Field, Input, Select, Textarea } from "../../components/ui";
import { api, errorMessage, isOfflineQueued, type OfflineQueuedResponse } from "../../lib/api";
import { CATEGORIES, CATEGORY_LABEL, EQUIPMENT_LABEL, pct, PRIORITY_LABEL } from "../../lib/labels";
import type { AIAnalysis, Ticket } from "../../lib/types";
import { useEquipmentList, useMunicipalUsers, useOfficeLookup, useTechnicians } from "./hooks";

const EMPTY = {
  officeId: "",
  userId: "",
  equipmentId: "",
  description: "",
  reporter: "",
  phone: "",
  channel: "TELEFONO",
  category: "",
  priority: "",
  technician: "",
};

const CHANNEL_LABEL: Record<string, string> = {
  TELEFONO: "Teléfono",
  PRESENCIAL: "Presencial",
  INTERNO: "Detectado por TI",
};

export function NewTicketForm({ onCreated, variant = "panel" }: { onCreated: (id: string) => void; variant?: "panel" | "modal" }) {
  const [f, setF] = useState(EMPTY);
  const [photo, setPhoto] = useState<File | null>(null);
  const [open, setOpen] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const offices = useOfficeLookup();
  const users = useMunicipalUsers(f.officeId);
  const equipment = useEquipmentList(f.officeId);
  const techs = useTechnicians();
  const qc = useQueryClient();
  const toast = useToast();

  const selectedOffice = offices.data?.find((office) => office.id === f.officeId);
  const selectedUser = users.data?.find((user) => user.id === f.userId);
  const selectedEquipment = equipment.data?.find((item) => item.id === f.equipmentId);
  const selectedTech = techs.data?.find((tech) => tech.id === f.technician);

  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  const setOffice = (e: { target: { value: string } }) => {
    const officeId = e.target.value;
    setValidationError(null);
    setF((s) => ({ ...s, officeId, userId: "", equipmentId: "", reporter: "", phone: "" }));
  };

  const setUser = (e: { target: { value: string } }) => {
    const userId = e.target.value;
    const user = users.data?.find((item) => item.id === userId);
    const storedPhone = (user?.phone ?? "").replace(/\D/g, "");
    setValidationError(null);
    setF((s) => ({
      ...s,
      userId,
      reporter: user?.full_name ?? "",
      phone: storedPhone.length === 9 ? storedPhone : "",
    }));
  };

  const setPhone = (e: { target: { value: string } }) => {
    const phone = e.target.value.replace(/\D/g, "").slice(0, 9);
    setValidationError(null);
    setF((s) => ({ ...s, phone }));
  };

  const text = useDeferredValue(f.description.trim());
  const preview = useQuery({
    queryKey: ["triage-preview", f.officeId, f.equipmentId, text],
    queryFn: ({ signal }) => api<AIAnalysis>("/tickets/triage-preview", { json: { office_id: f.officeId, equipment_id: f.equipmentId || null, description: text }, signal }),
    enabled: !!f.officeId && text.length >= 12,
    staleTime: 60_000,
  });

  const create = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.set("office_id", f.officeId);
      form.set("description", f.description.trim());
      form.set("channel", f.channel);
      const optional: [string, string][] = [
        ["municipal_user_id", f.userId],
        ["equipment_id", f.equipmentId],
        ["reporter_name", f.reporter.trim()],
        ["contact_phone", f.phone.trim()],
        ["category", f.category],
        ["priority", f.priority],
        ["technician_id", f.technician],
      ];
      optional.forEach(([k, v]) => v && form.set(k, v));
      if (photo) form.set("photo", photo);
      return api<Ticket | OfflineQueuedResponse>("/tickets", { form });
    },
    onSuccess: (result) => {
      setReviewing(false);
      if (isOfflineQueued(result)) {
        toast({ tone: "success", title: "Incidencia guardada sin conexión", body: "Quedó pendiente de sincronización y se enviará automáticamente." });
        setF((s) => ({ ...EMPTY, officeId: s.officeId, channel: s.channel }));
        setPhoto(null);
        return;
      }
      qc.invalidateQueries({ queryKey: ["tickets"] });
      qc.invalidateQueries({ queryKey: ["kpis"] });
      toast({ tone: "success", title: `Incidencia ${result.number} registrada`, body: result.subject });
      setF((s) => ({ ...EMPTY, officeId: s.officeId, channel: s.channel }));
      setPhoto(null);
      onCreated(result.id);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!f.reporter.trim()) {
      setValidationError("Indique quién reporta la incidencia o seleccione un usuario registrado.");
      return;
    }
    if (f.phone && f.phone.length !== 9) {
      setValidationError("El celular debe tener exactamente 9 dígitos.");
      return;
    }
    setValidationError(null);
    setReviewing(true);
  };

  const ai = preview.data;

  const formBody = reviewing ? (
    <div className="space-y-5">
      <div className="rounded-2xl border border-casma/20 bg-casma-claro/55 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-casma text-white shadow-sm"><ClipboardCheck className="size-5" /></span>
          <div>
            <p className="font-bold text-tinta">Revise antes de registrar</p>
            <p className="mt-1 text-sm leading-5 text-tenue">Este paso evita incidencias con oficina, usuario o contacto equivocados.</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ReviewItem label="Oficina" value={selectedOffice?.name ?? "—"} detail={selectedOffice?.zone_name ? `Zona: ${selectedOffice.zone_name}` : "Sin zona asignada"} />
        <ReviewItem label="Usuario que reporta" value={selectedUser?.full_name ?? f.reporter} detail={selectedUser?.job_title ?? (f.userId ? "Usuario registrado" : "Registro manual")} />
        <ReviewItem label="Canal" value={CHANNEL_LABEL[f.channel] ?? f.channel} detail={f.phone ? `Celular: ${f.phone}` : "Sin celular registrado"} />
        <ReviewItem label="Equipo" value={selectedEquipment ? `${selectedEquipment.patrimonial_code} · ${EQUIPMENT_LABEL[selectedEquipment.type]}` : "Sin equipo específico"} detail={selectedEquipment?.brand ?? undefined} />
        <ReviewItem label="Clasificación" value={f.category ? CATEGORY_LABEL[f.category as keyof typeof CATEGORY_LABEL] : "Automática"} detail={f.priority ? `Prioridad: ${PRIORITY_LABEL[f.priority as keyof typeof PRIORITY_LABEL]}` : "Prioridad automática"} />
        <ReviewItem label="Responsable" value={selectedTech?.full_name ?? "Sin asignar"} detail={selectedTech ? `${selectedTech.open_tickets} incidencias abiertas` : "Disponible para asignación posterior"} />
      </div>

      <div className="rounded-2xl border border-linea bg-white p-4 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[0.1em] text-tenue">Descripción</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-tinta">{f.description.trim()}</p>
      </div>

      {create.error && <ErrorBox message={errorMessage(create.error)} />}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" size="lg" onClick={() => setReviewing(false)} disabled={create.isPending}>Volver a editar</Button>
        <Button type="button" size="lg" className="min-w-52" onClick={() => create.mutate()} loading={create.isPending}>Confirmar y registrar</Button>
      </div>
    </div>
  ) : (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div className="rounded-2xl border border-sky-200 bg-sky-50/70 p-4 text-sm leading-6 text-slate-700">
        <p className="font-bold text-slate-900">Registro manual asistido</p>
        <p className="mt-1">Úselo cuando el reporte llega por teléfono, de forma presencial o cuando el Área TI detecta el problema. Si el usuario puede reportarlo desde su propio acceso, conviene usar ese canal para conservar el origen automáticamente.</p>
      </div>

      <SectionBlock icon={<Building2 className="size-4" />} title="1. Oficina y solicitante" subtitle="Primero identifique dónde ocurre el problema y quién lo reporta">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Oficina" className="md:col-span-2">
            {(id) => (
              <Select id={id} value={f.officeId} onChange={setOffice} required>
                <option value="">Seleccione la oficina</option>
                {offices.data?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
            )}
          </Field>

          {selectedOffice && (
            <div className="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-700">
              <span className="font-bold text-slate-900">Zona detectada:</span> {selectedOffice.zone_name ?? "Sin zona asignada"}
              {selectedOffice.location && <span className="ml-2 text-slate-500">· {selectedOffice.location}</span>}
            </div>
          )}

          <Field label="Usuario registrado" className="md:col-span-2" hint="Si el trabajador está registrado, selecciónelo para vincular la incidencia a su cuenta.">
            {(id) => (
              <Select id={id} value={f.userId} onChange={setUser} disabled={!f.officeId || users.isLoading}>
                <option value="">No registrado / ingresar datos manualmente</option>
                {users.data?.map((user) => <option key={user.id} value={user.id}>{user.full_name}{user.job_title ? ` · ${user.job_title}` : ""}</option>)}
              </Select>
            )}
          </Field>

          {selectedUser && (
            <div className="md:col-span-2 flex items-start gap-3 rounded-xl border border-casma/15 bg-casma-claro/45 px-3.5 py-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white text-casma-oscuro shadow-sm"><UserRound className="size-4" /></span>
              <div className="min-w-0 text-sm">
                <p className="font-bold text-tinta">{selectedUser.full_name}</p>
                <p className="mt-0.5 text-tenue">{selectedUser.job_title ?? "Cargo no registrado"}{selectedUser.email ? ` · ${selectedUser.email}` : ""}</p>
              </div>
            </div>
          )}

          <Field label="Quién reporta">
            {(id) => <Input id={id} value={f.reporter} onChange={set("reporter")} maxLength={80} required readOnly={!!f.userId} placeholder="Nombre y apellido" className={f.userId ? "bg-slate-50" : undefined} />}
          </Field>
          <Field label="Celular" hint="Solo 9 dígitos; puede dejarlo vacío si no fue proporcionado.">
            {(id) => <Input id={id} value={f.phone} onChange={setPhone} maxLength={9} inputMode="numeric" pattern="[0-9]{9}" placeholder="987654321" autoComplete="tel" />}
          </Field>
        </div>
      </SectionBlock>

      <SectionBlock icon={<PhoneCall className="size-4" />} title="2. Detalle del problema" subtitle="Indique el equipo afectado y describa qué sucede">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Equipo afectado" className="md:col-span-2">
            {(id) => (
              <Select id={id} value={f.equipmentId} onChange={set("equipmentId")} disabled={!f.officeId}>
                <option value="">Sin equipo específico</option>
                {equipment.data?.map((e) => <option key={e.id} value={e.id}>{e.patrimonial_code}: {EQUIPMENT_LABEL[e.type]} {e.brand ?? ""} {e.ip_address ? `(${e.ip_address})` : ""}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Descripción del problema" className="md:col-span-2" hint="Incluya qué ocurre, desde cuándo y a quiénes afecta. La IA usa este texto para sugerir clasificación.">
            {(id) => (
              <div>
                <Textarea id={id} rows={6} value={f.description} onChange={set("description")} minLength={12} maxLength={2000} required placeholder="Ejemplo: La impresora de Tesorería no imprime desde esta mañana y muestra un error de conexión..." />
                <div className="mt-1.5 text-right text-xs font-medium text-tenue">{f.description.length}/2000</div>
              </div>
            )}
          </Field>
        </div>
      </SectionBlock>

      {(ai || preview.isFetching) && (
        <div className="rounded-2xl border border-casma/15 bg-casma-claro/70 p-4 shadow-sm" aria-live="polite">
          <p className="flex items-center gap-2 font-bold text-casma-oscuro"><Sparkles className="size-4" /> {preview.isFetching && !ai ? "Analizando incidencia..." : "Sugerencia de la IA"}</p>
          {ai && <>
            <p className="mt-2 text-sm leading-6 text-tinta/85">{CATEGORY_LABEL[ai.category]} ({pct(ai.category_confidence)}), prioridad {PRIORITY_LABEL[ai.priority].toLowerCase()}{ai.suggested_technician_name && `, técnico sugerido: ${ai.suggested_technician_name}`}</p>
            {ai.similar_cases[0]?.resolution && <p className="mt-1 text-sm text-tenue">Caso parecido: {ai.similar_cases[0].resolution}</p>}
            {ai.related_alert && <p className="mt-1 text-sm font-bold text-alerta">{ai.related_alert}</p>}
            <Button type="button" size="sm" variant="secondary" className="mt-3 w-fit"
              onClick={() => setF((s) => ({ ...s, category: ai.category, priority: ai.priority, technician: ai.suggested_technician_id ?? s.technician }))}>
              Usar sugerencia
            </Button>
          </>}
        </div>
      )}

      <SectionBlock icon={<Layers3 className="size-4" />} title="3. Gestión de la incidencia" subtitle="Origen, clasificación y responsable de atención">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Cómo llegó el reporte">
            {(id) => (
              <Select id={id} value={f.channel} onChange={set("channel")} required>
                <option value="TELEFONO">Teléfono</option>
                <option value="PRESENCIAL">Presencial</option>
                <option value="INTERNO">Detectado por TI</option>
              </Select>
            )}
          </Field>
          <Field label="Asignar a">
            {(id) => (
              <Select id={id} value={f.technician} onChange={set("technician")}>
                <option value="">Sin asignar</option>
                {techs.data?.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.full_name} ({t.open_tickets} abiertos)</option>)}
              </Select>
            )}
          </Field>
          <Field label="Categoría">
            {(id) => (
              <Select id={id} value={f.category} onChange={set("category")}>
                <option value="">Automática</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Prioridad">
            {(id) => (
              <Select id={id} value={f.priority} onChange={set("priority")}>
                <option value="">Automática</option>
                <option value="BAJA">Baja</option>
                <option value="MEDIA">Media</option>
                <option value="ALTA">Urgente</option>
              </Select>
            )}
          </Field>
        </div>
      </SectionBlock>

      <SectionBlock icon={<UserRoundPlus className="size-4" />} title="4. Evidencia" subtitle="Adjunte una foto si ayuda a diagnosticar más rápido">
        <div className="rounded-xl border border-linea bg-papel/65 p-3.5">
          <div className="mb-3 flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-xl bg-white text-casma shadow-sm"><Wrench className="size-4" /></span>
            <div>
              <p className="text-sm font-bold text-tinta">Foto opcional</p>
              <p className="text-xs text-tenue">Útil para errores en pantalla, conexiones, impresoras o daños visibles.</p>
            </div>
          </div>
          <PhotoPicker value={photo} onChange={setPhoto} />
        </div>
      </SectionBlock>

      {!navigator.onLine && (
        <div className="flex items-center gap-2 rounded-2xl border border-sol/55 bg-sol-claro px-4 py-3 text-sm text-[#92400e] shadow-sm">
          <WifiOff className="size-5 shrink-0" />
          <span><strong>Sin conexión.</strong> Puede preparar la incidencia; quedará guardada en este equipo hasta recuperar internet.</span>
        </div>
      )}
      {validationError && <ErrorBox message={validationError} />}
      {create.error && <ErrorBox message={errorMessage(create.error)} />}
      <div className="flex justify-end">
        <Button type="submit" size="lg" className="min-w-52">Revisar incidencia</Button>
      </div>
    </form>
  );

  if (variant === "modal") return formBody;

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 border-b border-linea bg-gradient-to-r from-casma-claro/75 to-white px-4 py-4 text-left sm:px-5 lg:pointer-events-none"
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-casma text-white shadow-sm">
            <PhoneCall className="size-5" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block text-lg font-bold tracking-tight text-tinta">Registrar incidencia</span>
            <span className="mt-0.5 block text-xs font-medium text-tenue">Registro manual asistido por el Área TI</span>
          </span>
        </span>
        <span className="rounded-lg border border-casma/15 bg-white px-2.5 py-1 text-xs font-bold text-casma lg:hidden">{open ? "Ocultar" : "Abrir"}</span>
      </button>
      <div className={`${open ? "block" : "hidden"} p-4 sm:p-5 lg:block`}>
        {formBody}
      </div>
    </Card>
  );
}

function SectionBlock({ icon, title, subtitle, children }: { icon: ReactNode; title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-linea bg-white p-4 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
      <div className="mb-4 flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-xl bg-casma-claro text-casma-oscuro">{icon}</span>
        <div>
          <p className="text-sm font-bold text-tinta">{title}</p>
          <p className="text-xs text-tenue">{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function ReviewItem({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-2xl border border-linea bg-white p-4 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-[0.1em] text-tenue">{label}</p>
      <p className="mt-1.5 font-bold text-tinta">{value}</p>
      {detail && <p className="mt-1 text-xs leading-5 text-tenue">{detail}</p>}
    </div>
  );
}
