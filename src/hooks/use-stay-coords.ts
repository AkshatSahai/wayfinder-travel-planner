import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { geocodeLabels } from "@/lib/places.functions";
import { coordsOf, type LatLng } from "@/lib/workspace-store";
import type { Tables } from "@/integrations/supabase/types";

type Item = Tables<"trip_items">;

export const stayLocationOf = (s: Item) =>
  ((s.details ?? {}) as Record<string, unknown>).location as string | undefined;

/**
 * Resolve coordinates for lodging rows, wherever a stay needs to be plotted.
 *
 * Stays added before v0.12.0 have an address string and no `details.coords`,
 * because nothing on the write path geocoded them (see `enrichItemLocation` in
 * `trips.functions.ts` for that history). This backfills them from their stored
 * location text so they still pin.
 *
 * ⚠️ **This lived inside `lodging-panel.tsx` until v0.12.0, and that is exactly
 * why the booked stay was missing from the Itinerary map**: the Lodging tab
 * geocoded its own stays and rendered them, while `ActivityMapPanel` read
 * `coordsOf(details)` directly, got `null`, and silently dropped the pin. One
 * shared resolver means the two maps can no longer disagree about where — or
 * whether — a stay is. Don't reintroduce a local copy.
 *
 * The geocode result is deliberately **not** written back to the row. A read
 * path that quietly mutates rows would fire on every viewer of a shared trip,
 * including collaborators whose RLS grants may differ. New rows get persisted
 * coordinates at write time instead; this is only the healer for old ones.
 *
 * The query key is the sorted, de-duplicated label list, so every surface asking
 * about the same set of stays shares one request — the same reasoning as
 * `signatureOf` in `use-activity-distances.ts`.
 *
 * Known and accepted: a caller passing a *subset* (the distance hook passes the
 * booked stay alone) keys differently from one passing every stay, so those two
 * can issue separate batches. It's bounded — only rows saved before v0.12.0 lack
 * coordinates at all, and anything added since resolves them at write time, so
 * this fires zero requests on a current trip. Don't "fix" it by geocoding
 * per-label with `useQueries`; that trades one batch for N round trips.
 */
export function useStayCoords(stays: Item[]) {
  const geocodeFn = useServerFn(geocodeLabels);

  // Sorted and de-duplicated so the key describes the *set* of addresses, not
  // the order they happened to arrive in or how many stays share one. Two
  // callers looking at the same stays therefore share a single request.
  const labels = [
    ...new Set(
      stays
        .filter((s) => !coordsOf(s.details))
        .map(stayLocationOf)
        .filter(Boolean),
    ),
  ].sort() as string[];

  const { data: geocoded } = useQuery({
    queryKey: ["stay-coords", labels.join("|")],
    queryFn: () => geocodeFn({ data: { labels } }),
    enabled: labels.length > 0,
    staleTime: Infinity,
    retry: false,
  });

  /**
   * Stored coordinates win. `coordsOf` rather than a local reader, so a legacy
   * flat `details.lat`/`lng` row resolves here too.
   */
  const coordsFor = (s: Item): LatLng | null => {
    const stored = coordsOf(s.details);
    if (stored) return stored;
    const hit = geocoded?.results.find((r) => r.label === stayLocationOf(s));
    return hit?.coords ?? null;
  };

  /**
   * A dependency handle for callers that memoize off `coordsFor`. `coordsFor`
   * is a fresh closure every render, so listing it in a `useMemo` dep array
   * would recompute unconditionally; this changes only when a geocode actually
   * resolves.
   */
  const coordsKey = (geocoded?.results ?? [])
    .map((r) => `${r.label}:${r.coords ? `${r.coords.lat},${r.coords.lng}` : "none"}`)
    .join("|");

  return { coordsFor, coordsKey, isResolving: labels.length > 0 && !geocoded };
}
