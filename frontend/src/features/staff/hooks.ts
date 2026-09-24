import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "../../components/Toasts";
import { api, errorMessage, isOfflineQueued, type OfflineQueuedResponse } from "../../lib/api";
import { useMe } from "../../lib/session";
import type { Device, Equipment, Insights, Kpis, Office, StaffMember, Ticket } from "../../lib/types";

export type OfficeLookup = {
  id: string; code: string; name: string; zone_id: string | null; zone_name: string | null;
  location: string | null; head_name: string | null;
};

export const useIsAdmin = () => useMe().data?.staff?.role === "ADMIN";
export const useTechnicians = () => useQuery({ queryKey: ["technicians"], queryFn: () => api<StaffMember[]>("/technicians"), staleTime: 60_000 });
export const useOfficeLookup = () => useQuery({ queryKey: ["offices", "lookup"], queryFn: () => api<OfficeLookup[]>("/lookup/offices"), staleTime: 300_000 });
export const useKpis = () => useQuery({ queryKey: ["kpis"], queryFn: () => api<Kpis>("/tickets/kpis"), refetchInterval: 60_000 });
export const useInsights = (enabled = true) => useQuery({ queryKey: ["insights"], queryFn: () => api<Insights>("/ai/insights"), staleTime: 120_000, enabled });
export const useOffices = () => useQuery({ queryKey: ["offices", "admin"], queryFn: () => api<Office[]>("/admin/offices") });
export const useDevices = (status?: string) =>
  useQuery({ queryKey: ["devices", status ?? "all"], queryFn: () => api<Device[]>(`/admin/devices${status ? `?status=${status}` : ""}`) });
export const useEquipmentList = (officeId?: string) =>
  useQuery({ queryKey: ["equipment", officeId ?? "all"], queryFn: () => api<Equipment[]>(`/equipment${officeId ? `?office_id=${officeId}` : ""}`), enabled: officeId !== "" });

export function useTicketAction<TBody = unknown>(buildPath: (id: string) => string, method = "POST", successText?: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body?: TBody }) => api<Ticket | OfflineQueuedResponse>(buildPath(id), { method, json: body ?? {} }),
    onSuccess: (result, variables) => {
      if (isOfflineQueued(result)) {
        toast({
          tone: "success",
          title: "Acción guardada sin conexión",
          body: "Quedó pendiente de sincronización y se aplicará automáticamente cuando vuelva internet.",
        });
        qc.invalidateQueries({ queryKey: ["ticket-audit", variables.id] });
        return;
      }
      qc.setQueryData(["ticket", result.id], result);
      qc.invalidateQueries({ queryKey: ["tickets"] });
      qc.invalidateQueries({ queryKey: ["ticket-audit", result.id] });
      qc.invalidateQueries({ queryKey: ["kpis"] });
      if (successText) toast({ tone: "success", title: successText, body: result.number });
    },
    onError: (err) => toast({ tone: "danger", title: "No se pudo completar", body: errorMessage(err) }),
  });
}
