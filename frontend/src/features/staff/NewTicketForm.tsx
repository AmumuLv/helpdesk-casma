import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PhoneCall, Sparkles, WifiOff } from "lucide-react";
import { useDeferredValue, useState, type FormEvent } from "react";
import { PhotoPicker } from "../../components/PhotoPicker";
import { useToast } from "../../components/Toasts";
import { Button, Card, ErrorBox, Field, Input, Select, Textarea } from "../../components/ui";
import { api, errorMessage, isOfflineQueued, type OfflineQueuedResponse } from "../../lib/api";
import { CATEGORIES, CATEGORY_LABEL, EQUIPMENT_LABEL, pct, PRIORITY_LABEL } from "../../lib/labels";
import type { AIAnalysis, Ticket } from "../../lib/types";
import { useEquipmentList, useOfficeLookup, useTechnicians } from "./hooks";

const EMPTY = { officeId: "", equipmentId: "", description: "", reporter: "", phone: "", category: "", priority: "", technician: "" };

export function NewTicketForm({ onCreated }: { onCreated: (id: string) => void }) {
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
      const optional: [string, string][] = [["equipment_id", f.equipmentId], ["reporter_name", f.reporter.trim()], ["contact_phone", f.phone.trim()],
        ["category", f.category], ["priority", f.priority], ["technician_id", f.technician]];
      optional.forEach(([k, v]) => v && form.set(k, v));
      if (photo) form.set("photo", photo);
      return api<Ticket | OfflineQueuedResponse>("/tickets", { form });
    },
    onSuccess: (result) => {
      if (isOfflineQueued(result)) {
        toast({
          tone: "success",
          title: "Incidencia guardada sin conexión",
          body: "Quedó pendiente de sincronización y se enviará automáticamente.",
        });
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

  return (
    <Card className="lg:sticky lg:top-32">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-2 p-4 text-left lg:pointer-events-none" aria-expanded={open}>
        <span className="flex items-center gap-2 text-xl font-bold"><PhoneCall className="size-5 text-casma" /> Registrar incidencia</span>
        <span className="text-sm text-casma lg:hidden">{open ? "Ocultar" : "Abrir"}</span>
      </button>
      <form onSubmit={submit} className={`${open ? "flex" : "hidden"} flex-col gap-4 border-t border-linea p-4 lg:flex`}>
        <Field label="Oficina">
          {(id) => (
            <Select id={id} value={f.officeId} onChange={set("officeId")} required>
              <option value="">Seleccione la oficina</option>
              {offices.data?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Equipo">
          {(id) => (
            <Select id={id} value={f.equipmentId} onChange={set("equipmentId")} disabled={!f.officeId}>
              <option value="">Sin especificar</option>
              {equipment.data?.map((e) => <option key={e.id} value={e.id}>{e.patrimonial_code}: {EQUIPMENT_LABEL[e.type]} {e.brand ?? ""} {e.ip_address ? `(${e.ip_address})` : ""}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Descripción del problema">
          {(id) => <Textarea id={id} rows={4} value={f.description} onChange={set("description")} minLength={3} maxLength={2000} required placeholder="Lo que informa el usuario" />}
        </Field>

        {(ai || preview.isFetching) && (
          <div className="flex flex-col gap-2 rounded-xl bg-casma-claro p-3 text-sm" aria-live="polite">
            <p className="flex items-center gap-1.5 font-bold text-casma-oscuro"><Sparkles className="size-4" /> {preview.isFetching && !ai ? "Analizando..." : "Sugerencia de la IA"}</p>
            {ai && <>
              <p>{CATEGORY_LABEL[ai.category]} ({pct(ai.category_confidence)}), prioridad {PRIORITY_LABEL[ai.priority].toLowerCase()}{ai.suggested_technician_name && `, técnico: ${ai.suggested_technician_name}`}</p>
              {ai.similar_cases[0]?.resolution && <p className="text-tenue">Caso parecido: {ai.similar_cases[0].resolution}</p>}
              {ai.related_alert && <p className="font-bold text-alerta">{ai.related_alert}</p>}
              <Button type="button" size="sm" variant="secondary" className="w-fit"
                onClick={() => setF((s) => ({ ...s, category: ai.category, priority: ai.priority, technician: ai.suggested_technician_id ?? s.technician }))}>
                Usar sugerencia
              </Button>
            </>}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
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
                <option value="BAJA">Baja</option><option value="MEDIA">Media</option><option value="ALTA">Urgente</option>
              </Select>
            )}
          </Field>
          <Field label="Reporta">{(id) => <Input id={id} value={f.reporter} onChange={set("reporter")} maxLength={80} />}</Field>
          <Field label="Teléfono / anexo">{(id) => <Input id={id} value={f.phone} onChange={set("phone")} maxLength={20} inputMode="tel" />}</Field>
        </div>
        <Field label="Asignar a">
          {(id) => (
            <Select id={id} value={f.technician} onChange={set("technician")}>
              <option value="">Sin asignar</option>
              {techs.data?.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.full_name} ({t.open_tickets} abiertos)</option>)}
            </Select>
          )}
        </Field>
        <PhotoPicker value={photo} onChange={setPhoto} />
        {!navigator.onLine && (
          <div className="flex items-center gap-2 rounded-xl border border-sol bg-sol-claro p-3 text-sm">
            <WifiOff className="size-5 shrink-0" />
            <span><strong>Sin conexión.</strong> Puede registrar la incidencia; quedará guardada en este equipo hasta recuperar internet.</span>
          </div>
        )}
        {create.error && <ErrorBox message={errorMessage(create.error)} />}
        <Button type="submit" size="lg" loading={create.isPending}>Registrar</Button>
      </form>
    </Card>
  );
}
