import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  dayDistanceMatrix,
  distancesFromLodging,
  type ActivityDistance,
  type DayLeg,
} from "@/lib/travel.functions";
import { coordsOf, type LatLng } from "@/lib/workspace-store";
import type { Tables } from "@/integrations/supabase/types";

type Item = Tables<"trip_items">;

/**
 * The Itinerary tab shows two different driving numbers and they must not be
 * confused with each other:
 *
 * - `useActivityDistances` — booked stay → each activity. Order-independent;
 *   the same number wherever that activity appears.
 * - `useDayLegs` — each stop → the next stop in the day's current order.
 *   Entirely about order, and changes on every drag.
 *
 * They agree only for the first stop after the lodging on its day. Anywhere
 * else, a matching pair means one of them is reading the wrong source.
 */

function located(items: Item[]): { id: string; coords: LatLng }[] {
  return items
    .map((i) => ({ id: i.id, coords: coordsOf(i.details) }))
    .filter((x): x is { id: string; coords: LatLng } => x.coords != null);
}

/**
 * Sort by id before building a query key.
 *
 * Both callers pass the same activity set in different orders — the route hands
 * ActivityMapPanel an unsorted list while ItineraryPanel sorts its copy by
 * day_index. Keying off array order would produce two different keys for
 * identical data and fire the same request twice.
 */
function signatureOf(rows: { id: string; coords: LatLng }[]): string {
  return rows
    .map((r) => `${r.id}:${r.coords.lat},${r.coords.lng}`)
    .sort()
    .join("|");
}

export interface ActivityDistanceResult {
  /** activity id → distance from the booked stay. Empty until resolved. */
  byId: Map<string, ActivityDistance>;
  isLoading: boolean;
  error: string | null;
  /** False when there's no booked stay (or it has no coordinates) to measure from. */
  hasOrigin: boolean;
}

/** Driving distance and time from the booked stay to each located activity. */
export function useActivityDistances(
  tripId: string,
  activities: Item[],
  lodging: Item | null,
): ActivityDistanceResult {
  const fn = useServerFn(distancesFromLodging);
  const rows = located(activities);
  const origin = lodging ? coordsOf(lodging.details) : null;
  const originKey = origin ? `${origin.lat},${origin.lng}` : "none";

  const q = useQuery({
    queryKey: ["activity-distances", tripId, originKey, signatureOf(rows)],
    queryFn: () =>
      fn({
        data: {
          origin: origin!,
          targets: rows.map((r) => ({ id: r.id, lat: r.coords.lat, lng: r.coords.lng })),
        },
      }),
    enabled: origin != null && rows.length > 0,
    staleTime: Infinity,
    retry: false,
  });

  return {
    byId: new Map((q.data?.distances ?? []).map((d) => [d.id, d])),
    isLoading: q.isLoading,
    error: q.data?.error ?? null,
    hasOrigin: origin != null,
  };
}

export interface DayLegsResult {
  /**
   * The leg from one stop to another, or null when either end has no
   * coordinates or that pair couldn't be routed.
   */
  legBetween: (fromId: string, toId: string) => DayLeg | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Pairwise driving legs among a day's stops.
 *
 * Keyed on the *set* of located stops, never their order — that is what makes a
 * drag-reorder free. Rearranging the same stops reuses the cached matrix and
 * fires no request; only adding or removing one changes the key.
 */
export function useDayLegs(tripId: string, dayItems: Item[]): DayLegsResult {
  const fn = useServerFn(dayDistanceMatrix);
  const rows = located(dayItems);

  const q = useQuery({
    queryKey: ["day-legs", tripId, signatureOf(rows)],
    queryFn: () =>
      fn({
        data: { stops: rows.map((r) => ({ id: r.id, lat: r.coords.lat, lng: r.coords.lng })) },
      }),
    enabled: rows.length >= 2,
    staleTime: Infinity,
    retry: false,
  });

  const byPair = new Map((q.data?.legs ?? []).map((l) => [`${l.from_id}>${l.to_id}`, l]));
  return {
    legBetween: (fromId, toId) => byPair.get(`${fromId}>${toId}`) ?? null,
    isLoading: q.isLoading,
    error: q.data?.error ?? null,
  };
}

/**
 * "18 mi · 24 min" — the compact form both surfaces use.
 *
 * One decimal under 10 miles, whole miles above. Rounding everything to whole
 * miles turned a real 0.3 mi hop into "0 mi", which reads as a failure rather
 * than a short walk, and flattened 1.7 vs 1.9 into the same "2 mi". Long
 * distances gain nothing from the decimal and the panel is narrow, so it's
 * dropped once the number is big enough to not need it.
 */
export function formatLeg(miles: number | null, hours: number | null): string | null {
  if (miles == null || hours == null) return null;
  const mins = Math.round(hours * 60);
  const time = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`;
  const dist = miles < 10 ? miles.toFixed(1) : String(Math.round(miles));
  return `${dist} mi · ${time}`;
}
