import { CloudOff, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const HEALTH_INTERVAL_MS = 30_000;
const HEALTH_TIMEOUT_MS = 4_500;

export function ServerStatusBanner() {
  const [unavailable, setUnavailable] = useState(false);
  const [checking, setChecking] = useState(false);

  const checkServer = useCallback(async () => {
    if (!navigator.onLine) {
      setUnavailable(false);
      setChecking(false);
      return;
    }

    setChecking(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

    try {
      const response = await fetch(`/api/health?_=${Date.now()}`, {
        method: "GET",
        headers: { "X-Requested-With": "HelpDeskCasma" },
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });
      setUnavailable(!response.ok);
      window.dispatchEvent(new CustomEvent("helpdesk-server-status", { detail: { available: response.ok } }));
    } catch {
      setUnavailable(true);
      window.dispatchEvent(new CustomEvent("helpdesk-server-status", { detail: { available: false } }));
    } finally {
      window.clearTimeout(timeout);
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void checkServer();
    const interval = window.setInterval(() => void checkServer(), HEALTH_INTERVAL_MS);
    const onOnline = () => void checkServer();
    const onOffline = () => {
      setUnavailable(false);
      setChecking(false);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void checkServer();
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [checkServer]);

  if (!unavailable || !navigator.onLine) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-900 shadow-[0_18px_45px_rgba(127,29,29,0.18)]"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-red-100 text-red-700">
        <CloudOff className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">Servidor no disponible</p>
        <p className="mt-1 text-xs leading-5 text-red-700">
          Hay conexión de red, pero el backend no responde. El sistema volverá a comprobarlo automáticamente.
        </p>
        <button
          type="button"
          onClick={() => void checkServer()}
          disabled={checking}
          className="mt-2 inline-flex min-h-9 items-center gap-2 rounded-lg border border-red-200 bg-white px-3 text-xs font-bold text-red-800 transition hover:bg-red-100 disabled:cursor-wait disabled:opacity-60"
        >
          <RefreshCw className={`size-3.5 ${checking ? "animate-spin" : ""}`} aria-hidden />
          {checking ? "Comprobando..." : "Reintentar"}
        </button>
      </div>
    </div>
  );
}
