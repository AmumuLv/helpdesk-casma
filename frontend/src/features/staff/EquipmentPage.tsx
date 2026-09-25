import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Monitor, Plus, Printer, QrCode, ScanLine, Upload } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState, type FormEvent } from "react";
import { PhotoPicker } from "../../components/PhotoPicker";
import { useToast } from "../../components/Toasts";
import { Badge, Button, Card, cx, EmptyState, ErrorBox, Field, Input, Modal, PriorityBadge, Select, Spinner, StatusBadge, Textarea } from "../../components/ui";
import { api, downloadApiFile, errorMessage } from "../../lib/api";
import { CATEGORY_LABEL, EQUIPMENT_LABEL, EQUIPMENT_STATUS_LABEL, EQUIPMENT_TYPES, fmtDate, fmtDateTime, pct } from "../../lib/labels";
import type { Equipment, EquipmentImportOfficeRef, EquipmentImportResult, EquipmentStatus, EquipmentType, Ticket } from "../../lib/types";
import { useIsAdmin, useMunicipalUsers, useOfficeLookup } from "./hooks";
import { PageHeader } from "./PageHeader";

type Detail = { equipment: Equipment; risk: number | null; risk_factors: string[]; tickets: Ticket[] };
type RetirementHistoryItem = {
  number: string;
  created_at: string;
  subject: string;
  status: string;
  resolution_type: string | null;
  resolution_notes: string | null;
};

type RetirementReport = {
  generated_at: string;
  equipment: Equipment;
  total_incidents: number;
  resolved_incidents: number;
  incidents_365d: number;
  incidents_90d: number;
  resolution_counts: Record<string, number>;
  risk_30d: number | null;
  risk_factors: string[];
  indicators: string[];
  recommendation: "EVALUAR_BAJA_PATRIMONIAL" | "REQUIERE_EVALUACION_TECNICA" | "SIN_EVIDENCIA_SUFICIENTE_PARA_BAJA";
  technical_conclusion: string;
  disclaimer: string;
  history: RetirementHistoryItem[];
};


