import { LoaderCircle, X } from "lucide-react";
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { CATEGORY_LABEL, PRIORITY_LABEL, STATUS_LABEL } from "../lib/labels";
import type { TicketCategory, TicketPriority, TicketStatus } from "../lib/types";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

type Variant = "primary" | "secondary" | "danger" | "ghost" | "success";
const VARIANTS: Record<Variant, string> = {
  primary: "border border-casma-oscuro bg-casma text-white shadow-[0_7px_18px_rgba(21,128,61,0.20)] hover:-translate-y-0.5 hover:bg-casma-oscuro hover:shadow-[0_10px_22px_rgba(22,101,52,0.24)]",
  secondary: "border border-linea bg-white text-tinta shadow-sm hover:-translate-y-0.5 hover:border-casma/35 hover:bg-casma-claro/70 hover:text-casma-oscuro hover:shadow-md",
  danger: "border border-alerta/25 bg-white text-alerta shadow-sm hover:-translate-y-0.5 hover:border-alerta/45 hover:bg-alerta-claro",
  ghost: "border border-transparent text-tenue hover:bg-casma-claro/65 hover:text-casma-oscuro",
  success: "border border-hecho bg-hecho text-white shadow-[0_7px_18px_rgba(4,120,87,0.18)] hover:-translate-y-0.5 hover:bg-emerald-800 hover:shadow-[0_10px_22px_rgba(4,120,87,0.22)]",
};

export function Button({ variant = "primary", loading, className, children, disabled, size = "md", ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean; size?: "sm" | "md" | "lg" | "xl" }) {
  const sizes = {
    sm: "min-h-11 px-3 text-sm gap-1.5",
    md: "min-h-11 px-4 text-sm gap-2",
    lg: "min-h-12 px-5 text-base gap-2.5",
    xl: "min-h-14 px-6 text-lg sm:text-xl gap-3",
  };
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center rounded-xl font-bold tracking-[-0.01em] transition-all duration-150 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0 active:translate-y-px",
        sizes[size],
        VARIANTS[variant],
        className,
      )}
    >
      {loading && <LoaderCircle className="size-5 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string | null; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-bold tracking-[-0.01em] text-tinta">{label}</label>
      {children(id)}
      {hint && !error && <p className="text-sm leading-5 text-tenue">{hint}</p>}
      {error && <p className="text-sm font-bold text-alerta" role="alert">{error}</p>}
    </div>
  );
}

const control = "w-full rounded-xl border border-linea bg-white px-3.5 text-tinta shadow-[0_1px_3px_rgba(15,23,42,0.035)] placeholder:text-tenue/75 transition-all duration-150 hover:border-slate-400 focus:border-casma focus:bg-white focus:outline-none focus:ring-4 focus:ring-casma/10 disabled:cursor-not-allowed disabled:bg-papel disabled:text-tenue";

export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(control, "h-11", className)} />;
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(control, "h-11", className)} />;
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(control, "py-3 leading-6", className)} />;

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cx(
        "rounded-2xl border border-linea/90 bg-white shadow-[0_10px_28px_rgba(15,23,42,0.05)]",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function Spinner({ label = "Cargando" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-sm font-medium text-tenue" role="status">
      <span className="grid size-10 place-items-center rounded-xl bg-casma-claro text-casma-oscuro">
        <LoaderCircle className="size-5 animate-spin" aria-hidden />
      </span>
      {label}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return <div role="alert" className="rounded-xl border border-alerta/25 bg-alerta-claro px-4 py-3 text-sm font-bold text-alerta shadow-sm">{message}</div>;
}

const STATUS_STYLE: Record<TicketStatus, string> = {
  PENDIENTE: "border-amber-300 bg-amber-50 text-amber-900",
  EN_PROCESO: "border-sky-300 bg-sky-50 text-sky-900",
  RESUELTO: "border-emerald-300 bg-emerald-50 text-emerald-900",
};
const PRIORITY_STYLE: Record<TicketPriority, string> = {
  BAJA: "border-slate-300 bg-slate-100 text-slate-800",
  MEDIA: "border-slate-300 bg-white text-slate-800 shadow-sm",
  ALTA: "border-red-300 bg-red-50 text-red-900",
};

export const Badge = ({ children, className }: { children: ReactNode; className?: string }) => (
  <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-bold leading-none tracking-[-0.01em]", className)}>{children}</span>
);
export const StatusBadge = ({ status }: { status: TicketStatus }) => <Badge className={STATUS_STYLE[status]}>{STATUS_LABEL[status]}</Badge>;
export const PriorityBadge = ({ priority }: { priority: TicketPriority }) => <Badge className={PRIORITY_STYLE[priority]}>{PRIORITY_LABEL[priority]}</Badge>;
export const CategoryBadge = ({ category }: { category: TicketCategory }) => <Badge className="border-slate-300 bg-slate-100 text-slate-800">{CATEGORY_LABEL[category]}</Badge>;

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx(
        "m-auto w-[calc(100%-1rem)] overflow-hidden rounded-2xl border border-linea bg-white p-0 text-tinta shadow-[0_32px_100px_rgba(15,23,42,0.28)] backdrop:bg-slate-950/55 backdrop:backdrop-blur-[3px] sm:w-[calc(100%-1.5rem)]",
        wide ? "max-w-4xl" : "max-w-lg",
      )}
    >
      {open && (
        <div className="flex max-h-[92dvh] flex-col sm:max-h-[90dvh]">
          <header className="flex items-center justify-between gap-4 border-b border-linea bg-white px-4 py-4 sm:px-5">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-casma-oscuro">Help Desk Municipal</p>
              <h2 className="mt-1 truncate text-xl font-bold tracking-[-0.02em] text-tinta">{title}</h2>
            </div>
            <button onClick={onClose} className="grid size-11 shrink-0 place-items-center rounded-xl border border-transparent text-tenue transition hover:border-linea hover:bg-papel hover:text-tinta" aria-label="Cerrar"><X className="size-5" /></button>
          </header>
          <div className="overflow-y-auto bg-papel/55 px-4 py-4 sm:px-5 sm:py-5">{children}</div>
        </div>
      )}
    </dialog>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-5 py-12 text-center text-tenue sm:px-6">
      <div className="grid size-16 place-items-center rounded-2xl bg-casma-claro text-casma-oscuro shadow-sm [&_svg]:size-8">{icon}</div>
      <p className="mt-1 text-lg font-bold tracking-tight text-tinta">{title}</p>
      {children}
    </div>
  );
}
