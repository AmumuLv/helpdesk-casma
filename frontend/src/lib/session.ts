import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api, ApiError } from "./api";
import type { Me } from "./types";

export function useMe() {
  const query = useQuery<Me | null>({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api<Me>("/auth/me");
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
  });
  return { ...query, isLoading: query.isLoading || (query.isFetching && !query.data) };
}

export function useLogout() {
  const qc = useQueryClient();
  return async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    qc.clear();
    qc.setQueryData(["me"], null);
  };
}

const INVALIDATIONS: Record<string, string[][]> = {
  "ticket.created": [["tickets"], ["kpis"], ["office-home"]],
  "ticket.updated": [["tickets"], ["ticket"], ["kpis"], ["office-home"], ["office-ticket"]],
  "ticket.resolved": [["tickets"], ["ticket"], ["kpis"], ["office-home"], ["office-ticket"]],
  "ticket.reopened": [["tickets"], ["ticket"], ["kpis"], ["office-home"], ["office-ticket"]],
  "ticket.assigned": [["tickets"], ["ticket"], ["kpis"]],
  "device.pending": [["devices"], ["offices"]],
  "device.reviewed": [["devices"], ["offices"]],
  "alert.created": [["insights"], ["office-home"]],
};

export type LiveEvent = { type: string; title?: string; message?: string; number?: string; subject?: string; office?: string; priority?: string; pair_code?: string };

export function useLiveEvents(enabled: boolean, onEvent?: (e: LiveEvent) => void) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const source = new EventSource("/api/events");
    const handler = (msg: MessageEvent) => {
      const data = JSON.parse(msg.data) as LiveEvent;
      for (const key of INVALIDATIONS[data.type] ?? []) qc.invalidateQueries({ queryKey: key });
      onEvent?.(data);
    };
    Object.keys(INVALIDATIONS).forEach((t) => source.addEventListener(t, handler));
    return () => source.close();
  }, [enabled, qc, onEvent]);
}
