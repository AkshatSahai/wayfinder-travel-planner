// Google Places API (New) + Geocoding adapter. Server-only.
// Requires GOOGLE_API_KEY with Places API (New) + Geocoding API enabled.

const PLACES_URL = "https://places.googleapis.com/v1/places:searchText";
const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const TIMEOUT_MS = 8000;

export type ActivityCategory =
  "Food" | "Nature" | "Activity" | "Relaxation" | "Nightlife" | "Spa" | "Culture";

const CATEGORY_QUERIES: Record<ActivityCategory, string> = {
  Food: "top restaurants",
  Nature: "parks, gardens, scenic viewpoints",
  Activity: "tours, attractions, things to do",
  Relaxation: "cafes, tea houses, calm spots",
  Nightlife: "bars, live music, nightlife",
  Spa: "spa, wellness, hot springs",
  Culture: "museums, galleries, historic sites",
};

// Rough per-price-level cost per person, in cents.
const PRICE_LEVEL_CENTS: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1500,
  PRICE_LEVEL_MODERATE: 3500,
  PRICE_LEVEL_EXPENSIVE: 7500,
  PRICE_LEVEL_VERY_EXPENSIVE: 15000,
};

const DURATION_HOURS: Record<ActivityCategory, number> = {
  Food: 1.5,
  Nature: 2,
  Activity: 2.5,
  Relaxation: 1,
  Nightlife: 2.5,
  Spa: 1.5,
  Culture: 1.5,
};

const BEST_TIME: Record<ActivityCategory, string> = {
  Food: "Lunch or dinner",
  Nature: "Morning",
  Activity: "Midday",
  Relaxation: "Afternoon",
  Nightlife: "Evening",
  Spa: "Afternoon",
  Culture: "Morning",
};

interface Place {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  editorialSummary?: { text?: string };
  primaryTypeDisplayName?: { text?: string };
  photos?: { name: string }[];
  googleMapsUri?: string;
}

async function withTimeout<T>(p: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("provider timeout")), ms)),
  ]);
}

export async function geocode(address: string, apiKey: string) {
  const url = `${GEOCODE_URL}?address=${encodeURIComponent(address)}&key=${apiKey}`;
  const res = await withTimeout(fetch(url));
  if (!res.ok) throw new Error(`geocode failed: ${res.status}`);
  const json = (await res.json()) as {
    status: string;
    results: { geometry: { location: { lat: number; lng: number } } }[];
  };
  if (json.status !== "OK" || !json.results[0]) return null;
  const { lat, lng } = json.results[0].geometry.location;
  return { lat, lng };
}

async function searchTextCategory(
  category: ActivityCategory,
  destination: string,
  center: { lat: number; lng: number } | null,
  apiKey: string,
) {
  const body: Record<string, unknown> = {
    textQuery: `${CATEGORY_QUERIES[category]} in ${destination}`,
    maxResultCount: 8,
  };
  if (center) {
    body.locationBias = {
      circle: { center: { latitude: center.lat, longitude: center.lng }, radius: 15000 },
    };
  }

  const res = await withTimeout(
    fetch(PLACES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.priceLevel,places.editorialSummary,places.primaryTypeDisplayName,places.photos,places.googleMapsUri",
      },
      body: JSON.stringify(body),
    }),
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`places search failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { places?: Place[] };
  return (json.places ?? []).map((p) => mapPlace(p, category, apiKey));
}

function mapPlace(p: Place, category: ActivityCategory, apiKey: string) {
  const priceCents = p.priceLevel ? (PRICE_LEVEL_CENTS[p.priceLevel] ?? 2500) : 2500;
  const desc =
    p.editorialSummary?.text ??
    `${p.primaryTypeDisplayName?.text ?? category} · ${p.formattedAddress ?? ""}`.trim();
  const photoName = p.photos?.[0]?.name;
  const photo_url = photoName
    ? `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=800&key=${apiKey}`
    : null;
  return {
    name: p.displayName?.text ?? "Unknown",
    category,
    est_cost_cents: priceCents,
    duration_hours: DURATION_HOURS[category],
    description: desc,
    best_time: BEST_TIME[category],
    rating: p.rating ?? null,
    review_count: p.userRatingCount ?? null,
    photo_url,
    source_url: p.googleMapsUri ?? null,
  };
}

export type PlaceActivity = Awaited<ReturnType<typeof searchTextCategory>>[number];

export interface TopSight {
  name: string;
  description: string;
  rating: number | null;
  review_count: number | null;
  photo_url: string | null;
  maps_url: string | null;
  lat: number | null;
  lng: number | null;
}

// Top attractions for the Destination tab's ranked list + map cards.
export async function searchTopSights(destination: string): Promise<TopSight[]> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY missing");
  const res = await withTimeout(
    fetch(PLACES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.editorialSummary,places.primaryTypeDisplayName,places.photos,places.googleMapsUri",
      },
      body: JSON.stringify({
        textQuery: `top attractions and places to visit in ${destination}`,
        maxResultCount: 10,
      }),
    }),
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`places top-sights failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { places?: Place[] };
  return (json.places ?? []).map((p) => {
    const photoName = p.photos?.[0]?.name;
    return {
      name: p.displayName?.text ?? "Unknown",
      description:
        p.editorialSummary?.text ??
        `${p.primaryTypeDisplayName?.text ?? "Attraction"} · ${p.formattedAddress ?? ""}`.trim(),
      rating: p.rating ?? null,
      review_count: p.userRatingCount ?? null,
      photo_url: photoName
        ? `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=640&key=${apiKey}`
        : null,
      maps_url: p.googleMapsUri ?? null,
      lat: p.location?.latitude ?? null,
      lng: p.location?.longitude ?? null,
    } satisfies TopSight;
  });
}

// Grounding check: does this place actually have the claimed feature?
// A cheap Places text search — verified when at least one result comes back.
export async function verifyFeature(
  place: string,
  claim: string,
): Promise<{ verified: boolean; example: string | null }> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY missing");
  const res = await withTimeout(
    fetch(PLACES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.id,places.displayName",
      },
      body: JSON.stringify({ textQuery: `${claim} in ${place}`, maxResultCount: 2 }),
    }),
  );
  if (!res.ok) throw new Error(`places verify failed: ${res.status}`);
  const json = (await res.json()) as { places?: Place[] };
  const first = json.places?.[0];
  return { verified: Boolean(first), example: first?.displayName?.text ?? null };
}

export async function searchActivitiesReal(destination: string): Promise<PlaceActivity[]> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY missing");
  const center = await geocode(destination, apiKey).catch(() => null);
  const cats = Object.keys(CATEGORY_QUERIES) as ActivityCategory[];
  const results = await Promise.allSettled(
    cats.map((c) => searchTextCategory(c, destination, center, apiKey)),
  );
  const activities: PlaceActivity[] = [];
  for (const r of results) if (r.status === "fulfilled") activities.push(...r.value);
  // Dedupe by name (Places can return the same place across categories).
  const seen = new Set<string>();
  return activities.filter((a) => {
    const k = a.name.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
