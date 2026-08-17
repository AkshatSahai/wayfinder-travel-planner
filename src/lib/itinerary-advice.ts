// Local heuristics that decide whether a manual drag is worth an AI second
// opinion. Pure and side-effect free — no I/O, no React — so the expensive part
// (a Gemini call) only happens when something here actually fires.
//
// This gating is deliberate. context.md's v0.2.1 entry records cascading retries
// exhausting the AI provider's quota; an advisor that called the model on every
// drag would be the same mistake with a nicer name. The common case is a drag
// that trips nothing and costs nothing.

import { haversineMiles, type LatLng } from "./workspace-store";

/** How long a day can get before it stops being a holiday. */
const LONG_DAY_HOURS = 10;
/** A hop worth mentioning between two stops on the same day. */
const LONG_HOP_MILES = 30;
/** A day costs this much more than the trip's daily average before we flag it. */
const COST_SPIKE_RATIO = 2.5;
/** Below this, a "spike" is just noise on a cheap trip. */
const COST_SPIKE_FLOOR_CENTS = 15000;

export type AdviceCode = "long_day" | "long_hop" | "out_of_order" | "cost_spike";

export interface AdviceSignal {
  code: AdviceCode;
  /** Short factual statement — the model turns this into traveler-facing prose. */
  detail: string;
}

export interface AdviceItem {
  id: string;
  title: string;
  category: string | null;
  cost_cents: number;
  /** Minutes since midnight when the item has a time, else null. */
  minutes: number | null;
  duration_hours: number | null;
  coords: LatLng | null;
}

function hoursOn(items: AdviceItem[]): number {
  // An activity with no stated duration still occupies the day; assume a modest
  // block rather than zero, or a packed day of unmeasured items reads as empty.
  return items.reduce((sum, i) => sum + (i.duration_hours ?? 1.5), 0);
}

function longestHopMiles(items: AdviceItem[]): { miles: number; from: string; to: string } | null {
  const located = items.filter((i) => i.coords);
  if (located.length < 2) return null;
  let worst: { miles: number; from: string; to: string } | null = null;
  for (let i = 1; i < located.length; i++) {
    const miles = haversineMiles(located[i - 1].coords!, located[i].coords!);
    if (!worst || miles > worst.miles) {
      worst = { miles, from: located[i - 1].title, to: located[i].title };
    }
  }
  return worst;
}

function outOfOrder(items: AdviceItem[]): { earlier: string; later: string } | null {
  // Items are already in their displayed order; a timed item appearing before an
  // earlier-timed one means the day reads backwards.
  const timed = items.filter((i) => i.minutes != null);
  for (let i = 1; i < timed.length; i++) {
    if (timed[i].minutes! < timed[i - 1].minutes!) {
      return { earlier: timed[i].title, later: timed[i - 1].title };
    }
  }
  return null;
}

const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/**
 * Evaluate the day an item was just dropped onto. Returns the signals worth
 * escalating; an empty array means do nothing at all — no note, no network call.
 *
 * `dayItems` must be in final display order, and must already include the moved
 * item at its new position.
 */
