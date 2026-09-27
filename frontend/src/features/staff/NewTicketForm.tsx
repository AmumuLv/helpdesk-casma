import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers3, PhoneCall, Sparkles, UserRoundPlus, WifiOff, Wrench } from "lucide-react";
import { useDeferredValue, useState, type FormEvent, type ReactNode } from "react";
import { PhotoPicker } from "../../components/PhotoPicker";
import { useToast } from "../../components/Toasts";
import { Button, Card, ErrorBox, Field, Input, Select, Textarea } from "../../components/ui";
import { api, errorMessage, isOfflineQueued, type OfflineQueuedResponse } from "../../lib/api";
import { CATEGORIES, CATEGORY_LABEL, EQUIPMENT_LABEL, pct, PRIORITY_LABEL } from "../../lib/labels";
import type { AIAnalysis, Ticket } from "../../lib/types";
import { useEquipmentList, useOfficeLookup, useTechnicians } from "./hooks";

const EMPTY = { officeId: "", equipmentId: "", description: "", reporter: "", phone: "", category: "", priority: "", technician: "" };

export function NewTicketForm({ onCreated, variant = "panel" }: { onCreated: (id: string) => void; variant?: "panel" | "modal" }) {
  const [f, setF] = useState(EMPTY);
  const [photo, setPhoto] = useState<File | null>(null);
  const [open, setOpen] = useState(false);
  const offices = useOfficeLookup();
  const equipment = useEquipmentList(f.officeId);
  const techs = useTechnicians();
  const qc = useQueryClient();
  const toast = useToast();
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value, ...(k === "officeId" ? { equipmentId: "" } : {}) }));

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
      const optional: [string, string][] = [["equipment_id", f.equipmentId], ["reporter_name", f.reporter.trim()], ["contact_phone", f.phone.trim()], ["category", f.category], ["priority", f.priority], ["technician_id", f.technician]];
      optional.forEach(([k, v]) => v && form.set(k, v));
      if (photo) form.set("photo", photo);
      return api<Ticket | OfflineQueuedResponse>("/tickets", { form });
    },
    onSuccess: (result) => {
      if (isOfflineQueued(result)) {
        toast({ tone: "success", title: "Incidencia guardada sin conexión", body: "Quedó pendiente de sincronización y se enviará automáticamente." });
        setF((s) => ({ ...EMPTY, officeId: s.officeId }));
        setPhoto(null);
        return;
      }
      qc.invalidateQueries({ queryKey: ["tickets"] });
      qc.invalidateQueries({ queryKey: ["kpis"] });
      toast({ tone: "success", title: `Incidencia ${result.number} registrada`, body: result.subject });
      setF((s) => ({ ...EMPTY, officeId: s.officeId }));
      setPhoto(null);
      onCreated(result.id);
    },
  });

  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate(); };
  const ai = preview.data;

  const formBody = (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <SectionBlock icon={<PhoneCall className="size-4" />} title="Datos principales" subtitle="Información básica del reporte">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Oficina" className="md:col-span-2">
            {(id) => (
              <Select id={id} value={f.officeId} onChange={set("officeId")} required>
                <option value="">Seleccione la oficina</option>
                {offices.data?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Equipo" className="md:col-span-2">
            {(id) => (
              <Select id={id} value={f.equipmentId} onChange={set("equipmentId")} disabled={!f.officeId}>
                <option value="">Sin especificar</option>
                {equipment.data?.map((e) => <option key={e.id} value={e.id}>{e.patrimonial_code}: {EQUIPMENT_LABEL[e.type]} {e.brand ?? ""} {e.ip_address ? `(${e.ip_address})` : ""}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Descripción del problema" className="md:col-span-2">
            {(id) => <Textarea id={id} rows={5} value={f.description} onChange={set("description")} minLength={3} maxLength={2000} required placeholder="Describa de forma breve qué informa el usuario" />}
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

      <SectionBlock icon={<Layers3 className="size-4" />} title="Clasificación y contacto" subtitle="Prioridad, categoría y datos del usuario">
        <div className="grid gap-4 md:grid-cols-2">
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
          <Field label="Reporta">{(id) => <Input id={id} value={f.reporter} onChange={set("reporter")} maxLength={80} placeholder="Nombre" />}</Field>
          <Field label="Teléfono / anexo">{(id) => <Input id={id} value={f.phone} onChange={set("phone")} maxLength={20} inputMode="tel" placeholder="Opcional" />}</Field>
        </div>
      </SectionBlock>

      <SectionBlock icon={<UserRoundPlus className="size-4" />} title="Responsable de atención" subtitle="Asignación opcional de técnico">
        <Field label="Asignar a">
          {(id) => (
            <Select id={id} value={f.technician} onChange={set("technician")}>
              <option value="">Sin asignar</option>
              {techs.data?.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.full_name} ({t.open_tickets} abiertos)</option>)}
            </Select>
          )}
        </Field>
      </SectionBlock>

      <div className="rounded-2xl border border-linea bg-papel/75 p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-xl bg-white text-casma shadow-sm"><Wrench className="size-4" /></span>
          <div>
            <p className="text-sm font-bold text-tinta">Adjunto y evidencia</p>
            <p className="text-xs text-tenue">Puede agregar una foto para apoyar la atención.</p>
          </div>
        </div>
        <PhotoPicker value={photo} onChange={setPhoto} />
      </div>

      {!navigator.onLine && (
        <div className="flex items-center gap-2 rounded-2xl border border-sol/55 bg-sol-claro px-4 py-3 text-sm text-[#92400e] shadow-sm">
          <WifiOff className="size-5 shrink-0" />
          <span><strong>Sin conexión.</strong> Puede registrar la incidencia; quedará guardada en este equipo hasta recuperar internet.</span>
        </div>
      )}
      {create.error && <ErrorBox message={errorMessage(create.error)} />}
      <div className="flex justify-end">
        <Button type="submit" size="lg" className="min-w-52" loading={create.isPending}>Registrar incidencia</Button>
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
            <span className="mt-0.5 block text-xs font-medium text-tenue">Nuevo reporte para atención de soporte</span>
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
