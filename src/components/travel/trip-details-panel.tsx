import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { estimateTravelTime, type TravelMode } from "@/lib/travel.functions";
import { topPlaces } from "@/lib/trip-ai.functions";
import { Button } from "@/components/ui/button";
import { DestinationMap, type MapCardPin } from "./destination-map";
import { DestinationPickerDialog, type ParsedTrip } from "./destination-picker-dialog";
import {
  MapPin,
  Pencil,
  Car,
  Plane,
  TrainFront,
  CalendarClock,
  CheckCircle2,
  Circle,
  ListChecks,
  X,
  Plus,
} from "lucide-react";
import {
  formatHours,
  daysUntil,
  isBookedLodging,
  committedItems,
  type LatLng,
} from "@/lib/workspace-store";
import type { Tables } from "@/integrations/supabase/types";

type Item = Tables<"trip_items">;

const MODES: { value: TravelMode; label: string; icon: typeof Car }[] = [
  { value: "car", label: "Car", icon: Car },
  { value: "flight", label: "Flight", icon: Plane },
  { value: "train", label: "Train", icon: TrainFront },
];

interface Props {
  parsed: ParsedTrip;
  destination: string;
  origin: string;
  originCoords: LatLng | null;
  destinationCoords: LatLng | null;
  startDate: string | null;
  endDate: string | null;
  partySize: number;
  budgetCents: number | null;
  waypoints: string[];
  items: Item[];
  onPick: (name: string) => void;
  onUpdateWaypoints: (waypoints: string[]) => void;
}

/**
 * Trip Details — the workspace's overview dashboard. Replaces the old
 * Destination tab; AI curation now lives in a dialog opened from here.
 */
