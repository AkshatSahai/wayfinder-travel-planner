// OSRM public routing + Nominatim geocoding adapter. Server-only.
// Both services are free and keyless; Nominatim requires a User-Agent.

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OSRM_URL = "https://router.project-osrm.org/route/v1/driving";
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
}

export async function getDrivingRoute(
  origin: string,
  destination: string,
): Promise<DrivingRoute | null> {
  const [from, to] = await Promise.all([geocodePlace(origin), geocodePlace(destination)]);
  if (!from || !to) return null;

  const url = `${OSRM_URL}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`;
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
  };
}
