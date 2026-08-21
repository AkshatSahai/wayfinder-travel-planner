import { useMemo } from "react";
import { Bed, Car, Info, MapPin } from "lucide-react";
import { formatLeg, useActivityDistances } from "@/hooks/use-activity-distances";
import { useStayCoords } from "@/hooks/use-stay-coords";
import { coordsOf, formatHours, formatMoney, isBookedLodging } from "@/lib/workspace-store";
import { DestinationMap, type MapCardPin } from "./destination-map";
import type { Tables } from "@/integrations/supabase/types";

type Item = Tables<"trip_items">;

interface Props {
  tripId: string;
  /** Every activity on the trip — scheduled and unscheduled alike. */
  activities: Item[];
  /** Every lodging row: the booked stay and any candidates still being compared. */
  stays: Item[];
  /** The confirmed stay, when one has been booked. Anchors every distance. */
  lodging: Item | null;
  /** The day tab currently open, used only for numbering and emphasis. */
  selectedDay: number;
  /** That day's stops in timeline-rail order. The pin numbers come from here. */
  dayItems: Item[];
}

/**
 * The Itinerary tab's reference map: where everything is, how far each activity
 * is from where you're staying, and — for the day you're looking at — what
 * order you visit things in.
 *
 * It plots the whole trip. Activities on other days and activities not yet
 * scheduled stay on the map, drawn small and faded rather than hidden, because
 * the useful accident is noticing that a stop on Thursday is a block from where
 * you'll already be on Tuesday. Hiding them would remove the only way to see
 * that without switching tabs.
 *
 * ⚠️ **v0.12.0 gave this map a day again, on purpose.** v0.9.0 removed a per-day
 * map, and context.md §3 warned that re-scoping this one would recreate it. What
 * it actually removed was AI-written day notes and a live OSRM re-route on every
 * reorder; neither is here. The numbering comes from the rail's own array and
 * the connector is drawn straight, so nothing is re-fetched when a day is
 * dragged into a new order. Read that section before undoing this.
 */
