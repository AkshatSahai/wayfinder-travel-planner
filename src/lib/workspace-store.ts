import { create } from "zustand";

export type WorkspaceTab = "details" | "lodging" | "activities" | "itinerary";

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

type ItemLike = { kind: string; category?: string | null; day_index?: number | null };

export function isLodgingCandidate(item: ItemLike): boolean {
  return item.kind === "lodging" && item.category === LODGING_CANDIDATE;
}

export function isBookedLodging(item: ItemLike): boolean {
  return item.kind === "lodging" && item.category !== LODGING_CANDIDATE;
}

// -------- Activities: staged vs scheduled --------
// The activity-side counterpart of lodging's candidate/booked split. Activities
// added on the Activities tab are *staged*: collected in that tab's list but
// deliberately not placed on any day until "Build out itinerary" schedules them.
//
// The discriminator is a NULL `day_index`, not `category` — activity rows already
// use `category` for their own taxonomy (Food, Nature, …), so the lodging trick
// can't be reused here. `trip_items.day_index` was already nullable, so this
// needs no migration: "no day" literally means "not on the itinerary".
export function isStagedActivity(item: ItemLike): boolean {
  return item.kind === "activity" && item.day_index == null;
}

/** Everything that actually counts — itinerary rows and budget spend. */
export function committedItems<T extends ItemLike>(items: T[]): T[] {
  return items.filter((i) => !isLodgingCandidate(i) && !isStagedActivity(i));
}

/** The Activities tab's staging list: added, not yet scheduled. */
export function stagedActivities<T extends ItemLike>(items: T[]): T[] {
  return items.filter(isStagedActivity);
}

// -------- Itinerary ordering --------
// Anything that places rows on a day must funnel through here.
//
// Both the AI planner (A2) and the itinerary chat (A3) hand back a day plus a
// position, and neither sees the rows already sitting on that day — the planner
// is only given staged activities, and the chat only names what it is changing.
// Applied verbatim their positions collide with existing rows, including the
// booked lodging block, which makes intra-day order arbitrary and destabilises
// the next drag. Renumbering every row on each touched day is the fix.

export interface OrderableRow {
  id: string;
  /** Minutes since midnight, when a time is known — used to order the day. */
  minutes: number | null;
  /** Existing position, used to break ties and to keep untimed rows stable. */
  prior: number;
}

/** Minutes since midnight from an "HH:MM" string, or null if unparseable. */
export function minutesFromClock(hhmm: string | null | undefined): number | null {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Minutes since midnight from a timestamp column value, or null.
 *
 * Read in UTC to match how `timestampFor` writes it: the column is a
 * TIMESTAMPTZ, but the app only ever means a day's *local wall-clock* time,
 * never a real instant. Writing and reading both in UTC keeps "9 AM" meaning
 * the same thing everywhere, regardless of the browser's timezone — reading
 * with `getHours()` (local) previously drifted from what was written whenever
 * the browser wasn't in UTC, which is what made "start at 9 AM" changes not
 * match the displayed order.
 */
export function minutesFromTimestamp(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d.getUTCHours() * 60 + d.getUTCMinutes();
}

/**
 * Combine a trip's start date, a 0-based day offset, and a wall-clock "HH:MM"
 * into a timestamp, written as UTC so it round-trips through minutesFromTimestamp
 * without drifting. This is a label for "9:00 AM on this day of the trip", not a
 * real instant — see minutesFromTimestamp.
 */
export function timestampFor(
  startDate: string | null | undefined,
  dayIndex: number,
  hhmm: string | null | undefined,
): string | null {
  if (!hhmm || !startDate) return null;
  if (!/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
  const d = new Date(`${startDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dayIndex);
  const [h, m] = hhmm.split(":");
  return `${d.toISOString().slice(0, 10)}T${h.padStart(2, "0")}:${m}:00.000Z`;
}

/** Format a timestamp written by `timestampFor` back into "H:MM AM/PM", in UTC. */
export function formatClockUTC(ts: string | null | undefined): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

/**
 * Assign each row a unique 0-based position within its day: timed rows first in
 * clock order, untimed rows after them keeping their previous relative order.
 * Returns id → new sort_order.
 */
export function renumberDay(rows: OrderableRow[]): Map<string, number> {
  const order = new Map<string, number>();
  rows
    .slice()
    .sort((a, b) => {
      const ma = a.minutes ?? Number.MAX_SAFE_INTEGER;
      const mb = b.minutes ?? Number.MAX_SAFE_INTEGER;
      return ma - mb || a.prior - b.prior;
    })
    .forEach((r, i) => order.set(r.id, i));
  return order;
}

// -------- Geo --------
export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Pull coordinates off a `trip_items.details` blob.
 *
 * Reads `details.coords.{lat,lng}` — the convention every writer in this
 * codebase uses (AI enrichment, lodging, `enrichActivityLocation`) — except
 * one: activities added via the Places browse dialog ("Anytime — food &
 * places") were saved with flat `details.lat`/`details.lng` instead, because
 * `mapPlace()` in google-places.server.ts returns them that way and the Add
 * handler in activities-panel.tsx spread that object straight into `details`.
 * That's fixed at the write path too, but rows already saved under the flat
 * shape still need to plot, hence the fallback below. `details` is unvalidated
 * JSON, so nothing catches this class of mismatch at write time.
 */
export function coordsOf(details: unknown): LatLng | null {
  const d = (details ?? {}) as Record<string, unknown>;
  const c = d.coords as { lat?: number; lng?: number } | undefined;
  if (c && typeof c.lat === "number" && typeof c.lng === "number") {
    return { lat: c.lat, lng: c.lng };
  }
  if (typeof d.lat === "number" && typeof d.lng === "number") {
    return { lat: d.lat, lng: d.lng };
  }
  return null;
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

/** Local-safe: same day arithmetic `daysUntil` uses, but returns a Date for
 *  day `dayIndex` of a trip starting on `startDate` (0 = start day). */
export function dateForDayIndex(startDate: string, dayIndex: number): Date {
  const d = new Date(`${startDate}T00:00:00`);
  d.setDate(d.getDate() + dayIndex);
  return d;
}

export function formatHours(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return "—";
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
