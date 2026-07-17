import { createServerFn } from "@tanstack/react-start";
import { APICallError, generateText, NoObjectGeneratedError, Output } from "ai";
import { z } from "zod";
import { createGateway, CHAT_MODEL } from "./ai-gateway.server";

// -------- Schemas --------
const parsedTripSchema = z.object({
  destination: z.string().nullable(),
  region_hint: z.string().nullable(),
  origin: z.string().nullable(),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  party_size: z.number().int().nullable(),
  travel_mode: z.enum(["car", "flight", "train", "unknown"]).nullable(),
  interests: z.array(z.string()),
  budget_cents: z.number().int().nullable(),
  currency: z.string().nullable(),
  notes: z.string().nullable(),
  missing_fields: z.array(z.string()),
});

const destinationsSchema = z.object({
  destinations: z.array(
    z.object({
      name: z.string(),
      region: z.string(),
      match_score: z.number(),
      rationale: z.string(),
      best_for: z.array(z.string()),
      hero_tagline: z.string(),
      lat: z.number(),
      lng: z.number(),
    }),
  ),
});

const chatDestinationsSchema = z.object({
  reply: z.string(),
  destinations: destinationsSchema.shape.destinations,
});

const recommendationsSchema = z.object({
  tips: z.array(
    z.object({
      kind: z.enum(["pacing", "weather", "transport", "budget", "logistics"]),
      message: z.string(),
      severity: z.enum(["info", "warn"]),
    }),
  ),
});

// -------- Helpers --------
async function generateStructured<T>(
  prompt: string,
  schema: z.ZodSchema<T>,
  system?: string,
): Promise<T | null> {
  const gateway = createGateway();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { output } = await generateText({
        model: gateway(CHAT_MODEL),
        output: Output.object({ schema: schema as never }),
        // Quota errors would be retried too; keep the SDK's own retry burn low.
        maxRetries: 1,
        system:
          system ??
          "You are an expert travel concierge. Return realistic, specific, well-researched results. Costs in USD cents. Always return JSON.",
        prompt,
      });
      return output as T;
    } catch (err) {
      if (isQuotaError(err)) {
        console.error("[travel-ai] provider rate limit hit:", errMsg(err).slice(0, 200));
        throw new Error("The AI service hit its rate limit — wait a minute and try again.");
      }
      if (NoObjectGeneratedError.isInstance(err)) {
        console.error(
          `[travel-ai] no object generated (attempt ${attempt + 1}/2). Raw text:`,
          err.text?.slice(0, 500),
        );
        continue;
      }
      throw err;
    }
  }
  return null;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isQuotaError(err: unknown): boolean {
  // NoObjectGeneratedError wraps the underlying call error in `cause`.
  const cause = NoObjectGeneratedError.isInstance(err) ? err.cause : err;
  if (APICallError.isInstance(cause)) {
    return cause.statusCode === 429 || /quota|rate.?limit/i.test(cause.message);
  }
  return /quota|rate.?limit|429/i.test(errMsg(cause ?? err));
}

// Detects our providers' "<ENV_VAR> missing" errors so panels can render setup instructions.
function missingKeyFrom(err: unknown): string | null {
  const m = /^([A-Z0-9_]+) missing$/.exec(errMsg(err));
  return m ? m[1] : null;
}

