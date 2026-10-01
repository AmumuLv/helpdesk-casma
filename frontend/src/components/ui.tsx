import { LoaderCircle, X } from "lucide-react";
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { CATEGORY_LABEL, PRIORITY_LABEL, STATUS_LABEL } from "../lib/labels";
import type { TicketCategory, TicketPriority, TicketStatus } from "../lib/types";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

/* ---------------------------------------------------------------- Botones */

type Variant = "primary" | "secondary" | "danger" | "ghost" | "success" | "selected";

const VARIANTS: Record<Variant, string> = {
  primary:
    "border border-transparent text-white " +
    "bg-[linear-gradient(135deg,var(--color-casma)_0%,var(--color-casma-oscuro)_100%)] " +
    "hover:brightness-110 active:brightness-95",
  secondary: "border border-linea-fuerte bg-white text-tinta-2 hover:border-casma/40 hover:bg-casma-claro/50 hover:text-casma-oscuro",
  danger: "border border-alerta/30 bg-white text-alerta hover:border-alerta/50 hover:bg-alerta-claro",
  ghost: "border border-transparent text-tenue hover:bg-papel-2 hover:text-tinta",
  success:
    "border border-transparent text-white " +
    "bg-[linear-gradient(135deg,var(--color-hecho)_0%,#0e7490_100%)] hover:brightness-110",
  selected: "border border-casma/45 bg-casma-claro text-casma-oscuro hover:bg-casma-claro/70",
};

export function Button({ variant = "secondary", loading, className, children, disabled, size = "md", ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean; size?: "sm" | "md" | "lg" | "xl" }) {
  const sizes = {
    sm: "min-h-9 gap-1.5 px-2.5 text-[0.8rem]",
    md: "min-h-10 gap-2 px-3.5 text-[0.85rem]",
    lg: "min-h-11 gap-2 px-4 text-sm",
    xl: "min-h-13 gap-2.5 px-5 text-base",
  };
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center rounded-lg font-semibold tracking-[-0.005em] transition-all duration-100",
        "focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        "active:translate-y-px [&_svg]:shrink-0",
        sizes[size],
        VARIANTS[variant],
        // Solo el botón con relleno recibe brillo; los demás usan sombra plana.
        variant === "primary" || variant === "success" ? "shadow-[var(--glow-marca)] hover:shadow-[var(--glow-marca)]" : "",
        className,
      )}
    >
      {loading && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/* ------------------------------------------------------------ Formularios */

export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string | null; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="label">{label}</label>
      {children(id)}
      {hint && !error && <p className="hint">{hint}</p>}
      {error && <p className="text-[0.78rem] font-semibold text-alerta" role="alert">{error}</p>}
    </div>
  );
}

const control =
  "w-full rounded-lg border border-linea bg-white px-3 text-[0.875rem] text-tinta transition-colors " +
  "placeholder:text-tenue-2 hover:border-linea-fuerte focus:border-casma focus:outline-none focus:ring-[3px] focus:ring-casma/10 " +
  "disabled:cursor-not-allowed disabled:bg-papel-2 disabled:text-tenue";

export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(control, "h-10", className)} />;
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(control, "h-10", className)} />;
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(control, "py-2.5 leading-6", className)} />;

/* ----------------------------------------------------------- Superficies */

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx("panel", className)}>{children}</section>;
}

export function Spinner({ label = "Cargando" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2.5 py-12 text-sm text-tenue" role="status">
      <LoaderCircle className="size-4 animate-spin text-casma" aria-hidden />
      {label}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return <div role="alert" className="rounded-lg border border-alerta/25 bg-alerta-claro px-3.5 py-2.5 text-[0.83rem] font-semibold text-alerta">{message}</div>;
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-5 py-14 text-center">
      <div className="grid size-11 place-items-center rounded-xl border border-linea bg-papel-2 text-tenue [&_svg]:size-5">{icon}</div>
      <p className="mt-1 text-[0.9rem] font-bold text-tinta">{title}</p>
      {children && <p className="max-w-sm text-[0.8rem] leading-5 text-tenue">{children}</p>}
    </div>
  );
}

