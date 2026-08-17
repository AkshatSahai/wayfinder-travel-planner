import { createFileRoute, getRouteApi, Link, notFound } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { ChevronLeft, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";

import {
  getTrip,
  updateTrip,
  addTripItem,
  removeTripItem,
  updateTripItem,
  updateTripItems,
} from "@/lib/trips.functions";
import { buildItinerary } from "@/lib/trip-ai.functions";
import {
  daysBetween,
  isBookedLodging,
  isLodgingCandidate,
  isStagedActivity,
  stagedActivities,
  LODGING_BOOKED,
  LODGING_CANDIDATE,
  type LatLng,
} from "@/lib/workspace-store";
import { AppSidebar, type WorkspaceTab } from "@/components/shell/app-sidebar";
import { TripMetaBar } from "@/components/shell/trip-meta-bar";

import { TripDetailsPanel } from "@/components/travel/trip-details-panel";
import { LodgingPanel } from "@/components/travel/lodging-panel";
import { TransportPanel } from "@/components/travel/transport-panel";
import { ActivitiesPanel } from "@/components/travel/activities-panel";
import { ItineraryPanel, type ItemMove } from "@/components/travel/itinerary-panel";
import { MissingFieldsBanner } from "@/components/travel/missing-fields-banner";
import { ShareTripDialog } from "@/components/travel/share-trip-dialog";
import type { ParsedTrip } from "@/components/travel/destination-picker-dialog";

const authRoute = getRouteApi("/_authenticated");

const TABS = ["details", "lodging", "transport", "activities", "itinerary"] as const;

export const Route = createFileRoute("/_authenticated/trips/$tripId")({
  // `.catch` keeps links to the retired ?tab=destination working — unknown
  // tabs fall through to the dashboard rather than throwing.
  validateSearch: (s) => z.object({ tab: z.enum(TABS).optional().catch(undefined) }).parse(s),
  head: ({ params }) => ({
    meta: [
      { title: `Trip ${params.tripId.slice(0, 8)} — Wayfinder` },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: WorkspacePage,
});

function WorkspacePage() {
  const { tripId } = Route.useParams();
  const { tab: tabParam } = Route.useSearch();
  const navigate = Route.useNavigate();
  const tab: WorkspaceTab = tabParam ?? "details";
  const setTab = (t: WorkspaceTab) => navigate({ search: { tab: t }, replace: true });
  const { user } = authRoute.useRouteContext();
  const [shareOpen, setShareOpen] = useState(false);

  const qc = useQueryClient();
  const getFn = useServerFn(getTrip);
  const updateFn = useServerFn(updateTrip);
  const addFn = useServerFn(addTripItem);
  const removeFn = useServerFn(removeTripItem);
  const updateItemFn = useServerFn(updateTripItem);
  const updateItemsFn = useServerFn(updateTripItems);
  const buildFn = useServerFn(buildItinerary);

  const { data, isLoading, error } = useQuery({
    queryKey: ["trip", tripId],
    queryFn: () => getFn({ data: { id: tripId } }),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["trip", tripId] });

  const updateMut = useMutation({
    mutationFn: (patch: Record<string, unknown>) => updateFn({ data: { id: tripId, ...patch } }),
    onSuccess: invalidate,
  });

  type NewItem = {
    trip_id: string;
    kind: "lodging" | "transport" | "activity" | "block";
    category?: string | null;
    day_index?: number | null;
    start_time?: string | null;
    end_time?: string | null;
    title: string;
    subtitle?: string | null;
    details?: Record<string, unknown>;
    cost_cents: number;
    source_url?: string | null;
    sort_order?: number;
  };
  const addMut = useMutation({
    mutationFn: (item: NewItem) => addFn({ data: item }),
    onSuccess: (_res, item) => {
      invalidate();
      // Three destinations, three different messages — telling someone their
      // activity was "added to itinerary" when it was staged is exactly the
      // confusion this release is fixing.
      if (item.category === LODGING_CANDIDATE) toast.success("Added to comparison");
      else if (isStagedActivity(item)) toast.success("Added to your activities");
      else toast.success("Added to itinerary");
    },
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => removeFn({ data: { id } }),
    onSuccess: invalidate,
  });

  // Booking is exclusive: the chosen stay becomes the itinerary's lodging block
  // and any previously booked stay drops back into the comparison list.
  const bookMut = useMutation({
    mutationFn: async (id: string) => {
      const previouslyBooked = (data?.items ?? []).filter((i) => isBookedLodging(i) && i.id !== id);
      await Promise.all([
        updateItemFn({ data: { id, category: LODGING_BOOKED } }),
        ...previouslyBooked.map((i) =>
          updateItemFn({ data: { id: i.id, category: LODGING_CANDIDATE } }),
        ),
      ]);
    },
    onSuccess: () => {
      invalidate();
      toast.success("Booked — added to your itinerary and budget");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // "Build out itinerary": AI schedules every staged activity onto a day, and
  // any location/coords it had to look up are written back onto the activity
  // rather than used once and discarded.
  const buildMut = useMutation({
    mutationFn: async () => {
      const trip = data!.trip;
      const parsedP = (trip.parsed_params ?? {}) as Record<string, unknown>;
      const staging = stagedActivities(data!.items);
      if (staging.length === 0) throw new Error("Add at least one activity first.");

      const booked = (data!.items ?? []).find(isBookedLodging);
      const bookedDetails = (booked?.details ?? {}) as Record<string, unknown>;
      // Undated trips have no real day count; fall back to something modest
      // rather than one day per activity, which would produce a 50-day trip.
      const days = daysBetween(trip.start_date, trip.end_date) || Math.min(staging.length, 7);

      const res = await buildFn({
        data: {
          destination: trip.destination ?? "",
          origin: (parsedP.origin as string) ?? null,
          start_date: trip.start_date,
          end_date: trip.end_date,
          num_days: Math.max(1, days),
          lodging: booked ? ((bookedDetails.location as string) ?? booked.title) : null,
          activities: staging.map((a) => {
            const d = (a.details ?? {}) as Record<string, unknown>;
            const coords = (d.coords ?? null) as { lat: number; lng: number } | null;
            return {
              id: a.id,
              title: a.title,
              category: a.category,
              cost_cents: a.cost_cents ?? 0,
              location: (d.location as string) ?? null,
              duration_hours: (d.duration_hours as number) ?? null,
              preferred_date: (d.preferred_date as string) ?? null,
              lat: coords?.lat ?? null,
              lng: coords?.lng ?? null,
            };
          }),
        },
      });
      if (res.error) throw new Error(res.error);

      const enrichById = new Map(res.enrichments.map((e) => [e.id, e]));
      const detailsById = new Map(
        staging.map((a) => [a.id, (a.details ?? {}) as Record<string, unknown>]),
      );

      // The model returns a wall-clock "HH:MM"; the column is a timestamp, so it
      // only becomes real once combined with that day's actual date.
      const timestampFor = (dayIndex: number, hhmm: string | null): string | null => {
        if (!hhmm || !trip.start_date) return null;
        if (!/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
        const d = new Date(`${trip.start_date}T00:00:00`);
        d.setDate(d.getDate() + dayIndex);
        const [h, m] = hhmm.split(":");
        return `${d.toISOString().slice(0, 10)}T${h.padStart(2, "0")}:${m}:00`;
      };

      const assignedIds = new Set(res.assignments.map((a) => a.id));
      const affectedDays = new Set(res.assignments.map((a) => a.day_index));

      // Minutes-since-midnight, used only to order a day sensibly.
      const minutesOf = (hhmm: string | null): number | null => {
        if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
        const [h, m] = hhmm.split(":").map(Number);
        return h * 60 + m;
      };
      const minutesOfStamp = (ts: string | null): number | null => {
        if (!ts) return null;
        const d = new Date(ts);
        return Number.isNaN(d.getTime()) ? null : d.getHours() * 60 + d.getMinutes();
      };

      // The planner only sees staged activities, so it numbers sort_order from 0
      // and would collide with whatever is already on that day (including the
      // booked stay). Renumber each affected day across ALL its rows, ordered by
      // time where known, so positions stay unique and the day reads correctly.
      type Row = {
        id: string;
        day_index: number;
        minutes: number | null;
        prior: number;
        isNew: boolean;
      };
      const rowsByDay = new Map<number, Row[]>();
      for (const day of affectedDays) rowsByDay.set(day, []);

      for (const a of res.assignments) {
        rowsByDay.get(a.day_index)!.push({
          id: a.id,
          day_index: a.day_index,
          minutes: minutesOf(a.start_time),
          prior: a.sort_order,
          isNew: true,
        });
      }
      for (const item of data!.items) {
        if (assignedIds.has(item.id)) continue;
        if (isLodgingCandidate(item) || isStagedActivity(item)) continue;
        if (item.day_index == null || !affectedDays.has(item.day_index)) continue;
        rowsByDay.get(item.day_index)!.push({
          id: item.id,
          day_index: item.day_index,
          minutes: minutesOfStamp(item.start_time),
          prior: item.sort_order ?? 0,
          isNew: false,
        });
      }

      const finalOrder = new Map<string, number>();
      for (const [, rows] of rowsByDay) {
        rows
          .sort((x, y) => {
            // Timed rows lead, in time order; untimed keep their prior order.
            const mx = x.minutes ?? Number.MAX_SAFE_INTEGER;
            const my = y.minutes ?? Number.MAX_SAFE_INTEGER;
            return mx - my || x.prior - y.prior;
          })
          .forEach((r, i) => finalOrder.set(r.id, i));
      }

      type ItemPatch = {
        id: string;
        day_index?: number;
        sort_order?: number;
        start_time?: string;
        details?: Record<string, unknown>;
      };
      const patches: ItemPatch[] = res.assignments.map((a): ItemPatch => {
        const enrich = enrichById.get(a.id);
        const base = detailsById.get(a.id) ?? {};
        const stamp = timestampFor(a.day_index, a.start_time);
        return {
          id: a.id,
          day_index: a.day_index,
          sort_order: finalOrder.get(a.id) ?? a.sort_order,
          ...(stamp ? { start_time: stamp } : {}),
          details: {
            ...base,
            // Only fill what the activity was missing — never overwrite a
            // location or coords the traveler supplied.
            ...(enrich?.address && !base.location ? { location: enrich.address } : {}),
            ...(enrich?.coords && !base.coords ? { coords: enrich.coords } : {}),
            planner_reason: a.reason,
          },
        };
      });

      // Existing rows only need a patch when their position actually moved.
      for (const [, rows] of rowsByDay) {
        for (const r of rows) {
          if (r.isNew) continue;
          const next = finalOrder.get(r.id);
          if (next != null && next !== r.prior) patches.push({ id: r.id, sort_order: next });
        }
      }

      await updateItemsFn({ data: { patches } });
      return res;
    },
    onSuccess: (res) => {
      invalidate();
      setTab("itinerary");
      const enriched = res.enrichments.length;
      toast.success(
        `Itinerary built — ${res.assignments.length} activities scheduled` +
          (enriched ? `, ${enriched} location${enriched === 1 ? "" : "s"} looked up` : ""),
      );
      if (res.enrichment_error) toast.info(res.enrichment_error);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const reorderMut = useMutation({
    mutationFn: (moves: ItemMove[]) =>
      Promise.all(
        moves.map((m) =>
          updateItemFn({ data: { id: m.id, day_index: m.day_index, sort_order: m.sort_order } }),
        ),
      ),
    onSuccess: invalidate,
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return <div className="p-10 text-muted-foreground">Loading trip…</div>;
  if (error || !data?.trip) throw notFound();

  const { trip, items } = data;
  const parsed = (trip.parsed_params ?? {}) as Partial<ParsedTrip> & {
    entry_mode?: string;
    waypoints?: string[];
    origin_coords?: LatLng | null;
    destination_coords?: LatLng | null;
  };

  const numDays = daysBetween(trip.start_date, trip.end_date);
  // Only a confirmed destination counts — a parsed region stays unset.
  const destination = trip.destination ?? "";
  const origin = parsed.origin ?? "";
  const interests = parsed.interests ?? [];
  const waypoints = parsed.waypoints ?? [];
  const isManualTrip = parsed.entry_mode === "manual";
  const stays = items.filter((i) => i.kind === "lodging");
  const staged = stagedActivities(items);

  const parsedTrip: ParsedTrip = {
    destination: parsed.destination ?? null,
    destination_is_specific: parsed.destination_is_specific ?? false,
    region_hint: parsed.region_hint ?? null,
    origin: parsed.origin ?? null,
    start_date: parsed.start_date ?? null,
    end_date: parsed.end_date ?? null,
    party_size: parsed.party_size ?? null,
    travel_mode: parsed.travel_mode ?? null,
    interests,
    budget_cents: parsed.budget_cents ?? null,
    currency: parsed.currency ?? null,
    notes: parsed.notes ?? null,
    missing_fields: parsed.missing_fields ?? [],
  };

  const handleAdd = (item: Omit<NewItem, "trip_id">) => addMut.mutate({ ...item, trip_id: tripId });

  const updateWaypoints = (next: string[]) =>
    updateMut.mutate({ parsed_params: { ...parsed, waypoints: next } });

  return (
    <div className="flex min-h-screen bg-background max-lg:flex-col">
      <AppSidebar tab={tab} onNavigate={setTab} />

      <main className="min-w-0 flex-1 px-6 py-5">
        <div className="mx-auto max-w-7xl">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <TripMetaBar
              trip={trip}
              items={items}
              onEditBudget={(cents) => updateMut.mutate({ budget_cents: cents })}
            />
            <div className="flex items-center gap-3">
              {trip.user_id === user.id && (
                <Button variant="outline" size="sm" onClick={() => setShareOpen(true)}>
                  <Share2 className="mr-1 h-4 w-4" /> Share
                </Button>
              )}
              <Link
                to="/trips"
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="h-4 w-4" /> All trips
              </Link>
            </div>
          </div>

          <ShareTripDialog tripId={tripId} open={shareOpen} onOpenChange={setShareOpen} />

          <MissingFieldsBanner trip={trip} onSave={(patch) => updateMut.mutate(patch)} />

          {tab === "details" && (
            <TripDetailsPanel
              parsed={parsedTrip}
              destination={destination}
              origin={origin}
              originCoords={parsed.origin_coords ?? null}
              destinationCoords={parsed.destination_coords ?? null}
              startDate={trip.start_date}
              endDate={trip.end_date}
              partySize={trip.party_size ?? 2}
              budgetCents={trip.budget_cents}
              waypoints={waypoints}
              items={items}
              onPick={(name) => updateMut.mutate({ destination: name, title: name })}
              onUpdateWaypoints={updateWaypoints}
            />
          )}

          {tab === "lodging" && (
            <LodgingPanel
              destination={destination}
              origin={origin}
              originCoords={parsed.origin_coords ?? null}
              startDate={trip.start_date}
              endDate={trip.end_date}
              partySize={trip.party_size ?? 2}
              interests={interests}
              budgetCents={trip.budget_cents}
              stays={stays}
              onAdd={(item) => handleAdd(item)}
              onBook={(id) => bookMut.mutate(id)}
              onRemove={(id) => removeMut.mutate(id)}
            />
          )}

          {tab === "transport" && (
            <TransportPanel
              origin={origin}
              destination={destination}
              mode={parsed.travel_mode ?? null}
              partySize={trip.party_size ?? 2}
              startDate={trip.start_date}
              endDate={trip.end_date}
              waypoints={waypoints}
              onAdd={(item) => handleAdd(item)}
            />
          )}

          {tab === "activities" && (
            <ActivitiesPanel
              destination={destination}
              interests={interests}
              startDate={trip.start_date}
              endDate={trip.end_date}
              partySize={trip.party_size ?? 2}
              staged={staged}
              autoBrowse={!isManualTrip}
              onAdd={(item) => handleAdd(item)}
              onRemove={(id) => removeMut.mutate(id)}
              onBuildItinerary={() => buildMut.mutate()}
              building={buildMut.isPending}
            />
          )}

          {tab === "itinerary" && (
            <ItineraryPanel
              items={items}
              numDays={numDays}
              startDate={trip.start_date}
              onAdd={(item) => handleAdd(item)}
              onRemove={(id) => removeMut.mutate(id)}
              onReorder={(moves) => reorderMut.mutate(moves)}
            />
          )}
        </div>
      </main>
    </div>
  );
}
