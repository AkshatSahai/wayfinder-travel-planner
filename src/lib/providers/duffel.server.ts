// Duffel Flights adapter. Server-only. Test env.

const BASE = "https://api.duffel.com";
const TIMEOUT_MS = 15000; // offer requests can be slow

async function withTimeout<T>(p: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("provider timeout")), ms)),
  ]);
}

function headers() {
  const token = process.env.DUFFEL_API_KEY;
  if (!token) throw new Error("DUFFEL_API_KEY missing");
  return {
    Authorization: `Bearer ${token}`,
    "Duffel-Version": "v2",
    "Content-Type": "application/json",
    Accept: "application/json",
  } as const;
}

interface DuffelPlace {
  iata_code?: string | null;
  name: string;
  type: string;
  iata_city_code?: string | null;
}

async function suggestPlace(query: string): Promise<string | null> {
  const url = `${BASE}/places/suggestions?query=${encodeURIComponent(query)}`;
  const res = await withTimeout(fetch(url, { headers: headers() }));
  if (!res.ok) return null;
  const json = (await res.json()) as { data?: DuffelPlace[] };
  const first = (json.data ?? []).find((d) => d.iata_code || d.iata_city_code);
  return first?.iata_code ?? first?.iata_city_code ?? null;
}

interface DuffelSegment {
  departing_at: string;
  arriving_at: string;
  origin: { iata_code: string; name: string };
  destination: { iata_code: string; name: string };
  marketing_carrier: { name: string; iata_code: string };
  duration: string;
}

interface DuffelSlice {
  duration: string; // ISO 8601 e.g. PT8H45M
  segments: DuffelSegment[];
  origin: { iata_code: string; city_name?: string };
  destination: { iata_code: string; city_name?: string };
  fare_brand_name?: string | null;
}

interface DuffelOffer {
  id: string;
  total_amount: string;
  total_currency: string;
  owner: { name: string; iata_code: string };
  slices: DuffelSlice[];
}

interface OfferRequestResponse {
  data: { id: string; offers: DuffelOffer[] };
}

function isoDurationHours(iso: string): number {
  // parse PT#H#M
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?/.exec(iso);
  if (!m) return 0;
  const h = Number(m[1] ?? 0);
  const min = Number(m[2] ?? 0);
  return Math.round((h + min / 60) * 10) / 10;
}

export interface FlightOption {
  mode: "flight";
  label: string;
  est_duration_hours: number;
  est_cost_cents: number;
  details: string;
  notes: string;
  source_url: string | null;
  offer_id: string;
  fare_brand: string | null;
  cabin: string;
  stops: number;
}

export async function searchFlights(params: {
  origin: string;
  destination: string;
  party_size: number;
  start_date: string;
  end_date: string | null;
}): Promise<FlightOption[]> {
  const [originIata, destIata] = await Promise.all([
    suggestPlace(params.origin),
    suggestPlace(params.destination),
  ]);
  if (!originIata || !destIata) return [];

  const slices: { origin: string; destination: string; departure_date: string }[] = [
    { origin: originIata, destination: destIata, departure_date: params.start_date },
  ];
  if (params.end_date) {
    slices.push({ origin: destIata, destination: originIata, departure_date: params.end_date });
  }

  const passengers = Array.from({ length: Math.max(1, params.party_size) }, () => ({
    type: "adult",
  }));

  const res = await withTimeout(
    fetch(`${BASE}/air/offer_requests?return_offers=true`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        data: { slices, passengers, cabin_class: "economy" },
      }),
    }),
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`duffel offer_request failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as OfferRequestResponse;
  const offers = (json.data?.offers ?? [])
    .slice()
    .sort((a, b) => Number(a.total_amount) - Number(b.total_amount))
    .slice(0, 3);

  return offers.map((o) => {
    const totalDur = o.slices.reduce((s, sl) => s + isoDurationHours(sl.duration), 0);
    const stopsPerSlice = o.slices.map((sl) => sl.segments.length - 1);
    const totalStops = stopsPerSlice.reduce((a, b) => a + b, 0);
    const stopsLabel = stopsPerSlice.every((s) => s === 0)
      ? "nonstop"
      : `${totalStops} stop${totalStops === 1 ? "" : "s"}`;
    const fareBrand = o.slices.find((sl) => sl.fare_brand_name)?.fare_brand_name ?? null;
    const detailLines = o.slices
      .map((sl) => {
        const seg0 = sl.segments[0];
        const segN = sl.segments[sl.segments.length - 1];
        const dep = new Date(seg0.departing_at).toISOString().replace("T", " ").slice(0, 16);
        const arr = new Date(segN.arriving_at).toISOString().replace("T", " ").slice(0, 16);
        return `${sl.origin.iata_code} ${dep} → ${sl.destination.iata_code} ${arr}`;
      })
      .join(" · ");
    return {
      mode: "flight" as const,
      label: `${o.owner.name} · ${stopsLabel}`,
      est_duration_hours: totalDur,
      est_cost_cents: Math.round(Number(o.total_amount) * 100),
      details: detailLines,
      notes: `Total for ${params.party_size} passenger${params.party_size === 1 ? "" : "s"} · ${o.total_currency}`,
      source_url: null,
      offer_id: o.id,
      fare_brand: fareBrand,
      cabin: "economy",
      stops: totalStops,
    };
  });
}
