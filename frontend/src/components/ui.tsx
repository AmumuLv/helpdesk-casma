import { LoaderCircle, X } from "lucide-react";
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { CATEGORY_LABEL, PRIORITY_LABEL, STATUS_LABEL } from "../lib/labels";
import type { TicketCategory, TicketPriority, TicketStatus } from "../lib/types";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

type Variant = "primary" | "secondary" | "danger" | "ghost" | "success";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-casma text-white hover:bg-casma-oscuro",
  secondary: "bg-white text-tinta border border-linea hover:border-tinta",
  danger: "bg-white text-alerta border border-alerta/40 hover:bg-alerta-claro",
  ghost: "text-tenue hover:text-tinta hover:bg-tinta/5",
  success: "bg-hecho text-white hover:brightness-95",
};

export function Button({ variant = "primary", loading, className, children, disabled, size = "md", ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean; size?: "sm" | "md" | "lg" | "xl" }) {
  const sizes = { sm: "h-9 px-3 text-sm gap-1.5", md: "h-11 px-4 gap-2", lg: "h-14 px-6 text-lg gap-2.5", xl: "min-h-18 px-6 text-2xl gap-3" };
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={cx("inline-flex items-center justify-center rounded-xl font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60", sizes[size], VARIANTS[variant], className)}
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
      <label htmlFor={id} className="font-bold text-tinta">{label}</label>
      {children(id)}
      {hint && !error && <p className="text-sm text-tenue">{hint}</p>}
      {error && <p className="text-sm font-bold text-alerta" role="alert">{error}</p>}
    </div>
  );
}

const control = "w-full rounded-xl border border-linea bg-white px-3.5 text-tinta placeholder:text-tenue/70 focus:border-casma focus:outline-none focus:ring-2 focus:ring-casma/30 disabled:bg-papel";

export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(control, "h-11", className)} />;
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(control, "h-11", className)} />;
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(control, "py-3", className)} />;

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx("rounded-2xl border border-linea bg-white", className)}>{children}</section>;
}

export function Spinner({ label = "Cargando" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-tenue" role="status">
      <LoaderCircle className="size-6 animate-spin" aria-hidden /> {label}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return <div role="alert" className="rounded-xl border border-alerta/30 bg-alerta-claro px-4 py-3 font-bold text-alerta">{message}</div>;
}

const STATUS_STYLE: Record<TicketStatus, string> = {
  PENDIENTE: "bg-sol-claro text-[#7a5200] border-sol/40",
  EN_PROCESO: "bg-casma-claro text-casma-oscuro border-casma/30",
  RESUELTO: "bg-hecho-claro text-hecho border-hecho/30",
};
const PRIORITY_STYLE: Record<TicketPriority, string> = {
  BAJA: "bg-papel text-tenue border-linea",
  MEDIA: "bg-white text-tinta border-linea",
  ALTA: "bg-alerta text-white border-alerta",
};

export const Badge = ({ children, className }: { children: ReactNode; className?: string }) => (
  <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-sm font-bold", className)}>{children}</span>
);
export const StatusBadge = ({ status }: { status: TicketStatus }) => <Badge className={STATUS_STYLE[status]}>{STATUS_LABEL[status]}</Badge>;
export const PriorityBadge = ({ priority }: { priority: TicketPriority }) => <Badge className={PRIORITY_STYLE[priority]}>{PRIORITY_LABEL[priority]}</Badge>;
export const CategoryBadge = ({ category }: { category: TicketCategory }) => <Badge className="border-tinta/15 bg-tinta/5 text-tinta">{CATEGORY_LABEL[category]}</Badge>;

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
      className={cx("m-auto w-[calc(100%-1.5rem)] rounded-2xl bg-white p-0 text-tinta backdrop:bg-tinta/60", wide ? "max-w-4xl" : "max-w-lg")}
    >
      {open && (
        <div className="flex max-h-[90dvh] flex-col">
          <header className="flex items-center justify-between gap-4 border-b border-linea px-5 py-4">
            <h2 className="text-xl font-bold">{title}</h2>
            <button onClick={onClose} className="rounded-lg p-2 hover:bg-papel" aria-label="Cerrar"><X className="size-5" /></button>
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
      <div className="text-linea [&_svg]:size-12">{icon}</div>
      <p className="text-lg font-bold text-tinta">{title}</p>
      {children}
    </div>
  );
}
