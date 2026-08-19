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
 * Uses OSRM's `table` service rather than one route request per target:
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

/** Ceiling on stops per matrix request. See getDistanceMatrix. */
export const MATRIX_MAX_POINTS = 40;

/**
 * Full pairwise driving matrix for a set of points — `out[i][j]` is the leg
 * from point i to point j, or null if that pair couldn't be routed.
 *
 * Deliberately a matrix rather than a route through the points in order.
 * The caller (a day's stop list) reorders constantly via drag-and-drop, and
 * legs are sequence-dependent — routing per ordering would mean a network
 * round trip on every drop. A matrix is keyed on the *set* of stops instead,
 * so reordering is a pure client-side lookup and only adding or removing a
 * stop costs a request.
 *
 * This is also why there is no `getRouteForCoords` here any more: it existed
 * for the per-day route map removed in v0.9.0, and reaching for it to build
 * legs would quietly undo the above. See context.md §3.
 *
 * Unlike `getDistancesFrom` this does NOT chunk. Chunking a matrix would need
 * O(n²/CHUNK²) requests to stay correct across chunk boundaries, and a single
 * day never has that many stops — so it throws past the ceiling rather than
 * silently returning a truncated matrix the caller would read as real.
 */
export async function getDistanceMatrix(
  points: { lat: number; lng: number }[],
): Promise<(DistanceLeg | null)[][]> {
  if (points.length < 2) return [];
  if (points.length > MATRIX_MAX_POINTS) {
    throw new Error(`osrm matrix: ${points.length} points exceeds ${MATRIX_MAX_POINTS}`);
  }

  const coords = points.map((p) => `${p.lng},${p.lat}`).join(";");
  // No `sources` parameter: that's what makes this the full matrix rather
  // than the single row getDistancesFrom asks for.
  const url = `${OSRM_TABLE_URL}/${coords}?annotations=duration,distance`;
  const res = await withTimeout(fetch(url, { headers: { "User-Agent": USER_AGENT } }));
  if (!res.ok) throw new Error(`osrm table failed: ${res.status}`);
  const json = (await res.json()) as {
    code: string;
    durations?: (number | null)[][];
    distances?: (number | null)[][];
  };
  if (json.code !== "Ok") throw new Error(`osrm table failed: ${json.code}`);

  return points.map((_from, i) =>
    points.map((_to, j) => {
      if (i === j) return null;
      const seconds = json.durations?.[i]?.[j];
      if (typeof seconds !== "number") return null;
      const meters = json.distances?.[i]?.[j];
      return { miles: typeof meters === "number" ? meters / 1609.34 : null, hours: seconds / 3600 };
    }),
  );
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