export function EquipmentPage() {
  const offices = useOfficeLookup();
  const isAdmin = useIsAdmin();
  const [zoneName, setZoneName] = useState("");
  const [officeId, setOfficeId] = useState("");
  const [area, setArea] = useState("");
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  const query = useDeferredValue(q.trim());
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Equipment | "new" | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [ocrOpen, setOcrOpen] = useState(false);
  const [ocrPhoto, setOcrPhoto] = useState<File | null>(null);

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
  const exportFile = useMutation({
    mutationFn: async () => {
      const p = new URLSearchParams();
      if (zoneName) p.set("zone_name", zoneName);
      if (officeId) p.set("office_id", officeId);
      if (area) p.set("area", area);
      if (type) p.set("type", type);
      if (q.trim()) p.set("q", q.trim());
      const suffix = p.toString();
      await downloadApiFile(
        `/equipment/export-xlsx${suffix ? `?${suffix}` : ""}`,
        "margesi-ti-casma.xlsx",
      );
    },
    onSuccess: () => toast({ tone: "success", title: "Margesí exportado", body: "El Excel respeta los filtros actuales del inventario." }),
    onError: (err) => toast({ tone: "danger", title: "No se pudo exportar", body: errorMessage(err) }),
  });


  const zones = useMemo(
    () => [...new Set((offices.data ?? []).map((office) => office.zone_name).filter((value): value is string => !!value))].sort((a, b) => a.localeCompare(b, "es")),
    [offices.data],
  );

  const filteredOffices = useMemo(
    () => (offices.data ?? []).filter((office) => !zoneName || office.zone_name === zoneName),
    [offices.data, zoneName],
  );

  const areaOptions = useMemo(() => {
    const values = (list.data ?? [])
      .filter((equipment) => !zoneName || equipment.zone_name === zoneName)
      .filter((equipment) => !officeId || equipment.office_id === officeId)
      .map((equipment) => equipment.area)
      .filter((value): value is string => !!value);
    return [...new Set(values)].sort((a, b) => a.localeCompare(b, "es"));
  }, [list.data, zoneName, officeId]);

  const visibleEquipment = useMemo(
    () => (list.data ?? [])
      .filter((equipment) => !zoneName || equipment.zone_name === zoneName)
      .filter((equipment) => !area || equipment.area === area),
    [list.data, zoneName, area],
  );

  return (
    <div>
      <PageHeader title="Inventario de equipos" description="ID TI, código patrimonial, oficina, especificaciones, historial de incidencias y riesgo de falla."
        actions={<>
          {isAdmin && (
            <Button variant="secondary" loading={exportFile.isPending} onClick={() => exportFile.mutate()}>
              <Download className="size-4" /> Exportar Margesí
            </Button>
          )}
          {isAdmin && <Button variant="secondary" onClick={() => setImportOpen(true)}><Upload className="size-4" /> Importar Margesí</Button>}
          <Button onClick={() => setEditing("new")}><Plus className="size-4" /> Nuevo equipo</Button>
        </>} />
      <Card className="mb-4 grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_1fr_1fr]">
        <div className="flex gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por código patrimonial, MAC, IP o responsable" aria-label="Buscar equipos" />
          <Button type="button" variant="secondary" className="shrink-0" onClick={() => setOcrOpen(true)} title="Buscar equipo leyendo su etiqueta patrimonial">
            <ScanLine className="size-5" />
            <span className="hidden 2xl:inline">Leer etiqueta</span>
          </Button>
        </div>
        <Select
          value={zoneName}
          onChange={(e) => {
            setZoneName(e.target.value);
            setOfficeId("");
            setArea("");
          }}
          aria-label="Zona"
        >
          <option value="">Todas las zonas</option>
          {zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
        </Select>
        <Select
          value={officeId}
          onChange={(e) => {
            setOfficeId(e.target.value);
            setArea("");
          }}
          aria-label="Oficina"
        >
          <option value="">Todas las oficinas</option>
          {filteredOffices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </Select>
        <Select value={area} onChange={(e) => setArea(e.target.value)} aria-label="Área">
          <option value="">Todas las áreas</option>
          {areaOptions.map((item) => <option key={item} value={item}>{item}</option>)}
        </Select>
        <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Tipo">
          <option value="">Todos los tipos</option>
          {EQUIPMENT_TYPES.map((t) => <option key={t} value={t}>{EQUIPMENT_LABEL[t]}</option>)}
        </Select>
      </Card>
      {list.isLoading ? <Spinner /> : list.error ? <ErrorBox message={errorMessage(list.error)} /> : !visibleEquipment.length ? (
        <Card><EmptyState icon={<Monitor />} title="No se encontraron equipos con estos filtros" /></Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-left text-sm">
            <thead className="border-b border-linea bg-papel text-tenue">
              <tr><th className="p-3">ID TI</th><th className="p-3">Código patrimonial</th><th className="p-3">Equipo</th><th className="p-3">Jerarquía</th><th className="p-3">Responsable</th><th className="p-3">IP / MAC</th><th className="p-3">Estado</th><th className="p-3" /></tr>
            </thead>
            <tbody className="divide-y divide-linea">
              {visibleEquipment.map((e) => (
                <tr key={e.id} className="cursor-pointer hover:bg-papel" onClick={() => setSelected(e.id)}>
                  <td className="p-3 font-bold text-casma">{e.inventory_id ?? "–"}</td>
                  <td className="p-3 font-bold">{e.patrimonial_code}</td>
                  <td className="p-3">{EQUIPMENT_LABEL[e.type]}<p className="text-tenue">{e.device_label || [e.brand, e.model].filter(Boolean).join(" ") || "–"}</p></td>
                  <td className="p-3">
                    <p className="font-bold">{e.zone_name ?? "Sin zona"}</p>
                    <p className="text-tenue">{e.office_name ?? "Sin oficina"}{e.area && e.area !== e.office_name ? ` › ${e.area}` : ""}</p>
                  </td>
                  <td className="p-3"><p className="font-bold">{e.responsible_name ?? "–"}</p><p className="text-tenue">{e.responsible_type}</p></td>
                  <td className="p-3">{e.ip_address ?? "–"}<p className="text-tenue">{e.mac_address ?? "–"}</p></td>
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
      <Modal
        open={ocrOpen}
        onClose={() => { setOcrOpen(false); setOcrPhoto(null); }}
        title="Buscar por etiqueta patrimonial"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-tenue">
            Tome una foto clara de la etiqueta. Procure que el código patrimonial ocupe buena parte de la imagen y evite reflejos.
          </p>
          <PhotoPicker
            value={ocrPhoto}
            onChange={setOcrPhoto}
            large
            patrimonialOcr
            onPatrimonialDetected={(code) => {
              setQ(code);
              setZoneName("");
              setOfficeId("");
              setArea("");
              setType("");
              setOcrOpen(false);
              setOcrPhoto(null);
            }}
          />
        </div>
      </Modal>
    </div>
  );
}

function EquipmentImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<EquipmentImportResult | null>(null);

  const refs = useQuery({
    queryKey: ["equipment-import-references"],
    queryFn: () => api<EquipmentImportOfficeRef[]>("/equipment/import-references"),
    enabled: open,
  });

  const upload = useMutation({
    mutationFn: async (selected: File) => {
      const form = new FormData();
      form.append("file", selected);
      return api<EquipmentImportResult>("/equipment/import-xlsx", { form });
    },
    onSuccess: (data) => {
      setResult(data);
      qc.invalidateQueries({ queryKey: ["equipment"] });
      toast({
        tone: "success",
        title: "Importación de Margesí completada",
        body: `${data.imported} registrados, ${data.rejected} rechazados.`,
      });
    },
  });

  useEffect(() => {
    if (!open) {
      setFile(null);
      setResult(null);
      upload.reset();
    }
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="Importar Margesí desde Excel" wide>
      <div className="flex flex-col gap-5">
        <div className="rounded-xl bg-papel p-4 text-sm">
          <p className="font-bold">Columnas obligatorias</p>
          <p className="mt-1 font-mono text-xs">zona (o zona_id) · oficina · codigo_patrimonial · tipo</p>
          <p className="mt-2 text-tenue">
            La columna <strong>oficina</strong> puede contener el código o nombre exacto. El sistema valida que pertenezca a la zona indicada.
          </p>
          <p className="mt-2 text-tenue">
            El ID TI se genera automáticamente. También puede importar: area, dispositivo, marca, modelo, tamano_pantalla, nombre_equipo, cpu, ram_gb, almacenamiento_gb, ip, mac, propiedad, estado, responsable, responsable_tipo, fechas, criticidad y notas.
          </p>
          <p className="mt-2 text-tenue">
            Tipos admitidos por el Área TI: CPU, MONITOR, MOUSE, TECLADO, IMPRESORA y LAPTOP.
          </p>
          <p className="mt-2 text-tenue">
            La normalización inteligente corrige alias técnicos seguros, por ejemplo <strong>HP Print</strong> o <strong>Impresora HP</strong> → Tipo IMPRESORA / Marca HP. Zona y Oficina nunca se aproximan automáticamente.
          </p>
        </div>

        <Field label="Archivo Excel (.xlsx)" hint="Máximo 10 MB y 5000 filas por importación.">
          {(id) => <Input id={id} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); }} />}
        </Field>

        {upload.error && <ErrorBox message={errorMessage(upload.error)} />}

        <div className="flex justify-end">
          <Button loading={upload.isPending} disabled={!file} onClick={() => file && upload.mutate(file)}>
            <Upload className="size-4" /> Procesar Excel
          </Button>
        </div>

        {result && (
          <Card className="p-4">
            <h3 className="font-bold">Resultado de la importación</h3>
            <div className="mt-3 grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
              <div className="rounded-xl bg-papel p-3"><p className="text-2xl font-bold">{result.processed}</p><p className="text-xs text-tenue">Procesados</p></div>
              <div className="rounded-xl bg-hecho-claro p-3"><p className="text-2xl font-bold text-hecho">{result.imported}</p><p className="text-xs text-tenue">Registrados</p></div>
              <div className="rounded-xl bg-sol-claro p-3"><p className="text-2xl font-bold">{result.normalized}</p><p className="text-xs text-tenue">Normalizados</p></div>
              <div className="rounded-xl bg-alerta-claro p-3"><p className="text-2xl font-bold text-alerta">{result.rejected}</p><p className="text-xs text-tenue">Rechazados</p></div>
            </div>
            {result.normalizations.length > 0 && (
              <div className="mt-4 max-h-64 overflow-auto rounded-xl border border-linea">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-papel">
                    <tr><th className="p-2">Fila</th><th className="p-2">Campo</th><th className="p-2">Original</th><th className="p-2">Normalizado</th><th className="p-2">Método</th></tr>
                  </thead>
                  <tbody className="divide-y divide-linea">
                    {result.normalizations.map((item, index) => (
                      <tr key={`${item.row}-${item.field}-${index}`}>
                        <td className="p-2 font-bold">{item.row}</td>
                        <td className="p-2">{item.field}</td>
                        <td className="p-2 text-tenue">{item.original}</td>
                        <td className="p-2 font-bold">{item.normalized}</td>
                        <td className="p-2 text-tenue">{item.method}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.more_normalizations > 0 && <p className="p-3 text-sm text-tenue">Hay {result.more_normalizations} normalizaciones adicionales no mostradas.</p>}
              </div>
            )}
            {result.errors.length > 0 && (
              <div className="mt-4 max-h-64 overflow-auto rounded-xl border border-linea">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-papel"><tr><th className="p-2">Fila</th><th className="p-2">Código</th><th className="p-2">Motivo</th></tr></thead>
                  <tbody className="divide-y divide-linea">
                    {result.errors.map((error, index) => (
                      <tr key={`${error.row}-${index}`}>
                        <td className="p-2 font-bold">{error.row}</td>
                        <td className="p-2">{error.patrimonial_code ?? "–"}</td>
                        <td className="p-2 text-alerta">{error.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.more_errors > 0 && <p className="p-3 text-sm text-tenue">Hay {result.more_errors} errores adicionales no mostrados.</p>}
              </div>
            )}
          </Card>
        )}

        <section>
          <h3 className="mb-2 font-bold">Jerarquía válida Zona / Oficina</h3>
          <p className="mb-3 text-sm text-tenue">Use estas combinaciones en el Excel. Las oficinas sin zona asignada no pueden recibir una importación de Margesí.</p>
          {refs.isLoading ? <Spinner label="Cargando oficinas" /> : refs.error ? <ErrorBox message={errorMessage(refs.error)} /> : (
            <div className="max-h-64 overflow-auto rounded-xl border border-linea">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="sticky top-0 bg-papel"><tr><th className="p-2">Zona</th><th className="p-2">Código</th><th className="p-2">Oficina</th><th className="p-2">Jefe / responsable</th><th className="p-2">Importación</th></tr></thead>
                <tbody className="divide-y divide-linea">
                  {refs.data?.map((ref) => (
                    <tr key={ref.office_code}>
                      <td className="p-2"><p className="font-bold">{ref.zone_name ?? "Sin zona"}</p><p className="font-mono text-xs text-tenue">{ref.zone_id}</p></td>
                      <td className="p-2 font-bold">{ref.office_code}</td>
                      <td className="p-2">{ref.office_name}</td>
                      <td className="p-2">{ref.head_name ?? "–"}</td>
                      <td className="p-2">{ref.import_enabled ? <Badge className="border-hecho/30 bg-hecho-claro text-hecho">Habilitada</Badge> : <Badge className="border-alerta/30 bg-alerta-claro text-alerta">Configurar zona</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </Modal>
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
  const [showRetirement, setShowRetirement] = useState(false);
  const retirement = useQuery({
    queryKey: ["equipment-retirement", id],
    queryFn: () => api<RetirementReport>(`/equipment/${id}/retirement-report`),
    enabled: !!id && showRetirement,
  });
  useEffect(() => {
    if (!id) return;
    let url: string | null = null;
    fetch(`/api/equipment/${id}/qr`, { credentials: "same-origin" }).then((r) => (r.ok ? r.blob() : null)).then((b) => {
      if (b) { url = URL.createObjectURL(b); setQrUrl(url); }
    });
    return () => { if (url) URL.revokeObjectURL(url); setQrUrl(null); };
  }, [id]);
  const d = detail.data;

  const printRetirementReport = () => {
    const report = retirement.data;
    if (!report) return;
    const w = window.open("", "_blank", "width=900,height=760");
    if (!w) return;
    const doc = w.document;
    doc.title = `Sustento técnico - ${report.equipment.patrimonial_code}`;
    const style = doc.createElement("style");
    style.textContent = "body{font-family:Arial,sans-serif;color:#111827;margin:32px}h1,h2{color:#13233B}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #d1d5db;padding:7px;text-align:left;font-size:12px}th{background:#f3f4f6}.muted{color:#6b7280;font-size:12px}.box{border:1px solid #d1d5db;border-radius:10px;padding:14px;margin:12px 0}ul{padding-left:20px}";
    doc.head.appendChild(style);

    const add = (tag: string, text: string, className?: string) => {
      const el = doc.createElement(tag);
      el.textContent = text;
      if (className) el.className = className;
      doc.body.appendChild(el);
      return el;
    };

    add("h1", "Sustento técnico para evaluación patrimonial");
    add("p", "Área de Tecnologías de la Información - Municipalidad Provincial de Casma", "muted");
    add("p", `Generado: ${fmtDateTime(report.generated_at)}`, "muted");
    add("h2", `${report.equipment.inventory_id ?? "ID TI pendiente"} · Patrimonial ${report.equipment.patrimonial_code}`);
    add("p", `Equipo: ${EQUIPMENT_LABEL[report.equipment.type]} · ${[report.equipment.brand, report.equipment.model].filter(Boolean).join(" ") || "Sin marca/modelo"}`);
    add("p", `Zona / Oficina: ${report.equipment.zone_name ?? "Sin zona"} / ${report.equipment.office_name ?? "Sin oficina"}`);
    add("p", `Responsable: ${report.equipment.responsible_name ?? "Sin responsable"}`);

    add("h2", "Conclusión técnica");
    add("p", report.technical_conclusion);
    if (report.indicators.length) {
      add("h2", "Indicadores");
      const ul = doc.createElement("ul");
      report.indicators.forEach((item) => {
        const li = doc.createElement("li");
        li.textContent = item;
        ul.appendChild(li);
      });
      doc.body.appendChild(ul);
    }

    add("h2", "Resumen de incidencias");
    add("p", `Total: ${report.total_incidents} · Resueltas: ${report.resolved_incidents} · Últimos 365 días: ${report.incidents_365d} · Últimos 90 días: ${report.incidents_90d}`);

    const table = doc.createElement("table");
    const thead = doc.createElement("thead");
    const headRow = doc.createElement("tr");
    ["Fecha", "Ticket", "Incidencia", "Resolución", "Detalle"].forEach((label) => {
      const th = doc.createElement("th"); th.textContent = label; headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = doc.createElement("tbody");
    report.history.forEach((item) => {
      const row = doc.createElement("tr");
      [
        fmtDateTime(item.created_at),
        item.number,
        item.subject,
        item.resolution_type?.replaceAll("_", " ") ?? "Pendiente",
        item.resolution_notes ?? "–",
      ].forEach((value) => {
        const td = doc.createElement("td"); td.textContent = value; row.appendChild(td);
      });
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    doc.body.appendChild(table);
    add("p", report.disclaimer, "muted");
    w.focus();
    w.print();
  };

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
    const tiId = doc.createElement("p"); tiId.textContent = d.equipment.inventory_id ? `ID TI: ${d.equipment.inventory_id}` : "ID TI: pendiente"; tiId.style.cssText = "font-size:18px;font-weight:700;margin:4px";
    const code = doc.createElement("p"); code.textContent = `Patrimonial: ${d.equipment.patrimonial_code}`; code.style.cssText = "font-size:16px;font-weight:700;margin:4px";
    const org = doc.createElement("p"); org.textContent = "Soporte TI, Municipalidad Provincial de Casma"; org.style.fontSize = "12px";
    wrap.append(title, img, tiId, code, org);
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
                ["ID TI", d.equipment.inventory_id], ["Código patrimonial", d.equipment.patrimonial_code],
                ["Zona", d.equipment.zone_name], ["Oficina", d.equipment.office_name], ["Área", d.equipment.area],
                ["Responsable", d.equipment.responsible_name], ["Tipo responsable", d.equipment.responsible_type],
                ["Dispositivo", d.equipment.device_label], ["Marca / modelo", [d.equipment.brand, d.equipment.model].filter(Boolean).join(" ")],
                ["Tamaño pantalla", d.equipment.specs.screen_size_inches ? `${d.equipment.specs.screen_size_inches}″` : null],
                ["Nombre equipo", d.equipment.hostname], ["Procesador", d.equipment.specs.cpu],
                ["RAM", d.equipment.specs.ram_gb ? `${d.equipment.specs.ram_gb} GB` : null],
                ["Almacenamiento", d.equipment.specs.storage_gb ? `${d.equipment.specs.storage_gb} GB` : null],
                ["IP", d.equipment.ip_address], ["MAC", d.equipment.mac_address], ["Propiedad", d.equipment.property_type],
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
            {showRetirement && (
              <section className="flex flex-col gap-3 rounded-2xl border border-linea p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-bold">Sustento técnico para evaluación patrimonial</h3>
                  {retirement.data && <Button size="sm" variant="secondary" onClick={printRetirementReport}><Printer className="size-4" /> Imprimir sustento</Button>}
                </div>
                {retirement.isLoading ? <Spinner label="Analizando historial patrimonial" /> : retirement.error ? (
                  <ErrorBox message={errorMessage(retirement.error)} />
                ) : retirement.data ? (
                  <>
                    <Badge className={cx(
                      retirement.data.recommendation === "EVALUAR_BAJA_PATRIMONIAL"
                        ? "border-alerta/40 bg-alerta-claro text-alerta"
                        : retirement.data.recommendation === "REQUIERE_EVALUACION_TECNICA"
                          ? "border-sol/40 bg-sol-claro text-tinta"
                          : "border-hecho/30 bg-hecho-claro text-hecho",
                    )}>
                      {retirement.data.recommendation === "EVALUAR_BAJA_PATRIMONIAL"
                        ? "Evaluar baja patrimonial"
                        : retirement.data.recommendation === "REQUIERE_EVALUACION_TECNICA"
                          ? "Requiere evaluación técnica"
                          : "Sin evidencia suficiente para baja"}
                    </Badge>
                    <p className="text-sm">{retirement.data.technical_conclusion}</p>
                    <div className="grid gap-2 sm:grid-cols-4">
                      <MiniEvidence label="Incidencias" value={retirement.data.total_incidents} />
                      <MiniEvidence label="Resueltas" value={retirement.data.resolved_incidents} />
                      <MiniEvidence label="365 días" value={retirement.data.incidents_365d} />
                      <MiniEvidence label="Riesgo 30d" value={retirement.data.risk_30d != null ? pct(retirement.data.risk_30d) : "–"} />
                    </div>
                    {retirement.data.indicators.length > 0 && (
                      <ul className="list-disc pl-5 text-sm">
                        {retirement.data.indicators.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    )}
                    <p className="text-xs text-tenue">{retirement.data.disclaimer}</p>
                  </>
                ) : null}
              </section>
            )}
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
            <Button variant="secondary" onClick={() => setShowRetirement((value) => !value)}>
              {showRetirement ? "Ocultar sustento" : "Sustento de baja"}
            </Button>
            <Button variant="secondary" onClick={() => onEdit(d.equipment)}>Editar equipo</Button>
          </aside>
        </div>
      )}
    </Modal>
  );
}

const MiniEvidence = ({ label, value }: { label: string; value: string | number }) => (
  <div className="rounded-xl bg-papel p-3 text-center text-sm">
    <strong className="block text-lg">{value}</strong>
    <span className="text-tenue">{label}</span>
  </div>
);

type Form = {
  patrimonial_code: string; type: EquipmentType; area: string; device_label: string; brand: string; model: string;
  screen_size_inches: string; hostname: string; ip_address: string; mac_address: string; office_id: string;
  responsable_id: string; responsible_name: string; responsible_type: "USUARIO" | "JEFE" | "OFICINA"; property_type: string;
  cpu: string; ram_gb: string; storage_gb: string; os: string; acquired_on: string; warranty_until: string;
  status: EquipmentStatus; criticality: string; notes: string;
};

function EquipmentForm({ equipment: e, onClose }: { equipment: Equipment | null; onClose: () => void }) {
  const offices = useOfficeLookup();
  const isAdmin = useIsAdmin();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState<Form>({
    patrimonial_code: e?.patrimonial_code ?? "", type: e?.type && EQUIPMENT_TYPES.includes(e.type) ? e.type : "CPU",
    area: e?.area ?? "", device_label: e?.device_label ?? "", brand: e?.brand ?? "", model: e?.model ?? "",
    screen_size_inches: e?.specs.screen_size_inches?.toString() ?? "", hostname: e?.hostname ?? "",
    ip_address: e?.ip_address ?? "", mac_address: e?.mac_address ?? "", office_id: e?.office_id ?? "",
    responsable_id: e?.responsable_id ?? "", responsible_name: e?.responsible_name ?? "", responsible_type: e?.responsible_type ?? "USUARIO",
    property_type: e?.property_type ?? "MUNICIPALIDAD PROVINCIAL DE CASMA",
    cpu: e?.specs.cpu ?? "", ram_gb: e?.specs.ram_gb?.toString() ?? "", storage_gb: e?.specs.storage_gb?.toString() ?? "", os: e?.specs.os ?? "",
    acquired_on: e?.acquired_on?.slice(0, 10) ?? "", warranty_until: e?.warranty_until?.slice(0, 10) ?? "", status: e?.status ?? "OPERATIVO",
    criticality: String(e?.criticality ?? 1), notes: e?.notes ?? "",
  });
  const selectedOffice = offices.data?.find((office) => office.id === f.office_id);
  const municipalUsers = useMunicipalUsers(f.office_id);
  const selectedMunicipalUser = municipalUsers.data?.find((user) => user.id === f.responsable_id);
  const bind = (k: keyof Form) => ({ value: f[k], onChange: (ev: { target: { value: string } }) => setF((s) => ({ ...s, [k]: ev.target.value })) });
  const nul = (v: string) => v.trim() || null;
  const num = (v: string) => (v.trim() ? Number(v) : null);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        patrimonial_code: f.patrimonial_code, type: f.type, area: nul(f.area), device_label: nul(f.device_label),
        brand: nul(f.brand), model: nul(f.model), hostname: nul(f.hostname), ip_address: nul(f.ip_address), mac_address: nul(f.mac_address),
        office_id: nul(f.office_id),
        responsable_id: f.responsible_type === "USUARIO" ? nul(f.responsable_id) : null,
        responsible_name: f.responsible_type === "USUARIO" ? (selectedMunicipalUser?.full_name ?? nul(f.responsible_name)) : null,
        responsible_type: f.responsible_type,
        property_type: nul(f.property_type),
        specs: { cpu: nul(f.cpu), ram_gb: num(f.ram_gb), storage_gb: num(f.storage_gb), screen_size_inches: num(f.screen_size_inches), os: nul(f.os) },
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
          <Field label="Zona">{(id) => <Input id={id} value={selectedOffice?.zone_name ?? ""} readOnly placeholder="Se completa según la oficina" />}</Field>
          <Field label="Oficina">
            {(id) => (
              <Select
                id={id}
                value={f.office_id}
                onChange={(ev) => setF((s) => ({ ...s, office_id: ev.target.value, responsable_id: "", responsible_name: "" }))}
                required
              >
                <option value="">Seleccione oficina</option>
                {offices.data?.map((o) => <option key={o.id} value={o.id}>{o.zone_name ? `${o.zone_name} › ${o.name}` : o.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Área">{(id) => <Input id={id} {...bind("area")} placeholder={selectedOffice?.name ?? "Área / dependencia"} maxLength={120} />}</Field>
          <Field label="Dispositivo">{(id) => <Input id={id} {...bind("device_label")} placeholder="Ej. CPU principal, monitor 1" maxLength={120} />}</Field>
          <Field label="Marca">{(id) => <Input id={id} {...bind("brand")} maxLength={60} />}</Field>
          <Field label="Modelo">{(id) => <Input id={id} {...bind("model")} maxLength={80} />}</Field>
          <Field label="Tamaño pantalla (pulg.)">{(id) => <Input id={id} type="number" min={0} step="0.1" {...bind("screen_size_inches")} />}</Field>
          <Field label="Nombre equipo">{(id) => <Input id={id} {...bind("hostname")} maxLength={80} placeholder="Ej. PC-CATASTRO-01" />}</Field>
          <Field label="Dirección IP">{(id) => <Input id={id} {...bind("ip_address")} maxLength={45} placeholder="10.10.2.45" />}</Field>
          <Field label="Dirección MAC">{(id) => <Input id={id} {...bind("mac_address")} maxLength={17} placeholder="AA:BB:CC:DD:EE:FF" />}</Field>
          <Field label="Procesador">{(id) => <Input id={id} {...bind("cpu")} maxLength={80} />}</Field>
          <Field label="RAM (GB)">{(id) => <Input id={id} type="number" min={0} max={1024} {...bind("ram_gb")} />}</Field>
          <Field label="Almacenamiento (GB)">{(id) => <Input id={id} type="number" min={0} max={100000} {...bind("storage_gb")} />}</Field>
          <Field label="Sistema operativo">{(id) => <Input id={id} {...bind("os")} maxLength={60} />}</Field>
          <Field label="Propiedad">{(id) => <Input id={id} {...bind("property_type")} maxLength={80} placeholder="Municipalidad Provincial de Casma" />}</Field>
          <Field label="Tipo de responsable">
            {(id) => (
              <Select
                id={id}
                value={f.responsible_type}
                onChange={(ev) => setF((s) => ({ ...s, responsible_type: ev.target.value as Form["responsible_type"], responsable_id: "", responsible_name: "" }))}
              >
                <option value="USUARIO">Usuario municipal</option>
                <option value="JEFE">Jefe de oficina</option>
                <option value="OFICINA">Oficina</option>
              </Select>
            )}
          </Field>
          {f.responsible_type === "USUARIO" ? (
            <Field label="Responsable" hint="Solo aparecen usuarios municipales activos de la oficina seleccionada.">
              {(id) => (
                <Select id={id} value={f.responsable_id} onChange={(ev) => setF((s) => ({ ...s, responsable_id: ev.target.value }))} required disabled={!f.office_id}>
                  <option value="">{f.office_id ? "Seleccione usuario" : "Seleccione primero una oficina"}</option>
                  {municipalUsers.data?.map((user) => <option key={user.id} value={user.id}>{user.full_name}{user.job_title ? ` — ${user.job_title}` : ""}</option>)}
                </Select>
              )}
            </Field>
          ) : (
            <Field label="Responsable asignado">
              {(id) => <Input id={id} value={f.responsible_type === "JEFE" ? selectedOffice?.head_name ?? selectedOffice?.name ?? "" : selectedOffice?.name ?? ""} readOnly />}
            </Field>
          )}
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
