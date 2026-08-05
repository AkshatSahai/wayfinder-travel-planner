import { create } from "zustand";

export type WorkspaceTab = "details" | "lodging" | "transport" | "activities" | "itinerary";

interface WorkspaceState {
  tab: WorkspaceTab;
  selectedDestination: string | null;
  aiCache: Record<string, unknown>;
  setTab: (t: WorkspaceTab) => void;
  setSelectedDestination: (d: string | null) => void;
  setCache: (key: string, value: unknown) => void;
}

export const useWorkspace = create<WorkspaceState>((set) => ({
  tab: "details",
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

// -------- Lodging comparison vs. booked --------
// Stays added to the Lodging tab are parked as "candidate" rows: visible in the
// comparison table and on its map, but deliberately kept out of the itinerary
// and the budget total until the traveler books one.
export const LODGING_CANDIDATE = "candidate";
export const LODGING_BOOKED = "booked";

type ItemLike = { kind: string; category?: string | null };

export function isLodgingCandidate(item: ItemLike): boolean {
  return item.kind === "lodging" && item.category === LODGING_CANDIDATE;
}

export function isBookedLodging(item: ItemLike): boolean {
  return item.kind === "lodging" && item.category !== LODGING_CANDIDATE;
}

/** Everything that actually counts — itinerary rows and budget spend. */
export function committedItems<T extends ItemLike>(items: T[]): T[] {
  return items.filter((i) => !isLodgingCandidate(i));
}

// -------- Geo --------
export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_MILES = 3958.8;

export function haversineMiles(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h));
}

// -------- Formatting --------
/** Whole days from today until `date`. Negative once the date has passed. */
export function daysUntil(date?: string | null): number | null {
  if (!date) return null;
  const target = new Date(`${date}T00:00:00`).getTime();
  if (Number.isNaN(target)) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today.getTime()) / 86400000);
}

export function formatHours(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return "—";
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
