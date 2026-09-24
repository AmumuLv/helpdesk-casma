import { Camera, ImagePlus, ScanLine, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { compressImage } from "../lib/image";
import { api, errorMessage } from "../lib/api";
import { Button, cx } from "./ui";

const isTouchDevice = () => window.matchMedia("(pointer: coarse)").matches;

type PatrimonialOcrResult = {
  detected_code: string | null;
  matched: boolean;
  equipment_id: string | null;
  candidates: string[];
};

type PhotoPickerProps = {
  value: File | null;
  onChange: (f: File | null) => void;
  large?: boolean;
  patrimonialOcr?: boolean;
  onPatrimonialDetected?: (code: string, result: PatrimonialOcrResult) => void;
};

export function PhotoPicker({ value, onChange, large, patrimonialOcr = false, onPatrimonialDetected }: PhotoPickerProps) {
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrMessage, setOcrMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!value) return setPreview(null);
    const url = URL.createObjectURL(value);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  useEffect(() => {
    if (video.current && stream) video.current.srcObject = stream;
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, [stream]);

  const pick = async (file?: File) => {
    if (file) {
      onChange(await compressImage(file, patrimonialOcr ? 2200 : 1600, patrimonialOcr ? 0.9 : 0.85));
    }
  };

  const readPatrimonialLabel = async () => {
    if (!value) return;
    setError(null);
    setOcrMessage(null);
    setOcrLoading(true);
    try {
      const form = new FormData();
      form.append("file", value);
      const result = await api<PatrimonialOcrResult>("/equipment/ocr-patrimonial", { form });
      if (!result.detected_code) {
        setOcrMessage("No se pudo identificar un código patrimonial. Intente acercar más la cámara y evitar reflejos.");
        return;
      }
      setOcrMessage(result.matched ? `Código encontrado: ${result.detected_code}` : `Código leído: ${result.detected_code}`);
      onPatrimonialDetected?.(result.detected_code, result);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setOcrLoading(false);
    }
  };

  const openCamera = async () => {
    setError(null);
    if (isTouchDevice() || !navigator.mediaDevices?.getUserMedia) return cameraInput.current?.click();
    try {
      setStream(await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }));
    } catch {
      setError("No se pudo abrir la cámara. Use «Elegir foto».");
    }
  };

  const capture = () => {
    const v = video.current;
    if (!v) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth || 1280;
    canvas.height = v.videoHeight || 720;
    canvas.getContext("2d")!.drawImage(v, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (blob) onChange(new File([blob], `captura_${Date.now()}.jpg`, { type: "image/jpeg" }));
      stream?.getTracks().forEach((t) => t.stop());
      setStream(null);
    }, "image/jpeg", 0.85);
  };

  const size = large ? "lg" : "md";
  return (
    <div className="flex flex-col gap-3">
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => pick(e.target.files?.[0])} />
      <input ref={galleryInput} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
      {!preview && !stream && (
        <div className="grid grid-cols-2 gap-3">
          <Button type="button" variant="secondary" size={size} className="whitespace-nowrap px-3" onClick={openCamera}><Camera className="size-6" /> Tomar foto</Button>
          <Button type="button" variant="secondary" size={size} className="whitespace-nowrap px-3" onClick={() => galleryInput.current?.click()}><ImagePlus className="size-6" /> Elegir foto</Button>
        </div>
      )}
      {stream && (
        <div className="flex flex-col gap-2 rounded-xl border border-linea bg-tinta p-2">
          <video ref={video} autoPlay playsInline muted className="aspect-video w-full rounded-lg object-cover" />
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="success" onClick={capture}><Camera className="size-5" /> Capturar</Button>
            <Button type="button" variant="secondary" onClick={() => { stream.getTracks().forEach((t) => t.stop()); setStream(null); }}>Cancelar</Button>
          </div>
        </div>
      )}
      {preview && (
        <>
          <div className={cx("relative overflow-hidden rounded-xl border border-linea", large ? "h-56" : "h-40")}>
            <img src={preview} alt={patrimonialOcr ? "Foto de etiqueta patrimonial" : "Foto adjunta"} className="size-full object-cover" />
            <button type="button" onClick={() => { onChange(null); setOcrMessage(null); }} className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-tinta/85 px-3 py-1.5 font-bold text-white">
              <X className="size-4" /> Quitar
            </button>
          </div>
          {patrimonialOcr && (
            <Button type="button" variant="secondary" loading={ocrLoading} onClick={readPatrimonialLabel}>
              <ScanLine className="size-5" /> Leer etiqueta patrimonial
            </Button>
          )}
        </>
      )}
      {ocrMessage && <p className="text-sm font-bold text-casma">{ocrMessage}</p>}
      {error && <p className="text-sm font-bold text-alerta">{error}</p>}
    </div>
  );
}
