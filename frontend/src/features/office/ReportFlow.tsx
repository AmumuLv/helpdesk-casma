import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Send } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { PhotoPicker } from "../../components/PhotoPicker";
import { VoiceButton } from "../../components/VoiceButton";
import { Button, cx, ErrorBox, Input, Spinner, Textarea } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import type { EquipmentBrief, OfficeTicket, QuickIssue } from "../../lib/types";
import { ISSUES, ISSUE_ORDER, isQuickIssue } from "./issues";
import { useOfficeHome } from "./OfficeHome";

const OTHER = "__otro__";

export function ReportFlow() {
  const params = useParams();
  const [search] = useSearchParams();
  const qrCode = search.get("equipo");
  const [issue, setIssue] = useState<QuickIssue | null>(isQuickIssue(params.issue) ? params.issue : null);
  const home = useOfficeHome();
  const qrEquipment = useQuery({
    queryKey: ["qr-equipment", qrCode],
    queryFn: () => api<EquipmentBrief>(`/office/equipment/by-code/${encodeURIComponent(qrCode!)}`),
    enabled: !!qrCode,
    retry: false,
  });

  if (home.isLoading || (qrCode && qrEquipment.isLoading)) return <Spinner />;
  if (!home.data) return <ErrorBox message={errorMessage(home.error)} />;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <Link to="/oficina" className="inline-flex w-fit items-center gap-2 rounded-xl px-2 py-2 text-xl font-bold text-casma hover:bg-casma-claro">
        <ArrowLeft className="size-7" aria-hidden /> Volver
      </Link>
      {qrCode && qrEquipment.error && <ErrorBox message={errorMessage(qrEquipment.error)} />}
      {issue ? (
        <ReportForm issue={issue} onChangeIssue={params.issue ? undefined : () => setIssue(null)} equipmentList={home.data.equipment}
          fixedEquipment={qrEquipment.data ?? null} thisEquipment={home.data.this_equipment} fromQr={!!qrEquipment.data} />
      ) : (
        <IssuePicker equipment={qrEquipment.data ?? null} onPick={setIssue} />
      )}
    </div>
  );
}

