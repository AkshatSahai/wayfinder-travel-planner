import { Bed, Car, Info, MapPin } from "lucide-react";
import { useActivityDistances } from "@/hooks/use-activity-distances";
import { coordsOf, formatHours, formatMoney } from "@/lib/workspace-store";
import { DestinationMap, type MapCardPin } from "./destination-map";
import type { Tables } from "@/integrations/supabase/types";

type Item = Tables<"trip_items">;

interface Props {
  tripId: string;
  /** Every activity on the trip — scheduled and unscheduled alike. */
  activities: Item[];
  /** The confirmed stay, when one has been booked. */
  lodging: Item | null;
}

const LODGING_PIN_ID = "lodging";

/**
 * The Itinerary tab's reference map: where everything is, and how far each
 * activity is from where you're staying.
 *
 * Deliberately static. It plots the whole activity set regardless of which day
 * anything sits on, and it does not reorder, route, or suggest — the day tabs
 * above it are the only thing that decides sequence. It replaced a per-day map
 * that re-routed the selected day's stops through OSRM and annotated them with
 * AI-written notes; see context.md §3 (v0.9.0) for why that went.
 */
export function ActivityMapPanel({ tripId, activities, lodging }: Props) {
  const located = activities
    .map((a) => ({ item: a, coords: coordsOf(a.details) }))
    .filter((a): a is { item: Item; coords: { lat: number; lng: number } } => a.coords != null);
  const unlocated = activities.filter((a) => coordsOf(a.details) == null);

  const lodgingCoords = lodging ? coordsOf(lodging.details) : null;

  // Shared with the Activities panel's "from stay" line — same query key, so
  // both surfaces render off ONE request rather than each fetching its own.
  const q = useActivityDistances(tripId, activities, lodging);
  const distanceById = q.byId;

  const pins: MapCardPin[] = [
    ...(lodgingCoords
      ? [
          {
            id: LODGING_PIN_ID,
            name: lodging!.title,
            subtitle: "Where you're staying",
            lat: lodgingCoords.lat,
            lng: lodgingCoords.lng,
          },
        ]
      : []),
    ...located.map((a) => ({
      id: a.item.id,
      name: a.item.title,
      subtitle: a.item.category ?? "Activity",
      lat: a.coords.lat,
      lng: a.coords.lng,
    })),
  ];

  return (
    <div className="space-y-3" data-testid="activity-map-panel">
      <div>
        <h3 className="font-display text-lg font-semibold">Where everything is</h3>
        <p className="text-sm text-muted-foreground">
          Every activity you've added, wherever it sits on the plan.
        </p>
      </div>

      {pins.length > 0 ? (
        <div className="h-[520px]">
          <DestinationMap
            pins={pins}
            routeDestination={null}
            origin={null}
            waypoints={[]}
            routePath={null}
            // Rings the stay so it reads differently from the activities around
            // it, without the shared map component needing a notion of "kind".
            selectedPinId={lodgingCoords ? LODGING_PIN_ID : null}
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
