import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, Check, MonitorSmartphone, X } from "lucide-react";
import { useState } from "react";
import { useToast } from "../../components/Toasts";
import { Badge, Button, Card, cx, EmptyState, ErrorBox, Field, Input, Select, Spinner } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { DEVICE_KIND_LABEL, EQUIPMENT_LABEL, fmtAgo, fmtDateTime } from "../../lib/labels";
import type { Device, DeviceKind, DeviceStatus } from "../../lib/types";
import { useDevices, useEquipmentList } from "./hooks";
import { PageHeader } from "./PageHeader";

const TABS: { value: DeviceStatus; label: string }[] = [
  { value: "PENDIENTE", label: "Por autorizar" },
  { value: "APROBADO", label: "Autorizados" },
  { value: "RECHAZADO", label: "Rechazados" },
  { value: "REVOCADO", label: "Revocados" },
];

const guessKind = (ua: string | null): DeviceKind => {
  if (!ua) return "PC";
  if (/iPad|Tablet/i.test(ua)) return "TABLET";
  if (/Android|iPhone|Mobile/i.test(ua)) return "CELULAR";
  return "PC";
};

const describeAgent = (ua: string | null) => {
  if (!ua) return "Navegador desconocido";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Navegador";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return `${browser}${os ? ` en ${os}` : ""}`;
};

export function DevicesPage() {
  const [tab, setTab] = useState<DeviceStatus>("PENDIENTE");
  const devices = useDevices(tab);

  return (
    <div>
      <PageHeader title="Dispositivos" description="Cada computadora o celular que usa la cuenta de una oficina debe ser autorizado. Pida al usuario que le dicte el código de su pantalla." />
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-white p-1 sm:w-fit" role="tablist">
        {TABS.map((t) => (
          <button key={t.value} role="tab" aria-selected={tab === t.value} onClick={() => setTab(t.value)}
            className={cx("shrink-0 rounded-lg px-4 py-2 text-sm font-bold", tab === t.value ? "bg-tinta text-white" : "text-tenue hover:text-tinta")}>{t.label}</button>
        ))}
      </div>
      {devices.isLoading ? <Spinner /> : devices.error ? <ErrorBox message={errorMessage(devices.error)} /> : !devices.data?.length ? (
        <Card><EmptyState icon={<MonitorSmartphone />} title="No hay dispositivos en esta lista" /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {devices.data.map((d) => <DeviceCard key={d.id} device={d} />)}
        </div>
      )}
    </div>
  );
}

function DeviceCard({ device: d }: { device: Device }) {
  const qc = useQueryClient();
  const toast = useToast();
  const equipment = useEquipmentList(d.status === "PENDIENTE" || d.status === "APROBADO" ? d.office_id : "");
  const [kind, setKind] = useState<DeviceKind>(d.kind === "OTRO" ? guessKind(d.user_agent) : d.kind);
  const [label, setLabel] = useState(d.label ?? "");
  const [equipmentId, setEquipmentId] = useState(d.equipment_id ?? "");

  const action = useMutation({
    mutationFn: (op: "approve" | "reject" | "revoke") =>
      api<Device>(`/admin/devices/${d.id}/${op}`, { json: op === "approve" ? { kind, label: label.trim(), equipment_id: equipmentId || null } : {} }),
    onSuccess: (_, op) => {
      qc.invalidateQueries({ queryKey: ["devices"] });
      qc.invalidateQueries({ queryKey: ["offices"] });
      toast({ tone: op === "approve" ? "success" : "info", title: op === "approve" ? "Dispositivo autorizado" : op === "reject" ? "Dispositivo rechazado" : "Acceso revocado", body: d.office_name });
    },
    onError: (err) => toast({ tone: "danger", title: "No se pudo completar", body: errorMessage(err) }),
  });

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-bold">{d.office_name}</p>
          <p className="text-sm text-tenue">{describeAgent(d.user_agent)}, IP {d.last_ip ?? d.first_ip ?? "?"}</p>
          <p className="text-sm text-tenue" title={fmtDateTime(d.created_at)}>Solicitado {fmtAgo(d.created_at)}, visto {fmtAgo(d.last_seen_at)}</p>
        </div>
        <span className="shrink-0 whitespace-nowrap rounded-xl border-2 border-dashed border-casma px-3 py-1 text-2xl font-bold tracking-wider">{d.pair_code}</span>
      </div>

      {d.status === "PENDIENTE" ? (
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); action.mutate("approve"); }}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tipo">
              {(id) => <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as DeviceKind)}>{Object.entries(DEVICE_KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}
            </Field>
            <Field label="Nombre">{(id) => <Input id={id} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="PC de José" minLength={2} maxLength={80} required />}</Field>
          </div>
          <Field label="Vincular con equipo patrimonial" hint="Así la IA sabe qué máquina reporta.">
            {(id) => (
              <Select id={id} value={equipmentId} onChange={(e) => setEquipmentId(e.target.value)}>
                <option value="">Sin vincular (celular u otro)</option>
                {equipment.data?.map((e) => <option key={e.id} value={e.id}>{e.patrimonial_code}: {EQUIPMENT_LABEL[e.type]} {e.brand ?? ""} {e.ip_address ?? ""}</option>)}
              </Select>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Button type="submit" variant="success" loading={action.isPending && action.variables === "approve"}><Check className="size-4" /> Autorizar</Button>
            <Button type="button" variant="danger" loading={action.isPending && action.variables === "reject"} onClick={() => action.mutate("reject")}><X className="size-4" /> Rechazar</Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="border-linea bg-papel">{DEVICE_KIND_LABEL[d.kind]}</Badge>
          {d.label && <Badge className="border-linea bg-white">{d.label}</Badge>}
          {d.equipment_code && <Badge className="border-casma/30 bg-casma-claro text-casma-oscuro">{d.equipment_code}</Badge>}
          {d.status === "APROBADO" && (
            <Button size="sm" variant="danger" className="ml-auto" loading={action.isPending}
              onClick={() => confirm(`¿Quitar el acceso a «${d.label ?? d.pair_code}»?`) && action.mutate("revoke")}><Ban className="size-4" /> Revocar</Button>
          )}
        </div>
      )}
    </Card>
  );
}
