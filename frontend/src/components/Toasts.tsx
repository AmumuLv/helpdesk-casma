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
      <div className="pointer-events-none fixed inset-x-3 bottom-3 z-50 flex flex-col items-end gap-2 sm:left-auto sm:w-96" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cx("pointer-events-auto flex w-full gap-3 rounded-xl border-l-4 bg-white p-4 shadow-lg",
            t.tone === "danger" ? "border-alerta" : t.tone === "success" ? "border-hecho" : "border-casma")}>
            <div className="flex-1">
              <p className="font-bold">{t.title}</p>
              {t.body && <p className="text-sm text-tenue">{t.body}</p>}
            </div>
            <button onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))} aria-label="Cerrar aviso"><X className="size-4" /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
