// EIA v2 API — weekly regional retail gasoline prices. Server-only.
// Requires EIA_API_KEY (free at eia.gov/opendata).

import { geocodePlace } from "./osrm.server";

const EIA_URL = "https://api.eia.gov/v2/petroleum/pri/gnd/data/";
const TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 6 * 3600_000;

// duoarea codes: NUS = US average, R10/R20/R30/R40/R50 = PADD districts 1-5.
const STATE_TO_PADD: Record<string, string> = {
  // PADD 1 — East Coast
  CT: "R10",
  ME: "R10",
  MA: "R10",
  NH: "R10",
  RI: "R10",
  VT: "R10",
  DE: "R10",
  DC: "R10",
  MD: "R10",
  NJ: "R10",
  NY: "R10",
  PA: "R10",
  FL: "R10",
  GA: "R10",
  NC: "R10",
  SC: "R10",
  VA: "R10",
  WV: "R10",
  // PADD 2 — Midwest
  IL: "R20",
  IN: "R20",
  IA: "R20",
  KS: "R20",
  KY: "R20",
  MI: "R20",
  MN: "R20",
  MO: "R20",
  NE: "R20",
  ND: "R20",
  OH: "R20",
  OK: "R20",
  SD: "R20",
  TN: "R20",
  WI: "R20",
  // PADD 3 — Gulf Coast
  AL: "R30",
  AR: "R30",
  LA: "R30",
  MS: "R30",
  NM: "R30",
  TX: "R30",
  // PADD 4 — Rocky Mountain
  CO: "R40",
  ID: "R40",
  MT: "R40",
  UT: "R40",
  WY: "R40",
  // PADD 5 — West Coast
  AK: "R50",
  AZ: "R50",
  CA: "R50",
  HI: "R50",
  NV: "R50",
  OR: "R50",
  WA: "R50",
};

const STATE_NAMES: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
  "district of columbia": "DC",
};

const cache = new Map<string, { price: number; region: string; at: number }>();

async function withTimeout<T>(p: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("provider timeout")), ms)),
  ]);
}

function duoareaFor(placeName: string | null): string {
  if (!placeName) return "NUS";
  const lower = placeName.toLowerCase();
  for (const [name, code] of Object.entries(STATE_NAMES)) {
    if (lower.includes(name)) return STATE_TO_PADD[code] ?? "NUS";
  }
  return "NUS";
}

export interface GasPrice {
  price_per_gallon: number;
  region: string;
  source: "eia";
}

// Live weekly regular-gasoline retail price for the region containing `origin`.
export async function getGasPrice(origin: string): Promise<GasPrice> {
  const apiKey = process.env.EIA_API_KEY;
  if (!apiKey) throw new Error("EIA_API_KEY missing");

  const geo = await geocodePlace(origin).catch(() => null);
  const duoarea = duoareaFor(geo?.display_name ?? origin);

  const hit = cache.get(duoarea);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { price_per_gallon: hit.price, region: hit.region, source: "eia" };
  }

  const qs = new URLSearchParams({
    api_key: apiKey,
    frequency: "weekly",
    "data[0]": "value",
    "facets[product][]": "EPMR",
    "facets[duoarea][]": duoarea,
    "sort[0][column]": "period",
    "sort[0][direction]": "desc",
    length: "1",
  });
  const res = await withTimeout(fetch(`${EIA_URL}?${qs}`));
  if (!res.ok) throw new Error(`eia request failed: ${res.status}`);
  const json = (await res.json()) as {
    response?: { data?: { value: number | string; "area-name"?: string }[] };
  };
  const row = json.response?.data?.[0];
  if (!row) throw new Error("eia returned no price data");
  const price = Number(row.value);
  const region = row["area-name"] ?? (duoarea === "NUS" ? "U.S. average" : duoarea);
  cache.set(duoarea, { price, region, at: Date.now() });
  return { price_per_gallon: price, region, source: "eia" };
}