/* --------------------------------------------------------------- Insignias */

/* Colores de estado: son señales funcionales, no decoración. Se mantienen
   distinguibles entre sí y legibles sobre los neutros fríos actuales. */
const STATUS_STYLE: Record<TicketStatus, string> = {
  PENDIENTE: "border-amber-300/70 bg-amber-50 text-amber-800",
  EN_PROCESO: "border-sky-300/70 bg-sky-50 text-sky-800",
  RESUELTO: "border-emerald-300/70 bg-emerald-50 text-emerald-800",
};
const PRIORITY_STYLE: Record<TicketPriority, string> = {
  BAJA: "border-linea bg-papel-2 text-tenue",
  MEDIA: "border-linea-fuerte bg-white text-tinta-2",
  ALTA: "border-red-300/70 bg-red-50 text-red-700",
};

export const Badge = ({ children, className }: { children: ReactNode; className?: string }) => (
  <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[0.7rem] font-bold leading-4", className)}>{children}</span>
);
export const StatusBadge = ({ status }: { status: TicketStatus }) => <Badge className={STATUS_STYLE[status]}>{STATUS_LABEL[status]}</Badge>;
export const PriorityBadge = ({ priority }: { priority: TicketPriority }) => <Badge className={PRIORITY_STYLE[priority]}>{PRIORITY_LABEL[priority]}</Badge>;
export const CategoryBadge = ({ category }: { category: TicketCategory }) => <Badge className="border-casma/25 bg-casma-claro text-casma-oscuro">{CATEGORY_LABEL[category]}</Badge>;

/* ---------------------------------------------------------------- Métrica */

export function Stat({ label, value, helper, tone = "default" }: {
  label: string;
  value: ReactNode;
  helper?: ReactNode;
  tone?: "default" | "positive" | "warning" | "critical" | "accent";
}) {
  const valueTone = {
    default: "text-tinta",
    positive: "text-emerald-700",
    warning: "text-amber-700",
    critical: "text-red-700",
    accent: "text-casma-oscuro",
  }[tone];
  return (
    <div className="stat">
      <p className="stat-label">{label}</p>
      <p className={cx("stat-value", valueTone)}>{value ?? "–"}</p>
      {helper && <p className="stat-helper">{helper}</p>}
    </div>
  );
}

/* ------------------------------------------------- Control segmentado */

export function Segmented<T extends string>({ value, options, onChange, ariaLabel, className }: {
  value: T;
  options: { value: T; label: string; count?: number }[];
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div className={cx("segmented -mx-1 overflow-x-auto px-1 py-1", className)} role="tablist" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count != null && option.count > 0 && <span className={cx("ml-1.5 text-[0.7rem]", value === option.value ? "text-white/70" : "text-tenue-2")}>{option.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- Modal */

export function Modal({ open, onClose, title, subtitle, children, wide }: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  wide?: boolean;
}) {
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
        "m-auto w-[calc(100%-1rem)] overflow-hidden rounded-xl border border-linea bg-white p-0 text-tinta backdrop:bg-tinta/45 sm:w-[calc(100%-1.5rem)]",
        wide ? "max-w-5xl" : "max-w-lg",
      )}
      style={{ boxShadow: "var(--shadow-pop)" }}
    >
      {open && (
        <div className="flex max-h-[92dvh] flex-col sm:max-h-[90dvh]">
          <header className="flex items-start justify-between gap-4 border-b border-linea px-5 py-3.5">
            <div className="min-w-0">
              <h2 className="truncate text-base font-bold tracking-[-0.02em] text-tinta">{title}</h2>
              {subtitle && <p className="mt-0.5 text-[0.78rem] leading-5 text-tenue">{subtitle}</p>}
            </div>
            <button onClick={onClose} className="grid size-9 shrink-0 place-items-center rounded-lg text-tenue transition hover:bg-papel-2 hover:text-tinta" aria-label="Cerrar"><X className="size-4.5" /></button>
          </header>
          <div className="overflow-y-auto bg-papel-2/40 px-5 py-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}
