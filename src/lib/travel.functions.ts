import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { haversineMiles } from "./workspace-store";

export type TravelMode = "car" | "flight" | "train";

export interface TravelEstimate {
  mode: TravelMode;
  hours: number | null;
  detail: string;
  /** True when the number is a heuristic rather than a provider response. */
  estimated: boolean;
}

// Trains have no live API wired up, so the estimate is derived from the road
// route: rail rarely beats driving on these corridors, plus station overhead.
const TRAIN_AVG_MPH = 50;
const TRAIN_OVERHEAD_HOURS = 1;

// Estimated door-to-door travel time per mode for the Trip Details dashboard.
// Estimate only — nothing here books anything.
export const estimateTravelTime = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        origin: z.string().max(200),
        destination: z.string().max(200),
        mode: z.enum(["car", "flight", "train"]),
        party_size: z.number().int().nullable().optional(),
        start_date: z.string().nullable().optional(),
        end_date: z.string().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<TravelEstimate> => {
    const { origin, destination, mode } = data;
    if (!origin.trim() || !destination.trim()) {
      return {
        mode,
        hours: null,
        detail: "Add a starting location and destination.",
        estimated: true,
      };
    }

    if (mode === "flight") {
      if (!data.start_date) {
        return {
          mode,
          hours: null,
          detail: "Add a start date to price live flights.",
          estimated: true,
        };
      }
      try {
        const { searchFlights } = await import("./providers/duffel.server");
        const flights = await searchFlights({
          origin,
          destination,
          party_size: Math.max(1, data.party_size ?? 2),
          start_date: data.start_date,
          end_date: data.end_date ?? null,
        });
        const best = flights
          .filter((f) => f.est_duration_hours > 0)
          .sort((a, b) => a.est_duration_hours - b.est_duration_hours)[0];
        if (!best) {
          return {
            mode,
            hours: null,
            detail: "No live flight offers for this route.",
            estimated: true,
          };
        }
        return {
          mode,
          hours: best.est_duration_hours,
          detail: `Fastest of ${flights.length} live offer${flights.length === 1 ? "" : "s"} (Duffel)`,
          estimated: false,
        };
      } catch (err) {
        console.error("[travel-estimate] duffel error:", err);
        return { mode, hours: null, detail: "Live flight data unavailable.", estimated: true };
      }
    }

    // Car and train both hang off the same OSRM road route.
    try {
      const { getDrivingRoute } = await import("./providers/osrm.server");
      const route = await getDrivingRoute(origin, destination, []);
      if (!route) {
        return {
          mode,
          hours: null,
          detail: "Couldn't route between these places.",
          estimated: true,
        };
      }
      if (mode === "car") {
        return {
          mode,
          hours: route.drive_hours_one_way,
          detail: `${Math.round(route.miles_one_way)} mi each way (OSRM route)`,
          estimated: false,
        };
      }
      return {
        mode,
        hours: route.miles_one_way / TRAIN_AVG_MPH + TRAIN_OVERHEAD_HOURS,
        detail: `Rough estimate — ~${Math.round(route.miles_one_way)} mi at ${TRAIN_AVG_MPH} mph plus station time. No live rail API.`,
        estimated: true,
      };
    } catch (err) {
      console.error("[travel-estimate] osrm error:", err);
      return { mode, hours: null, detail: "Routing service unavailable.", estimated: true };
    }
  });

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
