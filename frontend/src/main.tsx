import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { ApiError } from "./lib/api";
import { router } from "./App";
import { ToastProvider } from "./components/Toasts";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof ApiError && [401, 403, 404].includes(err.status)) && count < 2,
      refetchOnWindowFocus: true,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);


if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      const registration = await navigator.serviceWorker.ready;
      registration.active?.postMessage({ type: "GET_OFFLINE_QUEUE_COUNT" });
      if (navigator.onLine) registration.active?.postMessage({ type: "FLUSH_OFFLINE_TICKETS" });
    } catch (err) {
      console.error("No se pudo registrar el Service Worker", err);
    }
  });

  window.addEventListener("online", () => {
    navigator.serviceWorker.controller?.postMessage({ type: "FLUSH_OFFLINE_TICKETS" });
  });

  navigator.serviceWorker.addEventListener("message", (event) => {
    const message = event.data;
    if (!message?.type) return;

    if (message.type === "OFFLINE_REQUEST_SENT") {
      queryClient.invalidateQueries({ queryKey: ["office-home"] });
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      queryClient.invalidateQueries({ queryKey: ["kpis"] });
      if (message.payload?.id) {
        queryClient.invalidateQueries({ queryKey: ["ticket", message.payload.id] });
        queryClient.invalidateQueries({ queryKey: ["ticket-audit", message.payload.id] });
      }
    }

    window.dispatchEvent(new CustomEvent("helpdesk-offline-sync", { detail: message }));
  });
}
