import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ClipboardCheck, Layers3, MapPin, PhoneCall, Search, Sparkles, UserRound, UserRoundPlus, WifiOff, Wrench } from "lucide-react";
import { useDeferredValue, useState, type FormEvent, type ReactNode } from "react";
import { PhotoPicker } from "../../components/PhotoPicker";
import { useToast } from "../../components/Toasts";
import { Button, Card, ErrorBox, Field, Input, Select, Textarea, cx } from "../../components/ui";
import { api, errorMessage, isOfflineQueued, type OfflineQueuedResponse } from "../../lib/api";
import { CATEGORIES, CATEGORY_LABEL, EQUIPMENT_LABEL, pct, PRIORITY_LABEL } from "../../lib/labels";
import type { AIAnalysis, MunicipalUser, Ticket } from "../../lib/types";
import { useEquipmentList, useMunicipalUsers, useOfficeLookup, useTechnicians, useZones } from "./hooks";

const EMPTY = {
  zoneId: "",
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
  const [reporterMode, setReporterMode] = useState<"registered" | "manual">("registered");
  const [userSearch, setUserSearch] = useState("");

  const zones = useZones();
  const offices = useOfficeLookup();
  const users = useMunicipalUsers(f.officeId);
  const equipment = useEquipmentList(f.officeId);
  const techs = useTechnicians();
  const qc = useQueryClient();
  const toast = useToast();

  const selectedZone = zones.data?.find((zone) => zone.id === f.zoneId);
  const selectedOffice = offices.data?.find((office) => office.id === f.officeId);
  const selectedUser = users.data?.find((user) => user.id === f.userId);
  const selectedEquipment = equipment.data?.find((item) => item.id === f.equipmentId);
  const selectedTech = techs.data?.find((tech) => tech.id === f.technician);

  const availableZones = (zones.data ?? []).filter((zone) => zone.active);
  const availableOffices = (offices.data ?? []).filter((office) => office.zone_id === f.zoneId);
  const normalizedSearch = userSearch.trim().toLocaleLowerCase("es-PE");
  const filteredUsers = (users.data ?? []).filter((user) => {
    if (!normalizedSearch) return true;
    return [user.full_name, user.employee_code, user.job_title, user.email, user.phone]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("es-PE")
      .includes(normalizedSearch);
  });

  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  const setZone = (e: { target: { value: string } }) => {
    const zoneId = e.target.value;
    setValidationError(null);
    setUserSearch("");
    setReporterMode("registered");
    setF((s) => ({ ...s, zoneId, officeId: "", userId: "", equipmentId: "", reporter: "", phone: "" }));
  };

  const setOffice = (e: { target: { value: string } }) => {
    const officeId = e.target.value;
    setValidationError(null);
    setUserSearch("");
    setReporterMode("registered");
    setF((s) => ({ ...s, officeId, userId: "", equipmentId: "", reporter: "", phone: "" }));
  };

  const chooseUser = (user: MunicipalUser) => {
    const storedPhone = (user.phone ?? "").replace(/\D/g, "");
    setValidationError(null);
    setF((s) => ({
      ...s,
      userId: user.id,
      reporter: user.full_name,
      phone: storedPhone.length === 9 ? storedPhone : "",
    }));
  };

  const useManualReporter = () => {
    setReporterMode("manual");
    setUserSearch("");
    setValidationError(null);
    setF((s) => ({ ...s, userId: "", reporter: "", phone: "" }));
  };

  const useRegisteredReporter = () => {
    setReporterMode("registered");
    setValidationError(null);
    setF((s) => ({ ...s, userId: "", reporter: "", phone: "" }));
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
      setUserSearch("");
      setReporterMode("registered");
      if (isOfflineQueued(result)) {
        toast({ tone: "success", title: "Incidencia guardada sin conexión", body: "Quedó pendiente de sincronización y se enviará automáticamente." });
        setF((s) => ({ ...EMPTY, zoneId: s.zoneId, officeId: s.officeId, channel: s.channel }));
        setPhoto(null);
        return;
      }
      qc.invalidateQueries({ queryKey: ["tickets"] });
      qc.invalidateQueries({ queryKey: ["kpis"] });
      toast({ tone: "success", title: `Incidencia ${result.number} registrada`, body: result.subject });
      setF((s) => ({ ...EMPTY, zoneId: s.zoneId, officeId: s.officeId, channel: s.channel }));
      setPhoto(null);
      onCreated(result.id);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!f.zoneId) {
      setValidationError("Seleccione primero la zona donde se origina la incidencia.");
      return;
    }
    if (!f.officeId) {
      setValidationError("Seleccione una oficina de la zona elegida.");
      return;
    }
    if (reporterMode === "registered" && !f.userId) {
      setValidationError("Seleccione un usuario registrado o cambie a ingreso manual.");
      return;
    }
    if (!f.reporter.trim()) {
      setValidationError("Indique quién reporta la incidencia.");
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
            <p className="mt-1 text-sm leading-5 text-tenue">Confirme la ruta Zona → Oficina → Usuario y los datos de atención antes de crear la incidencia.</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <ReviewItem label="Zona" value={selectedZone?.name ?? "—"} detail={selectedZone?.code ? `Código: ${selectedZone.code}` : undefined} />
        <ReviewItem label="Oficina" value={selectedOffice?.name ?? "—"} detail={selectedOffice?.location ?? undefined} />
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
        <p className="mt-1">Úselo cuando el reporte llega por teléfono, presencialmente o cuando TI detecta el problema. La ubicación se selecciona respetando la jerarquía institucional: zona, oficina y finalmente usuario.</p>
      </div>

      <SectionBlock icon={<MapPin className="size-4" />} title="1. Ubicación y solicitante" subtitle="Siga el orden Zona → Oficina → Usuario para evitar registros en áreas equivocadas">
        <div className="mb-5 grid gap-2 sm:grid-cols-3">
          <HierarchyStep number="1" label="Zona" active={!!f.zoneId} />
          <HierarchyStep number="2" label="Oficina" active={!!f.officeId} disabled={!f.zoneId} />
          <HierarchyStep number="3" label="Usuario" active={!!f.userId || (reporterMode === "manual" && !!f.reporter)} disabled={!f.officeId} />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Zona" hint="Ejemplo: Complejo. Este filtro determina qué oficinas puede seleccionar.">
            {(id) => (
              <Select id={id} value={f.zoneId} onChange={setZone} required>
                <option value="">Seleccione la zona</option>
                {availableZones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
              </Select>
            )}
          </Field>

          <Field label="Oficina" hint={f.zoneId ? `${availableOffices.length} oficina${availableOffices.length === 1 ? "" : "s"} disponible${availableOffices.length === 1 ? "" : "s"} en esta zona.` : "Primero seleccione una zona."}>
            {(id) => (
              <Select id={id} value={f.officeId} onChange={setOffice} required disabled={!f.zoneId}>
                <option value="">{f.zoneId ? "Seleccione la oficina" : "Seleccione primero la zona"}</option>
                {availableOffices.map((office) => <option key={office.id} value={office.id}>{office.name}</option>)}
              </Select>
            )}
          </Field>

          {selectedZone && selectedOffice && (
            <div className="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-700">
              <span className="font-bold text-slate-900">Ruta seleccionada:</span> {selectedZone.name} <span className="px-1.5 text-slate-400">›</span> {selectedOffice.name}
              {selectedOffice.location && <span className="ml-2 text-slate-500">· {selectedOffice.location}</span>}
            </div>
          )}

          <div className="md:col-span-2">
            <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-bold tracking-[-0.01em] text-tinta">Usuario que reporta</p>
                <p className="mt-1 text-xs leading-5 text-tenue">Seleccione una cuenta de la oficina o registre manualmente a quien llamó.</p>
              </div>
              <div className="inline-flex w-full rounded-xl border border-linea bg-slate-50 p-1 sm:w-auto">
                <button
                  type="button"
                  onClick={useRegisteredReporter}
                  disabled={!f.officeId}
                  className={cx(
                    "min-h-9 flex-1 rounded-lg px-3 text-xs font-bold transition sm:flex-none",
                    reporterMode === "registered" ? "bg-white text-casma-oscuro shadow-sm" : "text-tenue hover:text-tinta",
                    !f.officeId && "cursor-not-allowed opacity-50",
                  )}
                >
                  Usuario registrado
                </button>
                <button
                  type="button"
                  onClick={useManualReporter}
                  disabled={!f.officeId}
                  className={cx(
                    "min-h-9 flex-1 rounded-lg px-3 text-xs font-bold transition sm:flex-none",
                    reporterMode === "manual" ? "bg-white text-casma-oscuro shadow-sm" : "text-tenue hover:text-tinta",
                    !f.officeId && "cursor-not-allowed opacity-50",
                  )}
                >
                  Ingreso manual
                </button>
              </div>
            </div>

            {!f.officeId ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-tenue">
                Seleccione una zona y una oficina para ver sus usuarios.
              </div>
            ) : reporterMode === "registered" ? (
              <div className="space-y-3 rounded-2xl border border-linea bg-slate-50/60 p-3.5">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-tenue" aria-hidden />
                  <Input
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Buscar por nombre, código, cargo, correo o teléfono"
                    className="bg-white pl-10"
                    aria-label="Buscar usuario de la oficina"
                  />
                </div>

                {users.isLoading ? (
                  <p className="px-2 py-5 text-center text-sm text-tenue">Cargando usuarios de la oficina…</p>
                ) : filteredUsers.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center">
                    <p className="text-sm font-bold text-tinta">No se encontraron usuarios</p>
                    <p className="mt-1 text-xs leading-5 text-tenue">Puede cambiar a “Ingreso manual” si la persona aún no tiene cuenta registrada.</p>
                  </div>
                ) : (
                  <div className="grid max-h-72 gap-2 overflow-y-auto pr-1 md:grid-cols-2">
                    {filteredUsers.map((user) => {
                      const active = f.userId === user.id;
                      return (
                        <button
                          key={user.id}
                          type="button"
                          onClick={() => chooseUser(user)}
                          className={cx(
                            "flex min-h-20 items-start gap-3 rounded-xl border bg-white p-3 text-left transition",
                            active
                              ? "border-casma bg-casma-claro/45 ring-2 ring-casma/10"
                              : "border-slate-200 hover:border-slate-300 hover:bg-white",
                          )}
                          aria-pressed={active}
                        >
                          <span className={cx("grid size-9 shrink-0 place-items-center rounded-xl", active ? "bg-casma text-white" : "bg-slate-100 text-slate-600")}>
                            {active ? <CheckCircle2 className="size-4" /> : <UserRound className="size-4" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-bold text-tinta">{user.full_name}</span>
                            <span className="mt-0.5 block truncate text-xs text-tenue">{user.job_title ?? "Cargo no registrado"}</span>
                            <span className="mt-1 block truncate text-[11px] font-medium text-slate-500">
                              {user.employee_code ? `Código ${user.employee_code}` : "Sin código"}
                              {user.phone ? ` · ${user.phone}` : ""}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {selectedUser && (
                  <div className="grid gap-3 rounded-xl border border-casma/15 bg-casma-claro/40 p-3.5 sm:grid-cols-[1fr_13rem] sm:items-end">
                    <div className="min-w-0">
                      <p className="text-xs font-bold uppercase tracking-[0.08em] text-casma-oscuro">Usuario seleccionado</p>
                      <p className="mt-1 truncate text-sm font-bold text-tinta">{selectedUser.full_name}</p>
                      <p className="mt-0.5 truncate text-xs text-tenue">{selectedUser.email ?? selectedUser.job_title ?? "Cuenta municipal"}</p>
                    </div>
                    <Field label="Celular de contacto" hint="9 dígitos; puede corregirse solo para esta incidencia.">
                      {(id) => <Input id={id} value={f.phone} onChange={setPhone} maxLength={9} inputMode="numeric" pattern="[0-9]{9}" placeholder="987654321" className="bg-white" />}
                    </Field>
                  </div>
                )}
              </div>
            ) : (
              <div className="grid gap-4 rounded-2xl border border-linea bg-slate-50/60 p-3.5 md:grid-cols-2">
                <Field label="Nombre de quien reporta" hint="Para personas que aún no cuentan con usuario registrado.">
                  {(id) => <Input id={id} value={f.reporter} onChange={set("reporter")} maxLength={80} required placeholder="Nombre y apellido" className="bg-white" />}
                </Field>
                <Field label="Celular" hint="Opcional. Si se ingresa, debe tener 9 dígitos.">
                  {(id) => <Input id={id} value={f.phone} onChange={setPhone} maxLength={9} inputMode="numeric" pattern="[0-9]{9}" placeholder="987654321" className="bg-white" />}
                </Field>
              </div>
            )}
          </div>
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

function HierarchyStep({ number, label, active, disabled = false }: { number: string; label: string; active: boolean; disabled?: boolean }) {
  return (
    <div className={cx(
      "flex items-center gap-2 rounded-xl border px-3 py-2.5 transition",
      active ? "border-casma/25 bg-casma-claro/55 text-casma-oscuro" : disabled ? "border-slate-200 bg-slate-50 text-slate-400" : "border-slate-200 bg-white text-slate-600",
    )}>
      <span className={cx(
        "grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold",
        active ? "bg-casma text-white" : "bg-slate-200 text-slate-600",
      )}>{number}</span>
      <span className="text-xs font-bold uppercase tracking-[0.06em]">{label}</span>
    </div>
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