// -------- Trip parsing (AI) --------
export const parseTripPrompt = createServerFn({ method: "POST" })
  .inputValidator((d: { prompt: string }) =>
    z.object({ prompt: z.string().min(3).max(4000) }).parse(d),
  )
  .handler(async ({ data }) => {
    const today = new Date().toISOString().slice(0, 10);
    const result = await generateStructured(
      `Today is ${today}. Extract structured trip parameters from this request. If the user gives relative dates ("next weekend", "in June"), resolve to concrete YYYY-MM-DD. "origin" is where the traveler is leaving FROM (home city), if stated. "destination" is where they want to go — if they name a broad region (e.g. "Michigan beaches"), put it in destination and also set region_hint. Budget like "$3500" means budget_cents 350000. If a field is not stated, set it to null and add its name to missing_fields. Required for planning: destination, origin, start_date, end_date, budget_cents. Interests should be short tags (e.g. "hiking", "spa", "food", "beach").\n\nRequest:\n"""${data.prompt}"""`,
      parsedTripSchema,
    );
    if (!result) {
      console.error(
        "[travel-ai] parseTripPrompt failed after retries; returning parse_failed fallback",
      );
      return {
        destination: null,
        region_hint: null,
        origin: null,
        start_date: null,
        end_date: null,
        party_size: null,
        travel_mode: null,
        interests: [],
        budget_cents: null,
        currency: null,
        notes: null,
        missing_fields: ["destination", "origin", "start_date", "end_date", "budget_cents"],
        parse_failed: true,
      };
    }
    return { ...result, parse_failed: false };
  });

// -------- Destinations (AI) --------
export const suggestDestinations = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ parsed: parsedTripSchema }).parse(d))
  .handler(async ({ data }) => {
    const p = data.parsed;
    const result = await generateStructured(
      `Suggest 5 specific destinations for this trip. Prefer real towns, resorts, or specific areas (not whole states). Rank by fit; match_score is 0-100. lat/lng are the destination's approximate coordinates.\n\nContext:\n- Region/hint: ${p.destination ?? p.region_hint ?? "flexible"}\n- Party size: ${p.party_size ?? "unspecified"}\n- Travel mode: ${p.travel_mode ?? "unspecified"}\n- Dates: ${p.start_date ?? "?"} to ${p.end_date ?? "?"}\n- Interests: ${p.interests.join(", ") || "none stated"}\n- Notes: ${p.notes ?? ""}\n\nEach hero_tagline is one short evocative line.`,
      destinationsSchema,
    );
    return result ?? { destinations: [] };
  });

// -------- Destination refinement chat (AI) --------
export const chatDestinations = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        messages: z
          .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000) }))
          .max(20),
        parsed: parsedTripSchema,
        current_destinations: z.array(z.string()).max(10),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const p = data.parsed;
    const transcript = data.messages
      .map((m) => `${m.role === "user" ? "Traveler" : "You"}: ${m.content}`)
      .join("\n");
    const result = await generateStructured(
      `You are refining destination suggestions through conversation. Respond to the traveler's latest message with a short conversational "reply" (2-3 sentences max), and update "destinations" (always exactly 5, ranked, real specific places with approximate lat/lng) to reflect ALL their preferences so far.\n\nTrip context:\n- Region/hint: ${p.destination ?? p.region_hint ?? "flexible"}\n- Leaving from: ${p.origin ?? "unspecified"}\n- Dates: ${p.start_date ?? "?"} to ${p.end_date ?? "?"}\n- Party: ${p.party_size ?? "?"}\n- Interests: ${p.interests.join(", ") || "none stated"}\n\nCurrently suggested: ${data.current_destinations.join(", ") || "(none yet)"}\n\nConversation so far:\n${transcript}`,
      chatDestinationsSchema,
    );
    return (
      result ?? { reply: "Sorry — I couldn't process that. Try rephrasing?", destinations: [] }
    );
  });

// -------- Top places for the Destination map (Google Places) --------
export const topPlaces = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ destination: z.string().min(2) }).parse(d))
  .handler(async ({ data }) => {
    try {
      const { searchTopSights } = await import("./providers/google-places.server");
      const sights = await searchTopSights(data.destination);
      return { sights, error: null as string | null, missing_key: null as string | null };
    } catch (err) {
      console.error("[top-places] error:", err);
      return { sights: [], error: errMsg(err), missing_key: missingKeyFrom(err) };
    }
  });

