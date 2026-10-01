import { X } from "lucide-react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { cx } from "./ui";

type Toast = { id: number; title: string; body?: string; tone: "info" | "success" | "danger" };
const ToastContext = createContext<(t: Omit<Toast, "id">) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((all) => [...all.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), 7000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-2 bottom-3 z-50 flex flex-col items-end gap-2 sm:left-auto sm:right-3 sm:w-96" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cx(
            "animate-rise pointer-events-auto flex w-full items-start gap-2.5 rounded-xl border border-linea border-l-[3px] bg-white p-3",
            t.tone === "danger" ? "border-l-alerta" : t.tone === "success" ? "border-l-hecho" : "border-l-casma",
          )}
          style={{ boxShadow: "var(--shadow-pop)" }}
        >
            <div className="min-w-0 flex-1">
              <p className="text-[0.85rem] font-bold text-tinta">{t.title}</p>
              {t.body && <p className="mt-0.5 text-[0.78rem] leading-5 text-tenue">{t.body}</p>}
            </div>
            <button
              onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}
              className="grid size-8 shrink-0 place-items-center rounded-lg text-tenue transition hover:bg-papel-2 hover:text-tinta"
              aria-label="Cerrar aviso"
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
