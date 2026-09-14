export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

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

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Ocurrió un error.";
}