// -------- Lodging (TravelPayouts) --------
export const searchLodging = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        destination: z.string(),
        start_date: z.string().nullable(),
        end_date: z.string().nullable(),
        party_size: z.number().int().nullable(),
        interests: z.array(z.string()),
        budget_cents: z.number().int().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    if (!data.start_date || !data.end_date) {
      return {
        source: "travelpayouts" as const,
        listings: [],
        error: "Add trip dates to search live hotels.",
      };
    }
    try {
      const { searchHotels } = await import("./providers/travelpayouts.server");
      const listings = await searchHotels({
        destination: data.destination,
        checkIn: data.start_date,
        checkOut: data.end_date,
        adults: Math.max(1, data.party_size ?? 2),
      });
      return {
        source: "travelpayouts" as const,
        listings,
        error:
          listings.length === 0
            ? "No live hotel results for these dates. Try adjusting dates or destination."
            : null,
      };
    } catch (err) {
      console.error("[lodging] travelpayouts error:", err);
      return {
        source: "travelpayouts" as const,
        listings: [],
        error: `Live hotel search unavailable: ${errMsg(err)}`,
      };
    }
  });

// -------- Transport (Duffel flights + custom car math + AI advice) --------
export const searchTransport = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        origin: z.string(),
        destination: z.string(),
        mode: z.enum(["car", "flight", "train", "unknown"]).nullable(),
        party_size: z.number().int().nullable(),
        start_date: z.string().nullable(),
        end_date: z.string().nullable(),
        mpg: z.number().nullable().optional(),
        fuel_price_per_gallon: z.number().nullable().optional(),
        waypoints: z.array(z.string().max(200)).max(10).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const partySize = Math.max(1, data.party_size ?? 2);
    type Option = {
      mode: "flight" | "car" | "train" | "bus";
      label: string;
      est_duration_hours: number;
      est_cost_cents: number;
      details: string;
      notes: string;
      source: "duffel" | "osrm";
      source_url: string | null;
      offer_id?: string;
      fare_brand?: string | null;
      cabin?: string;
      stops?: number;
    };
    const options: Option[] = [];
    const errors: string[] = [];
    let missing_key: string | null = null;

    // Flights via Duffel
    if (data.start_date) {
      try {
        const { searchFlights } = await import("./providers/duffel.server");
        const flights = await searchFlights({
          origin: data.origin,
          destination: data.destination,
          party_size: partySize,
          start_date: data.start_date,
          end_date: data.end_date,
        });
        for (const f of flights) {
          options.push({ ...f, source: "duffel" });
        }
        if (flights.length === 0) errors.push("No live flight offers from Duffel for this route.");
      } catch (err) {
        console.error("[transport] duffel error:", err);
        const key = missingKeyFrom(err);
        if (key) missing_key = key;
        else errors.push(`Live flight search unavailable: ${errMsg(err)}`);
      }
    } else {
      errors.push("Add a start date to search live flights.");
    }

    // Car: real route via OSRM (chaining any waypoints), gas via live EIA
    // regional price when available; the manual $/gal input overrides both.
    let gas_source: string | null = null;
    try {
      const { getDrivingRoute } = await import("./providers/osrm.server");
      const route = await getDrivingRoute(data.origin, data.destination, data.waypoints ?? []);
      if (route) {
        const mpg = data.mpg ?? 28;
        let gas = data.fuel_price_per_gallon ?? null;
        if (gas == null) {
          try {
            const { getGasPrice } = await import("./providers/eia.server");
            const live = await getGasPrice(data.origin);
            gas = live.price_per_gallon;
            gas_source = `EIA weekly · ${live.region}`;
          } catch (err) {
            console.error("[transport] eia error:", err);
            gas = 3.5;
            gas_source = null;
          }
        }
        const roundTripMiles = route.miles_one_way * 2;
        const gallons = roundTripMiles / mpg;
        const gasCost = gallons * gas;
        const stopsNote =
          route.stop_count > 0
            ? ` · ${route.stop_count} stop${route.stop_count === 1 ? "" : "s"}`
            : "";
        options.push({
          mode: "car",
          label: `Drive round-trip (${Math.round(roundTripMiles)} mi)`,
          est_duration_hours: Math.round(route.drive_hours_one_way * 2 * 10) / 10,
          est_cost_cents: Math.round(gasCost * 100),
          details: `${Math.round(route.miles_one_way)} mi each way · ~${route.drive_hours_one_way.toFixed(1)}h drive (OSRM route)${stopsNote}`,
          notes: `Gas only. ${mpg} mpg at $${gas.toFixed(2)}/gal${gas_source ? ` (${gas_source})` : ""}. ${gallons.toFixed(1)} gal round-trip.`,
          source: "osrm",
          source_url: null,
        });
      } else {
        errors.push("Couldn't find a driving route between these places.");
      }
    } catch (err) {
      console.error("[transport] osrm error:", err);
      errors.push(`Live driving route unavailable: ${errMsg(err)}`);
    }

    // AI advice paragraph, given the real offers as context.
    const summary = options
      .map(
        (o) =>
          `- ${o.mode.toUpperCase()}: ${o.label} ($${(o.est_cost_cents / 100).toFixed(0)}, ${o.est_duration_hours}h)`,
      )
      .join("\n");
    const advice = await generateStructured(
      `Given these transport options from ${data.origin} to ${data.destination}, write one short paragraph advising the traveler. Cover whether a car is worth having at ${data.destination} (parking, walkability, transit alternatives), and any obvious tradeoff between the flight and car options.\n\nOptions:\n${summary || "(none)"}`,
      z.object({ ai_advice: z.string() }),
    );

    return {
      options,
      ai_advice: advice?.ai_advice ?? "",
      errors,
      missing_key,
      gas_source,
    };
  });

