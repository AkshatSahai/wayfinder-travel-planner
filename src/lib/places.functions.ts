import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type Coords = { lat: number; lng: number } | null;

// Resolve free-text place names to coordinates for manually-entered trips.
// Never throws: a missing GOOGLE_API_KEY, a timeout, or an unrecognized address
// all resolve to null, and the trip is created without coordinates — the same
// degraded state AI-created trips already live in.
export const resolvePlaces = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        origin: z.string().max(200),
        destination: z.string().max(200),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) return { origin: null as Coords, destination: null as Coords };

    const { geocode } = await import("./providers/google-places.server");
    const lookup = async (address: string): Promise<Coords> => {
      if (!address.trim()) return null;
      try {
        return await geocode(address, apiKey);
      } catch (err) {
        console.error("[places] geocode failed:", err);
        return null;
      }
    };

    const [origin, destination] = await Promise.all([
      lookup(data.origin),
      lookup(data.destination),
    ]);
    return { origin, destination };
  });
