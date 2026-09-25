export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export type OfflineQueuedResponse = {
  offline_queued: true;
  queue_id: string;
  scope: "office" | "staff";
};

export const isOfflineQueued = (value: unknown): value is OfflineQueuedResponse =>
  !!value
  && typeof value === "object"
  && (value as { offline_queued?: unknown }).offline_queued === true;

type Options = { method?: string; json?: unknown; form?: FormData; signal?: AbortSignal };

export async function api<T>(path: string, { method, json, form, signal }: Options = {}): Promise<T> {
  const headers: Record<string, string> = { "X-Requested-With": "HelpDeskCasma" };
  let body: BodyInit | undefined;
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  } else if (form) {
    body = form;
  }
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { method: method ?? (body ? "POST" : "GET"), headers, body, credentials: "same-origin", signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError(0, "No hay conexión con el servidor. Revise su internet.");
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.detail;
    if (typeof detail === "string") throw new ApiError(response.status, detail);
    if (detail && typeof detail === "object" && !Array.isArray(detail)) throw new ApiError(response.status, detail.message ?? "Error", detail.code);
    if (Array.isArray(detail)) throw new ApiError(response.status, detail.map((d: { msg: string }) => d.msg.replace(/^Value error, /, "")).join(" "));
    if (response.status === 429) throw new ApiError(429, "Demasiados intentos. Espere un momento.");
    throw new ApiError(response.status, "Ocurrió un error. Intente nuevamente.");
  }
  return data as T;
}

export async function downloadApiFile(path: string, fallbackName: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: "GET",
      headers: { "X-Requested-With": "HelpDeskCasma" },
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "No hay conexión con el servidor. Revise su internet.");
  }

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const detail = data?.detail;
    throw new ApiError(
      response.status,
      typeof detail === "string" ? detail : "No se pudo descargar el archivo.",
    );
  }

  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const match = disposition.match(/filename="?([^";]+)"?/i);
  const filename = match?.[1] || fallbackName;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Ocurrió un error.";
}