// -------- Activities (Google Places) --------
export const searchActivities = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        destination: z.string(),
        interests: z.array(z.string()),
        start_date: z.string().nullable(),
        end_date: z.string().nullable(),
        party_size: z.number().int().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const [placesResult, eventsResult] = await Promise.allSettled([
      (async () => {
        const { searchActivitiesReal } = await import("./providers/google-places.server");
        return await searchActivitiesReal(data.destination);
      })(),
      (async () => {
        if (!data.start_date || !data.end_date)
          throw new Error("Add trip dates to search live events.");
        const { searchEvents } = await import("./providers/ticketmaster.server");
        return await searchEvents({
          destination: data.destination,
          startDate: data.start_date,
          endDate: data.end_date,
        });
      })(),
    ]);

    const places = placesResult.status === "fulfilled" ? placesResult.value : [];
    let places_error: string | null = null;
    let places_missing_key: string | null = null;
    if (placesResult.status === "rejected") {
      console.error("[activities] google places error:", placesResult.reason);
      places_missing_key = missingKeyFrom(placesResult.reason);
      if (!places_missing_key)
        places_error = `Live venue search unavailable: ${errMsg(placesResult.reason)}`;
    } else if (places.length === 0) {
      places_error = "No live results from Google Places for this destination.";
    }

    const events = eventsResult.status === "fulfilled" ? eventsResult.value : [];
    let events_error: string | null = null;
    let events_missing_key: string | null = null;
    if (eventsResult.status === "rejected") {
      console.error("[activities] ticketmaster error:", eventsResult.reason);
      events_missing_key = missingKeyFrom(eventsResult.reason);
      if (!events_missing_key) events_error = errMsg(eventsResult.reason);
    } else if (events.length === 0) {
      events_error = "No ticketed events found near this destination during your dates.";
    }

    return { places, places_error, places_missing_key, events, events_error, events_missing_key };
  });

// -------- Recommendations sidebar (AI) --------
export const getRecommendations = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        destination: z.string(),
        start_date: z.string().nullable(),
        end_date: z.string().nullable(),
        itemsSummary: z.string(),
        budget_cents: z.number().int().nullable(),
        total_cents: z.number().int(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const result = await generateStructured(
      `Review this trip plan and give 3-5 actionable tips. Cover pacing (too packed/empty days), weather warnings for the dates, transport advice, and budget flags.\n\nDestination: ${data.destination}\nDates: ${data.start_date} to ${data.end_date}\nBudget: ${data.budget_cents ? "$" + data.budget_cents / 100 : "none"}\nRunning total: $${(data.total_cents / 100).toFixed(0)}\n\nCurrent plan:\n${data.itemsSummary}`,
      recommendationsSchema,
    );
    return result ?? { tips: [] };
  });
