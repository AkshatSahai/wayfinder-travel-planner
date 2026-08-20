import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { haversineMiles } from "./workspace-store";

export interface ActivityDistance {
  id: string;
  /** Driving miles from the booked stay, or straight-line if OSRM didn't
   * return road distance. Null when this leg couldn't be routed at all. */
  miles: number | null;
  /** Driving hours from the booked stay, or null if unroutable. */
  hours: number | null;
  /** True when `miles` is straight-line rather than road distance. */
  straight_line: boolean;
}

/**
 * Driving distance and time from the trip's booked stay to each located
 * activity — what the Itinerary tab's list column shows.
 *
 * Car only. It's the mode that makes sense for "is this worth the trip from my
 * hotel", and it's the one the free OSRM profile actually routes.
 *
 * Never throws: a routing outage returns every leg as unrouted plus an `error`
 * string, so the map and the activity list still render. Distances are a
 * convenience on this screen, not something worth failing the tab over.
 */
export const distancesFromLodging = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        origin: z.object({ lat: z.number(), lng: z.number() }),
        targets: z.array(z.object({ id: z.string(), lat: z.number(), lng: z.number() })).max(200),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<{ distances: ActivityDistance[]; error: string | null }> => {
    if (data.targets.length === 0) return { distances: [], error: null };
    try {
      const { getDistancesFrom } = await import("./providers/osrm.server");
      const legs = await getDistancesFrom(data.origin, data.targets);
      return {
        distances: data.targets.map((t, i) => {
          const leg = legs[i];
          if (!leg) return { id: t.id, miles: null, hours: null, straight_line: false };
          // OSRM gave us a real drive time but no road distance; we still
          // hold both coordinates, so fall back to straight-line mileage
          // rather than leaving the column blank.
          const straightLine = leg.miles == null;
          return {
            id: t.id,
            miles: leg.miles ?? haversineMiles(data.origin, t),
            hours: leg.hours,
            straight_line: straightLine,
          };
        }),
        error: null,
      };
    } catch (err) {
      console.error("[distances-from-lodging] osrm error:", err);
      return {
        distances: data.targets.map((t) => ({
          id: t.id,
          miles: null,
          hours: null,
          straight_line: false,
        })),
        error: "Couldn't work out driving distances just now.",
      };
    }
  });

/** One leg of a day's chain: `from_id` → `to_id`. */
export interface DayLeg {
  from_id: string;
  to_id: string;
  miles: number | null;
  hours: number | null;
  straight_line: boolean;
}

/**
 * Every pairwise driving leg between a day's located stops.
 *
 * Returns the whole matrix as a flat list, NOT just the legs of the order the
 * caller happens to be showing. That's deliberate: the day's order changes on
 * every drag, and legs are sequence-dependent, so returning only the current
 * sequence would mean a round trip per drop. With every pair in hand the client
 * looks up the legs it needs and a reorder costs nothing.
 *
 * This is a different measurement from `distancesFromLodging` above and the two
 * must not be conflated — that one is stay → activity and is order-independent;
 * this one is stop → next stop and is entirely about order.
 *
 * Never throws: an outage returns an empty list plus an `error` string, and the
 * day schedule renders without leg labels rather than failing.
 */
export const dayDistanceMatrix = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        stops: z.array(z.object({ id: z.string(), lat: z.number(), lng: z.number() })).max(40),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<{ legs: DayLeg[]; error: string | null }> => {
    if (data.stops.length < 2) return { legs: [], error: null };
    try {
      const { getDistanceMatrix } = await import("./providers/osrm.server");
      const matrix = await getDistanceMatrix(data.stops);
      const legs: DayLeg[] = [];
      data.stops.forEach((from, i) => {
        data.stops.forEach((to, j) => {
          if (i === j) return;
          const leg = matrix[i]?.[j];
          if (!leg) return;
          // Same straight-line fallback as distancesFromLodging: a real drive
          // time with no road distance still beats a blank label.
          const straightLine = leg.miles == null;
          legs.push({
            from_id: from.id,
            to_id: to.id,
            miles: leg.miles ?? haversineMiles(from, to),
            hours: leg.hours,
            straight_line: straightLine,
          });
        });
      });
      return { legs, error: null };
    } catch (err) {
      console.error("[day-distance-matrix] osrm error:", err);
      return { legs: [], error: "Couldn't work out driving times for this day just now." };
    }
  });