export function ActivityMapPanel({
  tripId,
  activities,
  stays,
  lodging,
  selectedDay,
  dayItems,
}: Props) {
  const located = activities
    .map((a) => ({ item: a, coords: coordsOf(a.details) }))
    .filter((a): a is { item: Item; coords: { lat: number; lng: number } } => a.coords != null);
  const unlocated = activities.filter((a) => coordsOf(a.details) == null);

  // Resolves a stay's address when the row itself has no coordinates — every
  // stay saved before v0.12.0. Shared with the Lodging tab, which is the point:
  // a stay that pins there now pins here too.
  const { coordsFor: stayCoordsFor } = useStayCoords(stays);
  const lodgingCoords = lodging ? stayCoordsFor(lodging) : null;

  // Shared with the Activities panel's "from stay" line — same query key, so
  // both surfaces render off ONE request rather than each fetching its own.
  const q = useActivityDistances(tripId, activities, lodging);
  const distanceById = q.byId;

  /**
   * Stop numbers come from the day's own array, and every non-lodging stop
   * consumes one whether or not it can be plotted. A stop with no coordinates
   * therefore leaves a gap in the numbers on the map — deliberately. Closing
   * the gap would renumber the plotted stops and make the map contradict the
   * rail, which is the one thing these numbers exist to agree with.
   */
  const numberById = useMemo(() => {
    const m = new Map<string, number>();
    dayItems.filter((i) => i.kind !== "lodging").forEach((i, idx) => m.set(i.id, idx + 1));
    return m;
  }, [dayItems]);

  /**
   * Straight segments through the day's stops in order, starting at the stay
   * when it anchors this day. Shows sequence, not the drive — see `PathLayer`.
   * Memoized on the ordered ids so panning isn't interrupted by a rebuild.
   */
  const daySignature = dayItems.map((i) => i.id).join(">");
  const routePath = useMemo(() => {
    const pts = dayItems
      .map((i) => (i.kind === "lodging" ? stayCoordsFor(i) : coordsOf(i.details)))
      .filter((c): c is { lat: number; lng: number } => c != null);
    return pts.length > 1 ? pts : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daySignature, lodgingCoords]);

  const stayPins: MapCardPin[] = stays.flatMap((s) => {
    const c = stayCoordsFor(s);
    if (!c) return [];
    const booked = isBookedLodging(s);
    return [
      {
        id: s.id,
        name: s.title,
        subtitle: booked ? "Where you're staying" : "Still comparing",
        detail: booked ? "Where you're staying" : "Still comparing",
        kind: booked ? ("lodging-booked" as const) : ("lodging-candidate" as const),
        lat: c.lat,
        lng: c.lng,
      },
    ];
  });

  const pins: MapCardPin[] = [
    ...stayPins,
    ...located.map((a) => {
      const d = distanceById.get(a.item.id);
      const leg = formatLeg(d?.miles ?? null, d?.hours ?? null);
      return {
        id: a.item.id,
        name: a.item.title,
        subtitle: a.item.category ?? "Activity",
        // No booked stay means no distance to state — the name alone, rather
        // than a placeholder implying a measurement that wasn't made.
        detail: leg ? `${leg} from stay` : null,
        label: numberById.get(a.item.id) ?? null,
        dimmed: !numberById.has(a.item.id),
        lat: a.coords.lat,
        lng: a.coords.lng,
      };
    }),
  ];

  return (
    <div className="space-y-3" data-testid="activity-map-panel">
      <div>
        <h3 className="font-display text-lg font-semibold">Where everything is</h3>
        <p className="text-sm text-muted-foreground">
          Day {selectedDay + 1}&apos;s stops are numbered in the order you&apos;ll visit them.
          Everything else on the trip stays on the map, faded.
        </p>
      </div>

      {pins.length > 0 ? (
        <div className="h-[520px]">
          <DestinationMap
            pins={pins}
            routeDestination={null}
            origin={null}
            waypoints={[]}
            routePath={routePath}
            pinStyle="pin"
            selectedPinId={null}
          />
        </div>
      ) : (
        <div
          className="flex h-[520px] items-center justify-center rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground"
          data-testid="activity-map-empty"
        >
          <div>
            <MapPin className="mx-auto mb-2 h-5 w-5" />
            <p>
              {activities.length === 0
                ? "Add activities and they'll show up here."
                : "None of your activities have a location saved yet, so there's nothing to plot."}
            </p>
          </div>
        </div>
      )}

      {!lodgingCoords && (
        <div
          className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 p-3 text-sm"
          data-testid="no-lodging-notice"
        >
          <Bed className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-muted-foreground">
            {lodging
              ? "Your booked stay has no saved location, so distances can't be worked out."
              : "Book a stay on the Lodging tab to see how far each activity is from it."}
          </p>
        </div>
      )}

      {activities.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full text-sm" data-testid="activity-distance-table">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 font-medium">Activity</th>
                <th className="px-4 py-2 font-medium">Category</th>
                <th className="px-4 py-2 font-medium">When</th>
                {lodgingCoords && (
                  <>
                    <th className="px-4 py-2 text-right font-medium">Distance</th>
                    <th className="px-4 py-2 text-right font-medium">Drive time</th>
                  </>
                )}
                <th className="px-4 py-2 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {activities.map((a) => {
                const hasCoords = coordsOf(a.details) != null;
                const d = distanceById.get(a.id);
                return (
                  <tr
                    key={a.id}
                    className="border-b border-border/60 last:border-0"
                    data-testid="activity-distance-row"
                  >
                    <td className="px-4 py-2 font-medium">{a.title}</td>
                    <td className="px-4 py-2">
                      <span className="rounded-full bg-accent/40 px-2 py-0.5 text-xs">
                        {a.category ?? "Activity"}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {a.day_index != null ? (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                          Day {a.day_index + 1}
                        </span>
                      ) : (
                        <span className="text-xs">Unscheduled</span>
                      )}
                    </td>
                    {lodgingCoords && (
                      <>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {!hasCoords ? (
                            <span className="text-xs text-muted-foreground">No location</span>
                          ) : q.isLoading ? (
                            <span className="text-xs text-muted-foreground">…</span>
                          ) : d?.miles != null ? (
                            <span title={d.straight_line ? "Straight-line distance" : undefined}>
                              {d.miles.toFixed(1)} mi{d.straight_line ? "*" : ""}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {!hasCoords || d?.hours == null ? (
                            <span className="text-xs text-muted-foreground">
                              {q.isLoading && hasCoords ? "…" : "—"}
                            </span>
                          ) : (
                            formatHours(d.hours)
                          )}
                        </td>
                      </>
                    )}
                    <td className="px-4 py-2 text-right font-medium">
                      {a.cost_cents ? formatMoney(a.cost_cents) : "Free"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {q.error && (
        <p className="text-xs text-muted-foreground" data-testid="distance-error">
          {q.error}
        </p>
      )}

      {unlocated.length > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="activities-unplotted">
          Not on the map (no location saved): {unlocated.map((a) => a.title).join(", ")}
        </p>
      )}

      {lodgingCoords && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            <Car className="mr-0.5 inline h-3 w-3" />
            Driving distance and time from <strong>{lodging!.title}</strong>, via OSRM. An entry
            marked * is straight-line distance, used when no road route came back.
          </span>
        </p>
      )}
    </div>
  );
}