function IssuePicker({ equipment, onPick }: { equipment: EquipmentBrief | null; onPick: (i: QuickIssue) => void }) {
  return (
    <section className="flex flex-col gap-5">
      {equipment && (
        <p className="rounded-2xl bg-casma-claro p-4 text-xl">Equipo: <strong>{equipment.name}</strong> ({equipment.patrimonial_code})</p>
      )}
      <h1 className="text-3xl font-bold">¿Qué problema tiene?</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        {ISSUE_ORDER.map((key) => {
          const Icon = ISSUES[key].icon;
          return (
            <button key={key} onClick={() => onPick(key)} className="tecla min-h-24">
              <span className={`grid size-14 shrink-0 place-items-center rounded-2xl ${ISSUES[key].tone}`}><Icon className="size-8" aria-hidden /></span>
              <span className="text-xl font-bold leading-tight">{ISSUES[key].title}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

type FormProps = {
  issue: QuickIssue; onChangeIssue?: () => void; equipmentList: EquipmentBrief[];
  fixedEquipment: EquipmentBrief | null; thisEquipment: EquipmentBrief | null; fromQr: boolean;
};

function ReportForm({ issue, onChangeIssue, equipmentList, fixedEquipment, thisEquipment, fromQr }: FormProps) {
  const info = ISSUES[issue];
  const Icon = info.icon;
  const wantsPrinter = issue === "IMPRESORA";
  const candidates = equipmentList.filter((e) => (wantsPrinter ? e.type === "IMPRESORA" : e.type !== "IMPRESORA"));
  const defaultEquipment = fixedEquipment?.id ?? (!wantsPrinter && thisEquipment ? thisEquipment.id : candidates.length === 1 ? candidates[0].id : "");
  const [equipmentId, setEquipmentId] = useState<string>(defaultEquipment);
  const [description, setDescription] = useState("");
  const [reporter, setReporter] = useState(() => localStorage.getItem("hd_reporter") ?? "");
  const [photo, setPhoto] = useState<File | null>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const send = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.set("quick_issue", issue);
      form.set("description", description);
      form.set("source", fromQr ? "QR" : "APP");
      if (equipmentId && equipmentId !== OTHER) form.set("equipment_id", equipmentId);
      if (reporter.trim()) form.set("reporter_name", reporter.trim());
      if (photo) form.set("photo", photo);
      return api<{ ticket: OfficeTicket; duplicated: boolean }>("/office/tickets", { form });
    },
    onSuccess: (res) => {
      if (reporter.trim()) localStorage.setItem("hd_reporter", reporter.trim());
      qc.invalidateQueries({ queryKey: ["office-home"] });
      navigate(`/oficina/reporte/${res.ticket.id}?${res.duplicated ? "repetido" : "nuevo"}=1`, { replace: true });
    },
  });

  const needsText = issue === "OTRO" && description.trim().length < 3;

  return (
    <form onSubmit={(e) => { e.preventDefault(); send.mutate(); }} className="flex flex-col gap-8">
      <div className="flex items-center gap-4">
        <span className={`grid size-16 shrink-0 place-items-center rounded-2xl ${info.tone}`}><Icon className="size-9" aria-hidden /></span>
        <div>
          <h1 className="text-3xl font-bold leading-tight">{info.title}</h1>
          {onChangeIssue && <button type="button" onClick={onChangeIssue} className="text-lg text-casma underline">Cambiar problema</button>}
        </div>
      </div>

      {!fixedEquipment && candidates.length > 1 && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-3 text-2xl font-bold">{wantsPrinter ? "¿Qué impresora?" : "¿Qué equipo?"}</legend>
          {[...candidates, { id: OTHER, name: "No sé / otro equipo", patrimonial_code: "", type: "OTRO", hostname: null } as EquipmentBrief].map((eq) => (
            <label key={eq.id} className={cx("flex cursor-pointer items-center gap-4 rounded-2xl border-2 bg-white p-4", equipmentId === eq.id ? "border-casma bg-casma-claro" : "border-linea")}>
              <input type="radio" name="equipment" className="size-7 accent-casma" checked={equipmentId === eq.id} onChange={() => setEquipmentId(eq.id)} />
              <span className="flex-1">
                <span className="block text-xl font-bold">{eq.id === thisEquipment?.id ? `Esta computadora (${eq.name})` : eq.name}</span>
                {eq.patrimonial_code && <span className="text-base text-tenue">Código {eq.patrimonial_code}</span>}
              </span>
              {equipmentId === eq.id && <Check className="size-7 text-casma" aria-hidden />}
            </label>
          ))}
        </fieldset>
      )}
      {fixedEquipment && <p className="rounded-2xl bg-casma-claro p-4 text-xl">Equipo: <strong>{fixedEquipment.name}</strong> ({fixedEquipment.patrimonial_code})</p>}

      <section className="flex flex-col gap-3">
        <label htmlFor="desc" className="text-2xl font-bold">
          Cuéntenos qué pasa {issue !== "OTRO" && <span className="font-normal text-tenue">(si desea)</span>}
        </label>
        <Textarea id="desc" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} className="text-xl" placeholder="Por ejemplo: sale un mensaje de error" />
        <VoiceButton large onText={(t) => setDescription((d) => (d ? `${d} ${t}` : t))} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-2xl font-bold">Foto del problema <span className="font-normal text-tenue">(si desea)</span></h2>
        <PhotoPicker large value={photo} onChange={setPhoto} />
      </section>

      <section className="flex flex-col gap-3">
        <label htmlFor="reporter" className="text-2xl font-bold">Su nombre <span className="font-normal text-tenue">(si desea)</span></label>
        <Input id="reporter" value={reporter} onChange={(e) => setReporter(e.target.value)} maxLength={80} className="h-14 text-xl" autoComplete="name" />
      </section>

      {send.error && <ErrorBox message={errorMessage(send.error)} />}
      <Button type="submit" size="xl" loading={send.isPending} disabled={needsText} className="sticky bottom-4 shadow-lg">
        <Send className="size-7" aria-hidden /> Enviar reporte
      </Button>
      {needsText && <p className="-mt-5 text-center text-tenue">Escriba o diga qué necesita para poder enviar.</p>}
    </form>
  );
}
