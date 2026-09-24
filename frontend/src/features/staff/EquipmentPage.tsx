import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Monitor, Plus, Printer, QrCode, Upload } from "lucide-react";
import { useDeferredValue, useEffect, useState, type FormEvent } from "react";
import { useToast } from "../../components/Toasts";
import { Badge, Button, Card, cx, EmptyState, ErrorBox, Field, Input, Modal, PriorityBadge, Select, Spinner, StatusBadge, Textarea } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { CATEGORY_LABEL, EQUIPMENT_LABEL, EQUIPMENT_STATUS_LABEL, EQUIPMENT_TYPES, fmtDate, fmtDateTime, pct } from "../../lib/labels";
import type { Equipment, EquipmentImportOfficeRef, EquipmentImportResult, EquipmentStatus, EquipmentType, Ticket } from "../../lib/types";
import { useIsAdmin, useOfficeLookup } from "./hooks";
import { PageHeader } from "./PageHeader";

type Detail = { equipment: Equipment; risk: number | null; risk_factors: string[]; tickets: Ticket[] };

export function EquipmentPage() {
  const offices = useOfficeLookup();
  const isAdmin = useIsAdmin();
  const [officeId, setOfficeId] = useState("");
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  const query = useDeferredValue(q.trim());
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Equipment | "new" | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const list = useQuery({
    queryKey: ["equipment", "search", officeId, type, query],
    queryFn: () => {
      const p = new URLSearchParams();
      if (officeId) p.set("office_id", officeId);
      if (type) p.set("type", type);
      if (query) p.set("q", query);
      return api<Equipment[]>(`/equipment?${p}`);
    },
  });

  return (
    <div>
      <PageHeader title="Inventario de equipos" description="Código patrimonial, IP, especificaciones, historial de incidencias y riesgo de falla."
        actions={<>
          {isAdmin && <Button variant="secondary" onClick={() => setImportOpen(true)}><Upload className="size-4" /> Importar Margesí</Button>}
          <Button onClick={() => setEditing("new")}><Plus className="size-4" /> Nuevo equipo</Button>
        </>} />
      <Card className="mb-4 grid gap-3 p-3 sm:grid-cols-3">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código, IP, marca, hostname o serie" aria-label="Buscar equipos" />
        <Select value={officeId} onChange={(e) => setOfficeId(e.target.value)} aria-label="Oficina">
          <option value="">Todas las oficinas</option>
          {offices.data?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </Select>
        <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Tipo">
          <option value="">Todos los tipos</option>
          {EQUIPMENT_TYPES.map((t) => <option key={t} value={t}>{EQUIPMENT_LABEL[t]}</option>)}
        </Select>
      </Card>
      {list.isLoading ? <Spinner /> : list.error ? <ErrorBox message={errorMessage(list.error)} /> : !list.data?.length ? (
        <Card><EmptyState icon={<Monitor />} title="No se encontraron equipos" /></Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-linea bg-papel text-tenue">
              <tr><th className="p-3">Código patrimonial</th><th className="p-3">Equipo</th><th className="p-3">Oficina</th><th className="p-3">IP / hostname</th><th className="p-3">Estado</th><th className="p-3" /></tr>
            </thead>
            <tbody className="divide-y divide-linea">
              {list.data.map((e) => (
                <tr key={e.id} className="cursor-pointer hover:bg-papel" onClick={() => setSelected(e.id)}>
                  <td className="p-3 font-bold">{e.patrimonial_code}</td>
                  <td className="p-3">{EQUIPMENT_LABEL[e.type]}<p className="text-tenue">{[e.brand, e.model].filter(Boolean).join(" ") || "–"}</p></td>
                  <td className="p-3">{e.office_name ?? "Sin asignar"}</td>
                  <td className="p-3">{e.ip_address ?? "–"}<p className="text-tenue">{e.hostname}</p></td>
                  <td className="p-3"><EquipmentStatusBadge status={e.status} />{e.criticality === 3 && <Badge className="ml-1 border-alerta/40 text-alerta">Crítico</Badge>}</td>
                  <td className="p-3 text-right"><Button size="sm" variant="ghost">Ver</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <EquipmentDetail id={selected} onClose={() => setSelected(null)} onEdit={(e) => { setSelected(null); setEditing(e); }} />
      {editing && <EquipmentForm equipment={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      <EquipmentImportModal open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}

const EquipmentStatusBadge = ({ status }: { status: EquipmentStatus }) => (
  <Badge className={cx(status === "OPERATIVO" ? "border-hecho/30 bg-hecho-claro text-hecho" : status === "EN_REPARACION" ? "border-sol/40 bg-sol-claro" : "border-linea bg-papel text-tenue")}>
    {EQUIPMENT_STATUS_LABEL[status]}
  </Badge>
);

function EquipmentDetail({ id, onClose, onEdit }: { id: string | null; onClose: () => void; onEdit: (e: Equipment) => void }) {
  const detail = useQuery({ queryKey: ["equipment-detail", id], queryFn: () => api<Detail>(`/equipment/${id}`), enabled: !!id });
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    let url: string | null = null;
    fetch(`/api/equipment/${id}/qr`, { credentials: "same-origin" }).then((r) => (r.ok ? r.blob() : null)).then((b) => {
      if (b) { url = URL.createObjectURL(b); setQrUrl(url); }
    });
    return () => { if (url) URL.revokeObjectURL(url); setQrUrl(null); };
  }, [id]);
  const d = detail.data;

  const printLabel = () => {
    if (!d || !qrUrl) return;
    const w = window.open("", "_blank", "width=420,height=560");
    if (!w) return;
    const doc = w.document;
    doc.title = d.equipment.patrimonial_code;
    const wrap = doc.createElement("div");
    wrap.style.cssText = "font-family:sans-serif;text-align:center;border:2px solid #13233B;border-radius:12px;padding:16px;width:300px;margin:20px auto";
    const title = doc.createElement("p"); title.textContent = "¿Problemas con este equipo? Escanee para reportar"; title.style.fontWeight = "700";
    const img = doc.createElement("img"); img.src = qrUrl; img.style.width = "240px";
    const code = doc.createElement("p"); code.textContent = d.equipment.patrimonial_code; code.style.cssText = "font-size:22px;font-weight:700;margin:4px";
    const org = doc.createElement("p"); org.textContent = "Soporte TI, Municipalidad Provincial de Casma"; org.style.fontSize = "12px";
    wrap.append(title, img, code, org);
    doc.body.append(wrap);
    img.onload = () => { w.print(); };
  };

  return (
    <Modal open={!!id} onClose={onClose} title={d ? `${d.equipment.patrimonial_code}: ${EQUIPMENT_LABEL[d.equipment.type]}` : "Equipo"} wide>
      {detail.isLoading ? <Spinner /> : !d ? <ErrorBox message={errorMessage(detail.error)} /> : (
        <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
          <div className="flex min-w-0 flex-col gap-5">
            <dl className="grid grid-cols-2 gap-3 rounded-xl bg-papel p-4 text-sm sm:grid-cols-3">
              {([
                ["Marca / modelo", [d.equipment.brand, d.equipment.model].filter(Boolean).join(" ")],
                ["Oficina", d.equipment.office_name], ["N.º de serie", d.equipment.serial_number],
                ["IP", d.equipment.ip_address], ["Hostname", d.equipment.hostname], ["MAC", d.equipment.mac_address],
                ["Procesador", d.equipment.specs.cpu], ["RAM", d.equipment.specs.ram_gb ? `${d.equipment.specs.ram_gb} GB` : null],
                ["Almacenamiento", d.equipment.specs.storage_gb ? `${d.equipment.specs.storage_gb} GB` : null],
                ["Sistema operativo", d.equipment.specs.os], ["Adquirido", d.equipment.acquired_on && fmtDate(d.equipment.acquired_on)],
                ["Garantía hasta", d.equipment.warranty_until && fmtDate(d.equipment.warranty_until)],
              ] as [string, string | null][]).map(([k, v]) => (
                <div key={k} className="min-w-0"><dt className="text-tenue">{k}</dt><dd className="truncate font-bold">{v || "–"}</dd></div>
              ))}
            </dl>
            {d.equipment.notes && <p className="whitespace-pre-wrap text-sm">{d.equipment.notes}</p>}
            <section>
              <h3 className="mb-2 font-bold">Historial de incidencias ({d.tickets.length})</h3>
              {d.tickets.length === 0 ? <p className="text-tenue">Sin incidencias registradas.</p> : (
                <ol className="flex flex-col divide-y divide-linea rounded-xl border border-linea">
                  {d.tickets.map((t) => (
                    <li key={t.id} className="flex flex-col gap-1 p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold">{t.number}</span><StatusBadge status={t.status} /><PriorityBadge priority={t.priority} />
                        <span className="text-tenue">{CATEGORY_LABEL[t.category]}</span>
                        <span className="ml-auto text-tenue">{fmtDateTime(t.created_at)}</span>
                      </div>
                      <p>{t.subject}</p>
                      {t.resolution && <p className="text-tenue">Solución: {t.resolution.notes}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
          <aside className="flex flex-col gap-4">
            <div className="rounded-xl bg-tinta p-4 text-white">
              <p className="text-sm text-white/70">Riesgo de falla en 30 días</p>
              <p className="text-4xl font-bold">{d.risk != null ? pct(d.risk) : "–"}</p>
              {d.risk != null && <div className="my-2 h-2 overflow-hidden rounded-full bg-white/15"><div className={cx("h-full", d.risk > 0.6 ? "bg-alerta" : d.risk > 0.35 ? "bg-sol" : "bg-hecho")} style={{ width: pct(d.risk) }} /></div>}
              <ul className="list-disc pl-5 text-xs text-white/80">{d.risk_factors.map((f) => <li key={f}>{f}</li>)}</ul>
            </div>
            <div className="flex flex-col items-center gap-2 rounded-xl border border-linea p-4">
              {qrUrl ? <img src={qrUrl} alt="Código QR para reportar este equipo" className="size-44" /> : <QrCode className="size-20 text-linea" />}
              <p className="text-center text-xs text-tenue">Pegue esta etiqueta en el equipo: al escanearla se abre el reporte con el equipo ya elegido.</p>
              <Button size="sm" variant="secondary" onClick={printLabel} disabled={!qrUrl}><Printer className="size-4" /> Imprimir etiqueta</Button>
            </div>
            <Button variant="secondary" onClick={() => onEdit(d.equipment)}>Editar equipo</Button>
          </aside>
        </div>
      )}
    </Modal>
  );
}

type Form = {
  patrimonial_code: string; type: EquipmentType; brand: string; model: string; serial_number: string; hostname: string; ip_address: string;
  mac_address: string; office_id: string; cpu: string; ram_gb: string; storage_gb: string; os: string; acquired_on: string; warranty_until: string;
  status: EquipmentStatus; criticality: string; notes: string;
};

function EquipmentForm({ equipment: e, onClose }: { equipment: Equipment | null; onClose: () => void }) {
  const offices = useOfficeLookup();
  const isAdmin = useIsAdmin();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState<Form>({
    patrimonial_code: e?.patrimonial_code ?? "", type: e?.type ?? "PC", brand: e?.brand ?? "", model: e?.model ?? "", serial_number: e?.serial_number ?? "",
    hostname: e?.hostname ?? "", ip_address: e?.ip_address ?? "", mac_address: e?.mac_address ?? "", office_id: e?.office_id ?? "",
    cpu: e?.specs.cpu ?? "", ram_gb: e?.specs.ram_gb?.toString() ?? "", storage_gb: e?.specs.storage_gb?.toString() ?? "", os: e?.specs.os ?? "",
    acquired_on: e?.acquired_on?.slice(0, 10) ?? "", warranty_until: e?.warranty_until?.slice(0, 10) ?? "", status: e?.status ?? "OPERATIVO",
    criticality: String(e?.criticality ?? 1), notes: e?.notes ?? "",
  });
  const bind = (k: keyof Form) => ({ value: f[k], onChange: (ev: { target: { value: string } }) => setF((s) => ({ ...s, [k]: ev.target.value })) });
  const nul = (v: string) => v.trim() || null;
  const num = (v: string) => (v.trim() ? Number(v) : null);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        patrimonial_code: f.patrimonial_code, type: f.type, brand: nul(f.brand), model: nul(f.model), serial_number: nul(f.serial_number),
        hostname: nul(f.hostname), ip_address: nul(f.ip_address), mac_address: nul(f.mac_address), office_id: nul(f.office_id),
        specs: { cpu: nul(f.cpu), ram_gb: num(f.ram_gb), storage_gb: num(f.storage_gb), os: nul(f.os) },
        acquired_on: f.acquired_on ? `${f.acquired_on}T00:00:00Z` : null, warranty_until: f.warranty_until ? `${f.warranty_until}T00:00:00Z` : null,
        status: f.status, criticality: Number(f.criticality), notes: nul(f.notes),
      };
      return e ? api<Equipment>(`/equipment/${e.id}`, { method: "PUT", json: body }) : api<Equipment>("/equipment", { json: body });
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ["equipment"] });
      qc.invalidateQueries({ queryKey: ["equipment-detail", saved.id] });
      toast({ tone: "success", title: e ? "Equipo actualizado" : "Equipo registrado", body: saved.patrimonial_code });
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/equipment/${e!.id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["equipment"] }); toast({ tone: "success", title: "Equipo eliminado" }); onClose(); },
    onError: (err) => toast({ tone: "danger", title: "No se pudo eliminar", body: errorMessage(err) }),
  });

  return (
    <Modal open onClose={onClose} title={e ? `Editar ${e.patrimonial_code}` : "Nuevo equipo"} wide>
      <form className="flex flex-col gap-4" onSubmit={(ev: FormEvent) => { ev.preventDefault(); save.mutate(); }}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Código patrimonial">{(id) => <Input id={id} {...bind("patrimonial_code")} required minLength={3} maxLength={40} />}</Field>
          <Field label="Tipo">{(id) => <Select id={id} {...bind("type")}>{EQUIPMENT_TYPES.map((t) => <option key={t} value={t}>{EQUIPMENT_LABEL[t]}</option>)}</Select>}</Field>
          <Field label="Oficina">
            {(id) => <Select id={id} {...bind("office_id")}><option value="">Sin asignar (almacén)</option>{offices.data?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select>}
          </Field>
          <Field label="Marca">{(id) => <Input id={id} {...bind("brand")} maxLength={60} />}</Field>
          <Field label="Modelo">{(id) => <Input id={id} {...bind("model")} maxLength={80} />}</Field>
          <Field label="N.º de serie">{(id) => <Input id={id} {...bind("serial_number")} maxLength={80} />}</Field>
          <Field label="Dirección IP">{(id) => <Input id={id} {...bind("ip_address")} maxLength={45} placeholder="10.10.2.45" />}</Field>
          <Field label="Hostname">{(id) => <Input id={id} {...bind("hostname")} maxLength={80} />}</Field>
          <Field label="MAC">{(id) => <Input id={id} {...bind("mac_address")} maxLength={17} placeholder="AA:BB:CC:DD:EE:FF" />}</Field>
          <Field label="Procesador">{(id) => <Input id={id} {...bind("cpu")} maxLength={80} />}</Field>
          <Field label="RAM (GB)">{(id) => <Input id={id} type="number" min={0} max={1024} {...bind("ram_gb")} />}</Field>
          <Field label="Almacenamiento (GB)">{(id) => <Input id={id} type="number" min={0} max={100000} {...bind("storage_gb")} />}</Field>
          <Field label="Sistema operativo">{(id) => <Input id={id} {...bind("os")} maxLength={60} />}</Field>
          <Field label="Fecha de adquisición">{(id) => <Input id={id} type="date" {...bind("acquired_on")} />}</Field>
          <Field label="Garantía hasta">{(id) => <Input id={id} type="date" {...bind("warranty_until")} />}</Field>
          <Field label="Estado">{(id) => <Select id={id} {...bind("status")}>{Object.entries(EQUIPMENT_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
          <Field label="Criticidad">
            {(id) => <Select id={id} {...bind("criticality")}><option value="1">Normal</option><option value="2">Importante</option><option value="3">Crítico (caja, atención)</option></Select>}
          </Field>
        </div>
        <Field label="Notas">{(id) => <Textarea id={id} rows={2} {...bind("notes")} maxLength={1000} />}</Field>
        {save.error && <ErrorBox message={errorMessage(save.error)} />}
        <div className="flex flex-wrap justify-between gap-2">
          {e && isAdmin ? <Button type="button" variant="danger" loading={remove.isPending} onClick={() => confirm(`¿Eliminar el equipo ${e.patrimonial_code}?`) && remove.mutate()}>Eliminar</Button> : <span />}
          <Button type="submit" loading={save.isPending}>Guardar</Button>
        </div>
      </form>
    </Modal>
  );
}