export function assessDay(
  dayItems: AdviceItem[],
  movedId: string,
  averageDayCostCents: number,
): AdviceSignal[] {
  const signals: AdviceSignal[] = [];
  const moved = dayItems.find((i) => i.id === movedId);
  if (!moved) return signals;

  const hours = hoursOn(dayItems);
  if (hours > LONG_DAY_HOURS) {
    signals.push({
      code: "long_day",
      detail: `This day now holds ${dayItems.length} items totalling roughly ${hours.toFixed(1)} hours of activity.`,
    });
  }

  const hop = longestHopMiles(dayItems);
  if (hop && hop.miles > LONG_HOP_MILES) {
    signals.push({
      code: "long_hop",
      detail: `The day includes a ${Math.round(hop.miles)} mile straight-line hop between "${hop.from}" and "${hop.to}".`,
    });
  }

  const disorder = outOfOrder(dayItems);
  if (disorder) {
    signals.push({
      code: "out_of_order",
      detail: `"${disorder.later}" is scheduled before "${disorder.earlier}" but starts later in the day.`,
    });
  }

  const dayCost = dayItems.reduce((sum, i) => sum + (i.cost_cents ?? 0), 0);
  if (
    averageDayCostCents > 0 &&
    dayCost > COST_SPIKE_FLOOR_CENTS &&
    dayCost > averageDayCostCents * COST_SPIKE_RATIO
  ) {
    signals.push({
      code: "cost_spike",
      detail: `This day now costs $${Math.round(dayCost / 100)}, against a trip average of about $${Math.round(averageDayCostCents / 100)} per day.`,
    });
  }

  // A timed item that landed somewhere its category rarely belongs.
  if (moved.minutes != null) {
    const cat = (moved.category ?? "").toLowerCase();
    const hour = Math.floor(moved.minutes / 60);
    if (cat === "nightlife" && hour < 16) {
      signals.push({
        code: "out_of_order",
        detail: `"${moved.title}" is a nightlife item now scheduled at ${clock(moved.minutes)}.`,
      });
    }
  }

  return signals;
}

/** Assumed local driving speed for the arrival-time check — same order of
 * magnitude as the "long hop" heuristic above; there's no live route available
 * at the point a time is pinned, only straight-line distance. */
const ASSUMED_MPH = 30;

export interface ArrivalCheckItem {
  id: string;
  title: string;
  /** Minutes since midnight if this item already has a time, else null. */
  minutes: number | null;
  duration_hours: number | null;
  coords: LatLng | null;
}

/**
 * Pure, local check for whether a just-pinned arrival time is realistic given
 * the day's travel time and duration up to that point — the same lightweight,
 * no-network pattern as `assessDay`, reused for the per-item "pin a time"
 * feature rather than inventing a second advisor mechanism.
 *
 * `dayItems` must be in the day's current display (drag) order, and must
 * include the pinned item at its current position. `dayStartMinutes` is the
 * day's configured start time (day_start_times), or null if unset.
 */
export function checkArrivalConflict(
  dayItems: ArrivalCheckItem[],
  pinnedId: string,
  pinnedMinutes: number,
  dayStartMinutes: number | null,
): { conflict: boolean; detail: string | null } {
  const idx = dayItems.findIndex((i) => i.id === pinnedId);
  if (idx <= 0) return { conflict: false, detail: null };

  let minutesNeeded = 0;
  for (let i = 0; i < idx; i++) {
    minutesNeeded += (dayItems[i].duration_hours ?? 1.5) * 60;
    const next = dayItems[i + 1];
    if (dayItems[i].coords && next?.coords) {
      minutesNeeded += (haversineMiles(dayItems[i].coords!, next.coords!) / ASSUMED_MPH) * 60;
    }
  }

  const earliestStart = dayItems[0].minutes ?? dayStartMinutes ?? 0;
  const earliestArrival = earliestStart + minutesNeeded;
  if (pinnedMinutes < earliestArrival) {
    return {
      conflict: true,
      detail: `"${dayItems[idx].title}" is pinned for ${clock(pinnedMinutes)}, but the stops before it need until roughly ${clock(Math.round(earliestArrival))}.`,
    };
  }
  return { conflict: false, detail: null };
}

/** Mean per-day spend across the trip, used as the cost-spike baseline. */
export function averageDayCost(
  items: { day_index: number | null; cost_cents: number | null }[],
): number {
  const perDay = new Map<number, number>();
  for (const i of items) {
    if (i.day_index == null) continue;
    perDay.set(i.day_index, (perDay.get(i.day_index) ?? 0) + (i.cost_cents ?? 0));
  }
  if (perDay.size === 0) return 0;
  let total = 0;
  for (const [, v] of perDay) total += v;
  return total / perDay.size;
}