export function TripDetailsPanel({
  parsed,
  destination,
  origin,
  originCoords,
  destinationCoords,
  startDate,
  endDate,
  partySize,
  budgetCents,
  waypoints,
  items,
  onPick,
  onUpdateWaypoints,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mode, setMode] = useState<TravelMode>(
    parsed.travel_mode && parsed.travel_mode !== "unknown" ? parsed.travel_mode : "car",
  );
  const [showStops, setShowStops] = useState(false);

  const estimateFn = useServerFn(estimateTravelTime);
  const sightsFn = useServerFn(topPlaces);

  const estimateQ = useQuery({
    queryKey: ["travel-estimate", origin, destination, mode, startDate],
    queryFn: () =>
      estimateFn({
        data: {
          origin,
          destination,
          mode,
          party_size: partySize,
          start_date: startDate,
          end_date: endDate,
        },
      }),
    enabled: destination.length > 0 && origin.length > 0,
    staleTime: Infinity,
    retry: false,
  });

  const sightsQ = useQuery({
    queryKey: ["top-sights", destination],
    queryFn: () => sightsFn({ data: { destination } }),
    enabled: showStops && destination.length > 0,
    staleTime: Infinity,
    retry: false,
  });

  // ---- Derived trip state ----
  const scheduled = committedItems(items);
  const bookedLodging = items.filter(isBookedLodging);
  const transportItems = scheduled.filter((i) => i.kind === "transport");
  // Counts staged activities too: the traveler has done the "add activities"
  // work as soon as one exists on the Activities tab, whether or not it has
  // been scheduled onto a day yet.
  const activityItems = items.filter((i) => i.kind === "activity");
  const countdown = daysUntil(startDate);

  const tasks = [
    { done: bookedLodging.length > 0, label: "Book lodging" },
    { done: activityItems.length > 0, label: "Add activities" },
    { done: transportItems.length > 0, label: "Sort out transport" },
    { done: budgetCents != null, label: "Set a budget" },
    { done: Boolean(startDate && endDate), label: "Set your dates" },
    { done: origin.length > 0, label: "Add a starting location" },
  ];
  const pending = tasks.filter((t) => !t.done);

  const pins: MapCardPin[] = showStops
    ? (sightsQ.data?.sights ?? [])
        .filter((s) => s.lat != null && s.lng != null)
        .map((s) => ({
          id: s.name,
          name: s.name,
          subtitle: s.rating ? `★ ${s.rating}` : "Attraction",
          photo_url: s.photo_url,
          lat: s.lat!,
          lng: s.lng!,
        }))
    : [
        originCoords && {
          id: "origin",
          name: origin || "Start",
          subtitle: "Starting point",
          lat: originCoords.lat,
          lng: originCoords.lng,
        },
        destinationCoords && {
          id: "destination",
          name: destination || "Destination",
          subtitle: "Destination",
          lat: destinationCoords.lat,
          lng: destinationCoords.lng,
        },
      ].filter((p): p is MapCardPin => Boolean(p));

  const addStop = (name: string) => {
    if (waypoints.includes(name) || waypoints.length >= 10) return;
    onUpdateWaypoints([...waypoints, name]);
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(360px,1fr)_minmax(380px,1.1fr)]">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 font-display text-xl font-semibold">
              <MapPin className="h-5 w-5 text-primary" />
              {destination || "No destination yet"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {origin ? `Leaving from ${origin}` : "Add a starting location for travel estimates."}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
            <Pencil className="mr-1 h-3 w-3" /> Change destination
          </Button>
        </div>

        {/* ---- Countdown ---- */}
        <div
          className="rounded-2xl border border-border bg-card p-5 shadow-soft"
          data-testid="trip-countdown"
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            <CalendarClock className="h-4 w-4 text-primary" /> Countdown
          </div>
          {countdown == null ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Set your trip dates to start the countdown.
            </p>
          ) : countdown > 0 ? (
            <p className="mt-1">
              <span className="font-display text-3xl font-semibold">{countdown}</span>
              <span className="ml-2 text-sm text-muted-foreground">
                day{countdown === 1 ? "" : "s"} until departure
              </span>
            </p>
          ) : countdown === 0 ? (
            <p className="mt-2 font-display text-2xl font-semibold text-primary">
              Today's the day.
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              This trip started {Math.abs(countdown)} day{countdown === -1 ? "" : "s"} ago.
            </p>
          )}
        </div>

        {/* ---- Travel time estimate ---- */}
        <div
          className="rounded-2xl border border-border bg-card p-5 shadow-soft"
          data-testid="travel-estimate"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">Estimated travel time</p>
            <div className="flex gap-1 rounded-lg bg-muted p-1">
              {MODES.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => setMode(value)}
                  aria-pressed={mode === value}
                  className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    mode === value
                      ? "bg-card text-foreground shadow-soft"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {!origin || !destination ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Needs both a starting location and a destination.
            </p>
          ) : estimateQ.isFetching ? (
            <div className="mt-3 h-8 w-32 animate-pulse rounded bg-muted" />
          ) : (
            <>
              <p className="mt-2 font-display text-3xl font-semibold">
                {estimateQ.data?.hours != null ? formatHours(estimateQ.data.hours) : "—"}
                {estimateQ.data?.estimated && estimateQ.data.hours != null && (
                  <span className="ml-2 align-middle text-xs font-normal text-muted-foreground">
                    estimate
                  </span>
                )}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {estimateQ.data?.detail ?? "Unavailable."}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                One way. Estimate only — no booking involved.
              </p>
            </>
          )}
        </div>

        {/* ---- Booking status ---- */}
        <div
          className="rounded-2xl border border-border bg-card p-5 shadow-soft"
          data-testid="booking-status"
        >
          <p className="text-sm font-medium">Booking status</p>
          <div className="mt-3 space-y-2 text-sm">
            <StatusRow
              label="Lodging"
              done={bookedLodging.length > 0}
              value={bookedLodging.length > 0 ? bookedLodging[0].title : "Not booked"}
            />
            <StatusRow
              label="Transport"
              done={transportItems.length > 0}
              value={transportItems.length > 0 ? `${transportItems.length} booked` : "Not booked"}
            />
            <StatusRow
              label="Activities"
              done={activityItems.length > 0}
              value={`${activityItems.length} booked`}
            />
          </div>
        </div>

        {/* ---- Pending tasks ---- */}
        <div
          className="rounded-2xl border border-border bg-card p-5 shadow-soft"
          data-testid="pending-tasks"
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            <ListChecks className="h-4 w-4 text-primary" /> Pending tasks
          </div>
          {pending.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Nothing outstanding — this trip is fully planned.
            </p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {pending.map((t) => (
                <li key={t.label} className="flex items-center gap-2">
                  <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  {t.label}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ---- Route stops ---- */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">Stops along your route</p>
              <p className="text-xs text-muted-foreground">
                The Transport tab's driving cost includes these.
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowStops((v) => !v)}>
              {showStops ? "Done" : "Add stops"}
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5" data-testid="waypoint-chips">
            {waypoints.length === 0 && (
              <span className="text-xs text-muted-foreground">No stops yet.</span>
            )}
            {waypoints.map((w) => (
              <span
                key={w}
                className="inline-flex items-center gap-1 rounded-full bg-sidebar-active/10 px-2.5 py-1 text-xs font-medium text-primary"
              >
                {w}
                <button onClick={() => onUpdateWaypoints(waypoints.filter((x) => x !== w))}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>

          {showStops && (
            <div className="mt-3 space-y-2 border-t border-border pt-3">
              {sightsQ.isLoading && <div className="h-20 animate-pulse rounded-xl bg-muted/40" />}
              {(sightsQ.data?.sights ?? []).slice(0, 8).map((s) => (
                <div key={s.name} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                  <button
                    className="shrink-0 text-xs font-medium text-primary hover:underline disabled:opacity-50"
                    disabled={waypoints.includes(s.name)}
                    onClick={() => addStop(s.name)}
                  >
                    <Plus className="mr-0.5 inline h-3 w-3" />
                    {waypoints.includes(s.name) ? "Added" : "Add"}
                  </button>
                </div>
              ))}
              {sightsQ.data && (sightsQ.data.sights?.length ?? 0) === 0 && (
                <p className="text-xs text-muted-foreground">
                  {sightsQ.data.error ?? "No suggestions available."}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ---- Map ---- */}
      <div className="min-h-[380px] xl:sticky xl:top-4 xl:h-[calc(100vh-8rem)]">
        <DestinationMap
          pins={pins}
          routeDestination={destination || null}
          origin={origin || null}
          waypoints={waypoints}
          selectedPinId={destination || null}
          onAddStop={showStops ? addStop : undefined}
        />
      </div>

      <DestinationPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        parsed={parsed}
        current={destination}
        origin={origin}
        onPick={onPick}
      />
    </div>
  );
}

function StatusRow({ label, done, value }: { label: string; done: boolean; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-2">
        {done ? (
          <CheckCircle2 className="h-4 w-4 text-success" />
        ) : (
          <Circle className="h-4 w-4 text-muted-foreground" />
        )}
        {label}
      </span>
      <span className={`truncate text-right ${done ? "" : "text-muted-foreground"}`}>{value}</span>
    </div>
  );
}
