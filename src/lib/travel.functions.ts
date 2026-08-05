import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

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
