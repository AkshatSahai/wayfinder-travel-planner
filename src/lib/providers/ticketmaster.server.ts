// Ticketmaster Discovery API adapter. Server-only.
// Requires TICKETMASTER_API_KEY (free tier at developer.ticketmaster.com).

import { geocodePlace } from "./osrm.server";

const EVENTS_URL = "https://app.ticketmaster.com/discovery/v2/events.json";
const TIMEOUT_MS = 8000;

async function withTimeout<T>(p: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("provider timeout")), ms)),
  ]);
}

interface TMImage {
  url: string;
  width: number;
  height: number;
}

interface TMEvent {
  id: string;
  name: string;
  url?: string;
  images?: TMImage[];
  dates?: { start?: { localDate?: string; localTime?: string } };
  priceRanges?: { min?: number; max?: number; currency?: string }[];
  classifications?: { segment?: { name?: string } }[];
  _embedded?: { venues?: { name?: string; city?: { name?: string } }[] };
}

export interface LiveEvent {
  id: string;
  name: string;
  segment: string;
  venue: string;
  local_date: string;
  local_time: string | null;
  price_min_cents: number | null;
  price_max_cents: number | null;
  photo_url: string | null;
  ticket_url: string | null;
}

export async function searchEvents(params: {
  destination: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}): Promise<LiveEvent[]> {
  const apiKey = process.env.TICKETMASTER_API_KEY;
  if (!apiKey) throw new Error("TICKETMASTER_API_KEY missing");

  const geo = await geocodePlace(params.destination).catch(() => null);

  const qs = new URLSearchParams({
    apikey: apiKey,
    startDateTime: `${params.startDate}T00:00:00Z`,
    endDateTime: `${params.endDate}T23:59:59Z`,
    sort: "date,asc",
    size: "24",
  });
  if (geo) {
    qs.set("latlong", `${geo.lat},${geo.lon}`);
    qs.set("radius", "60");
    qs.set("unit", "miles");
  } else {
    qs.set("keyword", params.destination);
  }

  const res = await withTimeout(fetch(`${EVENTS_URL}?${qs.toString()}`));
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ticketmaster events failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { _embedded?: { events?: TMEvent[] } };
  const events = json._embedded?.events ?? [];

  const seen = new Set<string>();
  return events
    .filter((e) => {
      const k = `${e.name}|${e.dates?.start?.localDate}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return Boolean(e.name && e.dates?.start?.localDate);
    })
    .map((e) => {
      const venue = e._embedded?.venues?.[0];
      const widest = (e.images ?? []).slice().sort((a, b) => b.width - a.width)[0];
      const price = e.priceRanges?.[0];
      return {
        id: e.id,
        name: e.name,
        segment: e.classifications?.[0]?.segment?.name ?? "Event",
        venue: [venue?.name, venue?.city?.name].filter(Boolean).join(" · ") || "Venue TBA",
        local_date: e.dates!.start!.localDate!,
        local_time: e.dates?.start?.localTime?.slice(0, 5) ?? null,
        price_min_cents: price?.min != null ? Math.round(price.min * 100) : null,
        price_max_cents: price?.max != null ? Math.round(price.max * 100) : null,
        photo_url: widest?.url ?? null,
        ticket_url: e.url ?? null,
      } satisfies LiveEvent;
    });
}
