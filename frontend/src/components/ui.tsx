import { LoaderCircle, X } from "lucide-react";
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { CATEGORY_LABEL, PRIORITY_LABEL, STATUS_LABEL } from "../lib/labels";
import type { TicketCategory, TicketPriority, TicketStatus } from "../lib/types";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

type Variant = "primary" | "secondary" | "danger" | "ghost" | "success";
const VARIANTS: Record<Variant, string> = {
  primary: "border border-casma bg-gradient-to-b from-[#238844] to-casma text-white shadow-[0_4px_12px_rgba(30,122,59,0.18)] hover:-translate-y-0.5 hover:border-casma-oscuro hover:from-casma hover:to-casma-oscuro hover:shadow-[0_7px_16px_rgba(20,83,45,0.22)]",
  secondary: "border border-linea bg-white text-tinta shadow-[0_2px_7px_rgba(31,41,55,0.05)] hover:-translate-y-0.5 hover:border-casma/35 hover:bg-casma-claro/35 hover:text-casma-oscuro hover:shadow-md",
  danger: "border border-alerta/30 bg-white text-alerta shadow-sm hover:-translate-y-0.5 hover:border-alerta/50 hover:bg-alerta-claro",
  ghost: "border border-transparent text-tenue hover:bg-casma-claro/55 hover:text-casma-oscuro",
  success: "border border-casma bg-gradient-to-b from-[#238844] to-casma text-white shadow-[0_4px_12px_rgba(30,122,59,0.18)] hover:-translate-y-0.5 hover:border-casma-oscuro hover:from-casma hover:to-casma-oscuro hover:shadow-[0_7px_16px_rgba(20,83,45,0.22)]",
};

export function Button({ variant = "primary", loading, className, children, disabled, size = "md", ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean; size?: "sm" | "md" | "lg" | "xl" }) {
  const sizes = { sm: "h-9 px-3 text-sm gap-1.5", md: "h-11 px-4 gap-2", lg: "h-13 px-5 text-base gap-2.5", xl: "min-h-16 px-6 text-xl gap-3" };
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center rounded-xl font-bold tracking-[-0.01em] transition-all duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sol/25 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0 active:translate-y-px",
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
      {hint && !error && <p className="text-xs leading-5 text-tenue">{hint}</p>}
      {error && <p className="text-sm font-bold text-alerta" role="alert">{error}</p>}
    </div>
  );
}

const control = "w-full rounded-xl border border-linea bg-white px-3.5 text-tinta shadow-[0_1px_3px_rgba(31,41,55,0.04)] placeholder:text-tenue/65 transition-all duration-150 hover:border-[#cfd6de] focus:border-casma focus:bg-white focus:outline-none focus:ring-4 focus:ring-sol/15 disabled:cursor-not-allowed disabled:bg-papel disabled:text-tenue";

export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(control, "h-11", className)} />;
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(control, "h-11", className)} />;
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(control, "py-3 leading-6", className)} />;

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cx(
        "rounded-2xl border border-linea bg-white shadow-[0_10px_26px_rgba(31,41,55,0.055)] ring-1 ring-white/80",
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
      <span className="grid size-10 place-items-center rounded-xl bg-casma-claro text-casma">
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
  PENDIENTE: "border-sol/45 bg-sol-claro text-[#806000] shadow-[inset_0_0_0_1px_rgba(234,179,8,0.05)]",
  EN_PROCESO: "border-casma/25 bg-casma-claro text-casma-oscuro shadow-[inset_0_0_0_1px_rgba(30,122,59,0.04)]",
  RESUELTO: "border-hecho/25 bg-hecho-claro text-hecho shadow-[inset_0_0_0_1px_rgba(21,128,61,0.04)]",
};
const PRIORITY_STYLE: Record<TicketPriority, string> = {
  BAJA: "border-linea bg-papel text-tenue",
  MEDIA: "border-linea bg-white text-tinta shadow-sm",
  ALTA: "border-alerta bg-alerta text-white shadow-sm",
};

export const Badge = ({ children, className }: { children: ReactNode; className?: string }) => (
  <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-bold leading-none tracking-[-0.01em]", className)}>{children}</span>
);
export const StatusBadge = ({ status }: { status: TicketStatus }) => <Badge className={STATUS_STYLE[status]}>{STATUS_LABEL[status]}</Badge>;
export const PriorityBadge = ({ priority }: { priority: TicketPriority }) => <Badge className={PRIORITY_STYLE[priority]}>{PRIORITY_LABEL[priority]}</Badge>;
export const CategoryBadge = ({ category }: { category: TicketCategory }) => <Badge className="border-casma/15 bg-casma-claro/55 text-casma-oscuro">{CATEGORY_LABEL[category]}</Badge>;

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
        "m-auto w-[calc(100%-1.5rem)] overflow-hidden rounded-2xl border border-linea bg-white p-0 text-tinta shadow-[0_30px_90px_rgba(20,83,45,0.22)] backdrop:bg-casma-oscuro/55 backdrop:backdrop-blur-[3px]",
        wide ? "max-w-4xl" : "max-w-lg",
      )}
    >
      {open && (
        <div className="flex max-h-[90dvh] flex-col">
          <header className="relative flex items-center justify-between gap-4 border-b border-linea bg-gradient-to-r from-casma-claro/75 via-white to-sol-claro/35 px-5 py-4">
            <span className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-casma via-casma to-sol" aria-hidden />
            <h2 className="text-xl font-bold tracking-[-0.02em] text-tinta">{title}</h2>
            <button onClick={onClose} className="rounded-lg border border-transparent p-2 text-tenue transition hover:border-linea hover:bg-white hover:text-tinta" aria-label="Cerrar"><X className="size-5" /></button>
          </header>
          <div className="overflow-y-auto px-5 py-5">{children}</div>
        </div>
      )}
    </dialog>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-tenue">
      <div className="grid size-16 place-items-center rounded-2xl border border-casma/10 bg-casma-claro text-casma shadow-sm [&_svg]:size-8">{icon}</div>
      <p className="mt-1 text-lg font-bold tracking-tight text-tinta">{title}</p>
      {children}
    </div>
  );
}
