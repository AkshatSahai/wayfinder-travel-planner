// OSRM public routing + Nominatim geocoding adapter. Server-only.
// Both services are free and keyless; Nominatim requires a User-Agent.

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OSRM_URL = "https://router.project-osrm.org/route/v1/driving";
const OSRM_TABLE_URL = "https://router.project-osrm.org/table/v1/driving";
/** Coordinates per `table` request. The demo server's ceiling is 100 including
 * the source; stay well under it rather than discovering the limit in prod. */
const CHUNK = 50;
const TIMEOUT_MS = 8000;
const USER_AGENT = "Wayfinder/1.0 (trip planner)";

async function withTimeout<T>(p: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("provider timeout")), ms)),
  ]);
}

export interface GeoPoint {
  lat: number;
  lon: number;
  display_name: string;
}

export async function geocodePlace(query: string): Promise<GeoPoint | null> {
  const url = `${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=json&limit=1`;
  const res = await withTimeout(fetch(url, { headers: { "User-Agent": USER_AGENT } }));
  if (!res.ok) throw new Error(`nominatim failed: ${res.status}`);
  const json = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  const first = json[0];
  if (!first) return null;
  return { lat: Number(first.lat), lon: Number(first.lon), display_name: first.display_name };
}

export interface DrivingRoute {
  miles_one_way: number;
  drive_hours_one_way: number;
  stop_count: number;
}

export interface CoordRoute {
  total_miles: number;
  total_hours: number;
  /** Duration of each hop, in the order the stops were given. */
  leg_hours: number[];
  /** Road geometry as [lat, lng] pairs, for drawing the route on a map. */
  path: { lat: number; lng: number }[];
}

/**
 * Route a sequence of already-known coordinates — for a single day's stops.
 *
 * Deliberately separate from `getDrivingRoute`, which takes place-name strings
 * and geocodes each one through Nominatim. Nominatim asks for ~1 request/second,
 * so routing a day of six stops by name would be slow and rate-limited. Activity
 * coordinates are already stored in `details.coords`, so use them.
 *
 * Requests full geometry so the real road path can be drawn rather than
 * straight lines between pins.
 */
export async function getRouteForCoords(
  points: { lat: number; lng: number }[],
): Promise<CoordRoute | null> {
  if (points.length < 2) return null;
  const path = points.map((p) => `${p.lng},${p.lat}`).join(";");
  const url = `${OSRM_URL}/${path}?overview=full&geometries=geojson`;
  const res = await withTimeout(fetch(url, { headers: { "User-Agent": USER_AGENT } }));
  if (!res.ok) throw new Error(`osrm route failed: ${res.status}`);
  const json = (await res.json()) as {
    code: string;
    routes?: {
      distance: number;
      duration: number;
      legs?: { duration: number }[];
      geometry?: { coordinates: [number, number][] };
    }[];
  };
  const route = json.routes?.[0];
  if (json.code !== "Ok" || !route) return null;

  return {
    total_miles: route.distance / 1609.34,
    total_hours: route.duration / 3600,
    leg_hours: (route.legs ?? []).map((l) => l.duration / 3600),
    // OSRM geojson is [lng, lat]; Google wants {lat, lng}.
    path: (route.geometry?.coordinates ?? []).map(([lng, lat]) => ({ lat, lng })),
  };
}

export interface DistanceLeg {
  /**
   * Road miles. Null when this OSRM build didn't return the `distance`
   * annotation — the caller substitutes straight-line distance, which it can
   * do because it still holds both coordinates.
   */
  miles: number | null;
  hours: number;
}

/**
 * Driving distance and time from ONE origin to many targets.
 *
 * Uses OSRM's `table` service rather than N calls to `getRouteForCoords`:
 * `sources=0` asks for just the origin's row of the matrix, so a trip with
 * twenty activities costs one request instead of twenty. The public demo
 * server is rate-limited and this runs whenever the activity set changes.
 *
 * Returns an array index-aligned with `targets`; an entry is null when that
 * leg couldn't be routed. Never throws for a single unroutable target — only
 * a transport-level failure propagates.
 */
export async function getDistancesFrom(
  origin: { lat: number; lng: number },
  targets: { lat: number; lng: number }[],
): Promise<(DistanceLeg | null)[]> {
  if (targets.length === 0) return [];

  const out: (DistanceLeg | null)[] = [];
  for (let start = 0; start < targets.length; start += CHUNK) {
    const chunk = targets.slice(start, start + CHUNK);
    const coords = [origin, ...chunk].map((p) => `${p.lng},${p.lat}`).join(";");
    const url = `${OSRM_TABLE_URL}/${coords}?sources=0&annotations=duration,distance`;
    const res = await withTimeout(fetch(url, { headers: { "User-Agent": USER_AGENT } }));
    if (!res.ok) throw new Error(`osrm table failed: ${res.status}`);
    const json = (await res.json()) as {
      code: string;
      durations?: (number | null)[][];
      distances?: (number | null)[][];
    };
    if (json.code !== "Ok") throw new Error(`osrm table failed: ${json.code}`);

    // Row 0 is the origin's row; column 0 is the origin itself, so the target
    // at chunk index i sits at column i + 1.
    const durations = json.durations?.[0] ?? [];
    const distances = json.distances?.[0] ?? [];

    chunk.forEach((_target, i) => {
      const seconds = durations[i + 1];
      if (typeof seconds !== "number") {
        out.push(null);
        return;
      }
      const meters = distances[i + 1];
      out.push({
        miles: typeof meters === "number" ? meters / 1609.34 : null,
        hours: seconds / 3600,
      });
    });
  }
  return out;
}

// Route origin → (waypoints…) → destination as one chained OSRM path.
export async function getDrivingRoute(
  origin: string,
  destination: string,
  waypoints: string[] = [],
): Promise<DrivingRoute | null> {
  const points = await Promise.all([origin, ...waypoints, destination].map((q) => geocodePlace(q)));
  const located = points.filter((p): p is GeoPoint => p !== null);
  // Origin and destination must both resolve; skip waypoints that don't.
  if (!points[0] || !points[points.length - 1]) return null;

  const path = located.map((p) => `${p.lon},${p.lat}`).join(";");
  const url = `${OSRM_URL}/${path}?overview=false`;
  const res = await withTimeout(fetch(url, { headers: { "User-Agent": USER_AGENT } }));
  if (!res.ok) throw new Error(`osrm route failed: ${res.status}`);
  const json = (await res.json()) as {
    code: string;
    routes?: { distance: number; duration: number }[];
  };
  const route = json.routes?.[0];
  if (json.code !== "Ok" || !route) return null;

  return {
    miles_one_way: route.distance / 1609.34,
    drive_hours_one_way: route.duration / 3600,
    stop_count: located.length - 2,
  };
}
