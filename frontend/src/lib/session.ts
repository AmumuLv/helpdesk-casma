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
    navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_PRIVATE_OFFLINE_CACHE" });
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    qc.clear();
    qc.setQueryData(["me"], null);
  };
}

const TICKET_INVALIDATIONS = [["tickets"], ["workboard"], ["ticket"], ["kpis"], ["follow-up-metrics"], ["office-home"], ["office-ticket"]];

const INVALIDATIONS: Record<string, string[][]> = {
  "ticket.created": [["tickets"], ["workboard"], ["kpis"], ["follow-up-metrics"], ["office-home"]],
  "ticket.updated": TICKET_INVALIDATIONS,
  "ticket.note": TICKET_INVALIDATIONS,
  "ticket.resolved": TICKET_INVALIDATIONS,
  "ticket.reopened": TICKET_INVALIDATIONS,
  "ticket.assigned": TICKET_INVALIDATIONS,
  "ticket.reassigned": TICKET_INVALIDATIONS,
  "ticket.unassigned": TICKET_INVALIDATIONS,
  "ticket.waiting": TICKET_INVALIDATIONS,
  "ticket.resumed": TICKET_INVALIDATIONS,
  "ticket.followup_due": [["tickets"], ["workboard"], ["follow-up-metrics"]],
  "device.pending": [["devices"], ["offices"]],
  "device.reviewed": [["devices"], ["offices"]],
  "alert.created": [["insights"], ["office-home"]],
};

export type LiveEvent = {
  type: string;
  title?: string;
  message?: string;
  ticket_id?: string;
  number?: string;
  subject?: string;
  office?: string;
  status?: string;
  priority?: string;
  pair_code?: string;
  assigned_to_id?: string | null;
  assigned_to_name?: string | null;
  previous_technician_name?: string | null;
  reporter_name?: string | null;
  visible_to_office?: boolean;
  wait_reason?: string;
  wait_reason_label?: string;
  follow_up_state?: string;
  follow_up_label?: string;
};

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
