// Local heuristics for the itinerary. Pure and side-effect free — no I/O, no
// React, no model.
//
// This file used to also host `assessDay`, the gate in front of an AI "second
// opinion" on every manual drag. That advisor is gone (v0.9.0): the itinerary
// no longer has any AI in it. What remains is the arrival-time check, which
// runs when the traveler pins a specific time to a stop and answers a question
// they just asked rather than volunteering an opinion.

import { haversineMiles, type LatLng } from "./workspace-store";

/** Assumed local driving speed for the arrival-time check. There's no live
 * route available at the point a time is pinned, only straight-line distance,
 * so this is deliberately conservative rather than precise. */
const ASSUMED_MPH = 30;

const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export interface ArrivalCheckItem {
  id: string;
  title: string;
  /** Minutes since midnight if this item already has a time, else null. */
  minutes: number | null;
  duration_hours: number | null;
  coords: LatLng | null;
}

/**
 * Whether a just-pinned arrival time is realistic given the day's travel time
 * and activity duration up to that point.
 *
 * `dayItems` must be in the day's current display (drag) order, and must
 * include the pinned item at its current position.
 */
export function checkArrivalConflict(
  dayItems: ArrivalCheckItem[],
  pinnedId: string,
  pinnedMinutes: number,
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

  const earliestStart = dayItems[0].minutes ?? 0;
  const earliestArrival = earliestStart + minutesNeeded;
  if (pinnedMinutes < earliestArrival) {
    return {
      conflict: true,
      detail: `"${dayItems[idx].title}" is pinned for ${clock(pinnedMinutes)}, but the stops before it need until roughly ${clock(Math.round(earliestArrival))}.`,
    };
  }
  return { conflict: false, detail: null };
}
