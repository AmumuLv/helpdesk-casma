import { LoaderCircle, X } from "lucide-react";
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { CATEGORY_LABEL, PRIORITY_LABEL, STATUS_LABEL } from "../lib/labels";
import type { TicketCategory, TicketPriority, TicketStatus } from "../lib/types";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

type Variant = "primary" | "secondary" | "danger" | "ghost" | "success";
const VARIANTS: Record<Variant, string> = {
  primary: "border border-casma bg-casma text-white shadow-sm hover:border-casma-oscuro hover:bg-casma-oscuro hover:shadow-md",
  secondary: "border border-linea bg-white text-tinta shadow-sm hover:border-casma/35 hover:bg-casma-claro/40 hover:text-casma-oscuro",
  danger: "border border-alerta/30 bg-white text-alerta shadow-sm hover:border-alerta/50 hover:bg-alerta-claro",
  ghost: "border border-transparent text-tenue hover:bg-casma-claro/55 hover:text-casma-oscuro",
  success: "border border-casma bg-casma text-white shadow-sm hover:border-casma-oscuro hover:bg-casma-oscuro hover:shadow-md",
};

export function Button({ variant = "primary", loading, className, children, disabled, size = "md", ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean; size?: "sm" | "md" | "lg" | "xl" }) {
  const sizes = { sm: "h-9 px-3 text-sm gap-1.5", md: "h-11 px-4 gap-2", lg: "h-13 px-5 text-base gap-2.5", xl: "min-h-16 px-6 text-xl gap-3" };
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center rounded-xl font-bold transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-55 active:translate-y-px",
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
      <label htmlFor={id} className="text-sm font-bold text-tinta">{label}</label>
      {children(id)}
      {hint && !error && <p className="text-xs leading-5 text-tenue">{hint}</p>}
      {error && <p className="text-sm font-bold text-alerta" role="alert">{error}</p>}
    </div>
  );
}

const control = "w-full rounded-xl border border-linea bg-white px-3.5 text-tinta shadow-[0_1px_2px_rgba(31,41,55,0.03)] placeholder:text-tenue/65 transition focus:border-casma focus:outline-none focus:ring-3 focus:ring-casma/10 disabled:cursor-not-allowed disabled:bg-papel disabled:text-tenue";

export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(control, "h-11", className)} />;
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(control, "h-11", className)} />;
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(control, "py-3 leading-6", className)} />;

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx("rounded-2xl border border-linea bg-white shadow-[0_8px_24px_rgba(31,41,55,0.045)]", className)}>{children}</section>;
}

export function Spinner({ label = "Cargando" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-tenue" role="status">
      <LoaderCircle className="size-6 animate-spin text-casma" aria-hidden /> {label}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return <div role="alert" className="rounded-xl border border-alerta/25 bg-alerta-claro px-4 py-3 text-sm font-bold text-alerta shadow-sm">{message}</div>;
}

const STATUS_STYLE: Record<TicketStatus, string> = {
  PENDIENTE: "border-sol/45 bg-sol-claro text-[#806000]",
  EN_PROCESO: "border-casma/25 bg-casma-claro text-casma-oscuro",
  RESUELTO: "border-hecho/25 bg-hecho-claro text-hecho",
};
const PRIORITY_STYLE: Record<TicketPriority, string> = {
  BAJA: "border-linea bg-papel text-tenue",
  MEDIA: "border-linea bg-white text-tinta",
  ALTA: "border-alerta bg-alerta text-white shadow-sm",
};

export const Badge = ({ children, className }: { children: ReactNode; className?: string }) => (
  <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-bold leading-none", className)}>{children}</span>
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
        "m-auto w-[calc(100%-1.5rem)] overflow-hidden rounded-2xl border border-linea bg-white p-0 text-tinta shadow-2xl backdrop:bg-casma-oscuro/55 backdrop:backdrop-blur-[2px]",
        wide ? "max-w-4xl" : "max-w-lg",
      )}
    >
      {open && (
        <div className="flex max-h-[90dvh] flex-col">
          <header className="flex items-center justify-between gap-4 border-b border-linea bg-gradient-to-r from-casma-claro/65 to-white px-5 py-4">
            <h2 className="text-xl font-bold tracking-tight text-tinta">{title}</h2>
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
      <div className="grid size-16 place-items-center rounded-2xl bg-casma-claro text-casma [&_svg]:size-8">{icon}</div>
      <p className="mt-1 text-lg font-bold text-tinta">{title}</p>
      {children}
    </div>
  );
}
