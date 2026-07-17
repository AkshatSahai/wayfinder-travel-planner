// TravelPayouts Hotellook adapter. Server-only.
// Public endpoints (no token required for cache.json), but we send the token
// when available for higher rate limits.

const LOOKUP_URL = "https://engine.hotellook.com/api/v2/lookup.json";
const CACHE_URL = "https://engine.hotellook.com/api/v2/cache.json";
const TIMEOUT_MS = 8000;

async function withTimeout<T>(p: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("provider timeout")), ms)),
  ]);
}

interface LookupLocation {
  id: number;
  cityName: string;
  fullName: string;
  countryName?: string;
  hotelsCount?: number;
}

interface LookupResponse {
  status: string;
  results: { locations?: LookupLocation[] };
}

interface CacheHotel {
  hotelId: number;
  hotelName: string;
  stars: number;
  priceFrom: number;
  priceAvg: number;
  pricePercentile?: Record<string, number>;
  location?: { name?: string; country?: string; geo?: { lat: number; lon: number } };
  locationId?: number;
}

export interface TPHotel {
  name: string;
  type: "hotel" | "resort" | "rental" | "boutique" | "bnb";
  fit_score: number;
  nightly_cents: number;
  neighborhood: string;
  amenities: string[];
  rationale: string;
  rating: number | null;
  review_count: number | null;
  photo_url: string | null;
  source_url: string;
}

function daysBetween(a: string, b: string) {
  return Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000));
}

function inferType(stars: number): TPHotel["type"] {
  if (stars >= 5) return "resort";
  if (stars >= 4) return "boutique";
  if (stars >= 3) return "hotel";
  if (stars > 0) return "bnb";
  return "hotel";
}

async function lookupLocation(query: string, token: string | undefined) {
  const url = `${LOOKUP_URL}?query=${encodeURIComponent(query)}&lang=en&lookFor=both&limit=1${token ? `&token=${token}` : ""}`;
  const res = await withTimeout(fetch(url));
  if (!res.ok) throw new Error(`travelpayouts lookup failed: ${res.status}`);
  const json = (await res.json()) as LookupResponse;
  return json.results?.locations?.[0] ?? null;
}

export async function searchHotels(params: {
  destination: string;
  checkIn: string;
  checkOut: string;
  adults: number;
}): Promise<TPHotel[]> {
  const token = process.env.TRAVELPAYOUTS_API_KEY;
  const loc = await lookupLocation(params.destination, token);
  if (!loc) return [];

  const nights = daysBetween(params.checkIn, params.checkOut);
  const url =
    `${CACHE_URL}?location=${encodeURIComponent(loc.fullName)}` +
    `&checkIn=${params.checkIn}&checkOut=${params.checkOut}` +
    `&adults=${params.adults}&currency=usd&limit=12` +
    (token ? `&token=${token}` : "");

  const res = await withTimeout(fetch(url));
  if (!res.ok) throw new Error(`travelpayouts cache failed: ${res.status}`);
  const raw = (await res.json()) as unknown;
  if (!Array.isArray(raw)) return [];
  const hotels = raw as CacheHotel[];

  return hotels
    .filter((h) => h && h.hotelName && h.priceAvg > 0)
    .map((h) => {
      const nightly = Math.round((h.priceAvg / nights) * 100);
      const type = inferType(h.stars);
      const amenities: string[] = [];
      if (h.stars) amenities.push(`${h.stars}★`);
      const deepLink =
        `https://search.hotellook.com/hotels?` +
        `destination=${encodeURIComponent(loc.cityName)}` +
        `&checkIn=${params.checkIn}&checkOut=${params.checkOut}` +
        `&adults=${params.adults}&hotelId=${h.hotelId}`;
      return {
        name: h.hotelName,
        type,
        fit_score: Math.min(100, Math.round((h.stars || 3) * 20)),
        nightly_cents: nightly,
        neighborhood: h.location?.name ?? loc.cityName,
        amenities,
        rationale: `${h.stars ? `${h.stars}-star ` : ""}${type} in ${h.location?.name ?? loc.cityName}. Avg $${Math.round(h.priceAvg)} total for ${nights} night${nights === 1 ? "" : "s"}.`,
        rating: h.stars || null,
        review_count: null,
        photo_url: `https://photo.hotellook.com/image_v2/limit/h${h.hotelId}_1/800/520.auto`,
        source_url: deepLink,
      } satisfies TPHotel;
    });
}
