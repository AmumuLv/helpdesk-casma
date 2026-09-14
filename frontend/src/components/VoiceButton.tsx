import { Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "./ui";

type Recognition = {
  lang: string; interimResults: boolean; continuous: boolean;
  start(): void; stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null;
};

const getRecognition = (): (new () => Recognition) | undefined =>
  (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;

export function VoiceButton({ onText, large }: { onText: (text: string) => void; large?: boolean }) {
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const Ctor = getRecognition();
  useEffect(() => () => rec.current?.stop(), []);
  if (!Ctor) return null;

  const toggle = () => {
    if (listening) return rec.current?.stop();
    const r = new Ctor();
    r.lang = "es-PE";
    r.interimResults = false;
    r.continuous = true;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) onText(e.results[i][0].transcript.trim());
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    r.start();
    setListening(true);
  };

  return (
    <Button type="button" variant={listening ? "danger" : "secondary"} size={large ? "lg" : "md"} onClick={toggle} aria-pressed={listening}>
      {listening ? <><Square className="size-5" /> Terminar de hablar</> : <><Mic className="size-6" /> Hablar en lugar de escribir</>}
    </Button>
  );
}
