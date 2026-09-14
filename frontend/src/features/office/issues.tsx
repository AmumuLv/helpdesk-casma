import { CircleQuestionMark, KeyRound, MonitorX, Printer, Snail, WifiOff, type LucideIcon } from "lucide-react";
import type { QuickIssue } from "../../lib/types";

export const ISSUES: Record<QuickIssue, { title: string; hint: string; icon: LucideIcon; tone: string }> = {
  NO_ENCIENDE: { title: "La computadora no prende", hint: "No enciende o la pantalla está negra", icon: MonitorX, tone: "bg-alerta-claro text-alerta" },
  SIN_INTERNET: { title: "No hay internet", hint: "No abren las páginas ni el correo", icon: WifiOff, tone: "bg-casma-claro text-casma-oscuro" },
  IMPRESORA: { title: "La impresora no imprime", hint: "Se atasca, no imprime o sale mal", icon: Printer, tone: "bg-sol-claro text-[#7a5200]" },
  LENTA: { title: "Está muy lenta", hint: "Se cuelga o demora mucho", icon: Snail, tone: "bg-hecho-claro text-hecho" },
  SISTEMA: { title: "No puedo entrar al sistema", hint: "SIAF, trámite documentario, correo o clave", icon: KeyRound, tone: "bg-tinta/10 text-tinta" },
  OTRO: { title: "Otro problema", hint: "Cuéntenos qué necesita", icon: CircleQuestionMark, tone: "bg-papel text-tenue" },
};

export const ISSUE_ORDER: QuickIssue[] = ["NO_ENCIENDE", "SIN_INTERNET", "IMPRESORA", "LENTA", "SISTEMA", "OTRO"];

export const isQuickIssue = (v: string | undefined | null): v is QuickIssue => !!v && v in ISSUES;
