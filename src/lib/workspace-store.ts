import { create } from "zustand";

export type WorkspaceTab = "destination" | "lodging" | "transport" | "activities" | "itinerary";

interface WorkspaceState {
  tab: WorkspaceTab;
  selectedDestination: string | null;
  aiCache: Record<string, unknown>;
  setTab: (t: WorkspaceTab) => void;
  setSelectedDestination: (d: string | null) => void;
  setCache: (key: string, value: unknown) => void;
}

export const useWorkspace = create<WorkspaceState>((set) => ({
  tab: "destination",
  selectedDestination: null,
  aiCache: {},
  setTab: (tab: WorkspaceTab) => set({ tab }),
  setSelectedDestination: (selectedDestination: string | null) => set({ selectedDestination }),
  setCache: (key: string, value: unknown) =>
    set((s: WorkspaceState) => ({ aiCache: { ...s.aiCache, [key]: value } })),
}));

export function formatMoney(cents: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format((cents ?? 0) / 100);
}

export function daysBetween(a?: string | null, b?: string | null): number {
  if (!a || !b) return 0;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.max(1, Math.round(ms / 86400000) + 1);
}
