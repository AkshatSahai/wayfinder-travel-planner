import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Car, Info, MapPin, Sparkles } from "lucide-react";
import { dayPlan } from "@/lib/trip-ai.functions";
import { formatHours } from "@/lib/workspace-store";
import { DestinationMap, type MapCardPin } from "./destination-map";
import type { Tables } from "@/integrations/supabase/types";

type Item = Tables<"trip_items">;

interface Props {
  tripId: string;
  destination: string;
  dayIndex: number;
  /** The traveler-set start time for this day, e.g. "09:00", or null if unset.
   * Only feeds drive-time/route guidance below — never written onto an item. */
  dayStartTime: string | null;
  /** The selected day's rows, already in display order. */
  items: Item[];
}

function coordsOf(item: Item): { lat: number; lng: number } | null {
  const d = (item.details ?? {}) as Record<string, unknown>;
  const c = d.coords as { lat?: number; lng?: number } | undefined;
  return c && typeof c.lat === "number" && typeof c.lng === "number"
    ? { lat: c.lat, lng: c.lng }
    : null;
}

function detailNumber(item: Item, key: string): number | null {
  const d = (item.details ?? {}) as Record<string, unknown>;
  return typeof d[key] === "number" ? (d[key] as number) : null;
}

function detailString(item: Item, key: string): string | null {
  const d = (item.details ?? {}) as Record<string, unknown>;
  return typeof d[key] === "string" && d[key] ? (d[key] as string) : null;
}

/**
 * Right-hand panel of the Itinerary tab: the selected day's map, its driving
 * estimate, and notes.
 *
 * Notes are split by provenance and labelled, because the difference matters:
 * "Live · Google" restates values Google actually returned, "Guidance" is
 * model-written advice. Nothing model-written is ever presented as measured.
 */
export function ItineraryDayPanel({ tripId, destination, dayIndex, dayStartTime, items }: Props) {
  const planFn = useServerFn(dayPlan);

  const stops = items.map((i) => {
    const c = coordsOf(i);
    return {
      id: i.id,
      title: i.title,
      category: i.category,
      lat: c?.lat ?? null,
      lng: c?.lng ?? null,
      rating: detailNumber(i, "rating"),
      review_count: detailNumber(i, "review_count"),
      description: detailString(i, "description") ?? i.subtitle,
      start_time: i.start_time,
    };
  });

  // Keyed on the day's actual contents, so flipping between day tabs replays
  // from cache instead of re-billing an AI call on every switch.
  const signature = stops.map((s) => `${s.id}:${s.lat ?? "-"}:${s.start_time ?? "-"}`).join("|");

  const q = useQuery({
    queryKey: ["day-plan", tripId, dayIndex, dayStartTime, signature],
    queryFn: () =>
      planFn({
        data: { destination, day_number: dayIndex + 1, day_start_time: dayStartTime, stops },
      }),
    enabled: stops.length > 0 && destination.length > 0,
    staleTime: Infinity,
    retry: false,
  });

  const pins: MapCardPin[] = stops
    .filter((s) => s.lat != null && s.lng != null)
    .map((s) => ({
      id: s.id,
      name: s.title,
      subtitle: s.category ?? "Stop",
      lat: s.lat!,
      lng: s.lng!,
    }));

  if (stops.length === 0) {
    return (
      <div
        className="flex h-full min-h-[320px] items-center justify-center rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground"
        data-testid="day-panel-empty"
      >
        Nothing scheduled on this day yet.
      </div>
    );
  }

  const route = q.data?.route ?? null;
  const unplotted = q.data?.unplotted ?? [];

  // The testid deliberately avoids the `itinerary-day-` prefix used by the day
  // columns — a shared prefix makes `[data-testid^="itinerary-day-"]` ambiguous
  // between the day list and this panel.
  return (
    <div className="space-y-3" data-testid="day-side-panel">
      {pins.length >= 1 ? (
        <div className="h-[320px]">
          <DestinationMap
            pins={pins}
            routeDestination={null}
            origin={null}
            waypoints={[]}
            routePath={route?.path ?? null}
            numbered
          />
        </div>
      ) : (
        <div
          className="flex h-[320px] items-center justify-center rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground"
          data-testid="day-map-unavailable"
        >
          <div>
            <MapPin className="mx-auto mb-2 h-5 w-5" />
            <p>None of this day's stops have a location yet, so there's nothing to plot.</p>
          </div>
        </div>
      )}

      {/* Driving estimate */}
      <div
        className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm"
        data-testid="day-drive-summary"
      >
        <Car className="h-4 w-4 shrink-0 text-primary" />
        {q.isLoading ? (
          <span className="text-muted-foreground">Working out the day's driving…</span>
        ) : route ? (
          <span>
            About <strong>{formatHours(route.total_hours)}</strong> driving across{" "}
            {Math.round(route.total_miles)} mi between {pins.length} stops.
          </span>
        ) : (
          <span className="text-muted-foreground">
            {q.data?.route_error ??
              (pins.length < 2
                ? "Add at least two located stops to see a route for this day."
                : "No driving estimate for this day.")}
          </span>
        )}
      </div>

      {unplotted.length > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="day-unplotted">
          Not on the map (no location saved): {unplotted.join(", ")}
        </p>
      )}

      {/* Notes, each carrying its provenance */}
      {(q.data?.live_notes?.length || q.data?.guidance_notes?.length) && (
        <div className="space-y-2" data-testid="day-notes">
          {q.data.live_notes.map((n) => (
            <div
              key={`live-${n.stop_id}`}
              className="flex items-start gap-2 rounded-xl border border-border bg-card p-3"
              data-testid="day-note-live"
            >
              <span className="mt-0.5 shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                Live · Google
              </span>
              <p className="flex-1 text-sm">{n.text}</p>
            </div>
          ))}
          {q.data.guidance_notes.map((n, i) => (
            <div
              key={`guide-${i}`}
              className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 p-3"
              data-testid="day-note-guidance"
            >
              <span className="mt-0.5 shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Guidance
              </span>
              <p className="flex-1 text-sm">{n}</p>
            </div>
          ))}
        </div>
      )}

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3 w-3 shrink-0" />
        <span>
          <strong>Live · Google</strong> notes repeat what Google returned.{" "}
          <strong>Guidance</strong> notes are AI suggestions, not measured data. Google doesn't
          publish busy/quiet times through its API, so timing advice is always guidance.
        </span>
      </p>

      {q.isFetching && !q.isLoading && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Sparkles className="h-3 w-3" /> refreshing…
        </p>
      )}
    </div>
  );
}
