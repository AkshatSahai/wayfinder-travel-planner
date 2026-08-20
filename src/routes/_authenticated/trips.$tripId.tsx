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
import { useTripRealtime } from "@/hooks/use-trip-realtime";
import { describeActivity } from "@/lib/activity-format";
import { ActivityFeedDialog, ActivityFeedButton } from "@/components/travel/activity-feed-dialog";
import { checkArrivalConflict } from "@/lib/itinerary-advice";
import {
  coordsOf,
  committedItems,
  daysBetween,
  isBookedLodging,
  isStagedActivity,
  minutesFromTimestamp,
  stagedActivities,
  timestampFor,
  LODGING_BOOKED,
  LODGING_CANDIDATE,
  type LatLng,
} from "@/lib/workspace-store";
import { AppSidebar, type WorkspaceTab } from "@/components/shell/app-sidebar";
import { TripMetaBar } from "@/components/shell/trip-meta-bar";

import { TripDetailsPanel } from "@/components/travel/trip-details-panel";
import { LodgingPanel } from "@/components/travel/lodging-panel";
import { ActivitiesPanel } from "@/components/travel/activities-panel";
import { ActivityDetailDialog } from "@/components/travel/activity-detail-dialog";
import { ItineraryPanel, type ItemMove } from "@/components/travel/itinerary-panel";
import { ActivityMapPanel } from "@/components/travel/activity-map-panel";
import { MissingFieldsBanner } from "@/components/travel/missing-fields-banner";
import { ShareTripDialog } from "@/components/travel/share-trip-dialog";
import type { ParsedTrip } from "@/components/travel/destination-picker-dialog";
import type { Tables } from "@/integrations/supabase/types";

type Item = Tables<"trip_items">;

const authRoute = getRouteApi("/_authenticated");

const TABS = ["details", "lodging", "activities", "itinerary"] as const;

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
  const [feedOpen, setFeedOpen] = useState(false);
  const [openActivityId, setOpenActivityId] = useState<string | null>(null);

  const qc = useQueryClient();
  const getFn = useServerFn(getTrip);
  const updateFn = useServerFn(updateTrip);
  const addFn = useServerFn(addTripItem);
  const removeFn = useServerFn(removeTripItem);
  const updateItemFn = useServerFn(updateTripItem);
  const updateItemsFn = useServerFn(updateTripItems);

  const { data, isLoading, error } = useQuery({
    queryKey: ["trip", tripId],
    queryFn: () => getFn({ data: { id: tripId } }),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["trip", tripId] });

  // Live sync + collaborator notifications. Everything funnels through the same
  // invalidate() chokepoint the mutations already use — realtime is a new
  // *trigger* for refreshing, not a second way of doing it.
  useTripRealtime({
    tripId,
    onTripChanged: invalidate,
    onActivity: (row) => {
      // Never tell someone about their own edit. This is the whole reason
      // notifications read trip_activity rather than trip_items: an item row's
      // user_id is creator provenance, so it cannot say who made *this* change.
      if (row.actor_id === user.id) return;
      qc.invalidateQueries({ queryKey: ["trip-activity", tripId] });
      toast(describeActivity(row), { duration: 6000 });
    },
  });

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
    mutationFn: (item: NewItem) =>
      addFn({
        data: {
          ...item,
          activity: {
            trip_id: tripId,
            action: "added" as const,
            item_type: item.kind,
            item_name: item.title,
          },
        },
      }),
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
    mutationFn: (id: string) =>
      removeFn({
        data: {
          id,
          activity: {
            trip_id: tripId,
            action: "removed" as const,
            item_type: data?.items.find((i) => i.id === id)?.kind ?? null,
            // Capture the title before the row is gone — the feed entry has to
            // outlive the thing it describes.
            item_name: data?.items.find((i) => i.id === id)?.title ?? null,
          },
        },
      }),
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

  const reorderMut = useMutation({
    // Batched so the whole drag logs ONE activity entry rather than one per
    // shifted row — a five-row day would otherwise fire five notifications.
    mutationFn: (payload: { moves: ItemMove[]; movedTitle: string | null }) =>
      updateItemsFn({
        data: {
          patches: payload.moves.map((m) => ({
            id: m.id,
            day_index: m.day_index,
            sort_order: m.sort_order,
          })),
          activity: {
            trip_id: tripId,
            action: "moved" as const,
            item_type: "itinerary",
            item_name: payload.movedTitle,
          },
        },
      }),
    onSuccess: invalidate,
    onError: (err: Error) => toast.error(err.message),
  });

  /**
   * "Remove from itinerary" for an activity: unschedule it (day_index -> null)
   * rather than delete it, so it returns to the staged list on the Activities
   * tab exactly like it started. Deleting an activity for good is still only
   * available from the Activities tab, which is the trip's master list.
   */
  const unscheduleMut = useMutation({
    mutationFn: (item: Item) =>
      updateItemFn({ data: { id: item.id, day_index: null, sort_order: 0 } }),
    onSuccess: () => {
      invalidate();
      toast.success("Moved back to your activities list");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  /**
   * Pin a single activity's arrival time — the only write path for
   * `start_time`. Sequence still comes from drag order alone; a pinned time is
   * metadata plus a conflict check, and never moves the item.
   *
   * `checkArrivalConflict` is a pure local heuristic — no network call, no
   * model. It is what's left of the advisory machinery this screen used to
   * carry, kept because it answers a question the traveler actually asked by
   * pinning a time.
   */
  const pinTimeMut = useMutation({
    mutationFn: async (payload: { item: Item; hhmm: string | null }) => {
      const trip = data!.trip;
      const stamp = timestampFor(trip.start_date, payload.item.day_index ?? 0, payload.hhmm);
      await updateItemFn({ data: { id: payload.item.id, start_time: stamp } });
      return { item: payload.item, stamp };
    },
    onSuccess: ({ item, stamp }) => {
      invalidate();
      if (!stamp || item.day_index == null) return;

      const dayItems = committedItems(data!.items)
        .filter((i) => i.day_index === item.day_index)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((i) => {
          const d = (i.details ?? {}) as Record<string, unknown>;
          return {
            id: i.id,
            title: i.title,
            minutes:
              i.id === item.id ? minutesFromTimestamp(stamp) : minutesFromTimestamp(i.start_time),
            duration_hours: (d.duration_hours as number) ?? null,
            coords: coordsOf(d),
          };
        });

      const pinnedMinutes = minutesFromTimestamp(stamp);
      if (pinnedMinutes == null) return;
      const result = checkArrivalConflict(dayItems, item.id, pinnedMinutes);
      // Surfaced as a toast rather than an inline pill: it answers the pin the
      // traveler just made, so it belongs with that action, not parked in the
      // day column. The pill it used to share with the drag advisor is gone.
      if (result.conflict && result.detail) toast.warning(result.detail, { duration: 8000 });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const editItemMut = useMutation({
    mutationFn: (payload: { id: string; patch: Record<string, unknown> }) =>
      updateItemFn({ data: { id: payload.id, ...payload.patch } }),
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
  // The Activities tab is the master list — scheduled rows included, labelled
  // with their day — so anything the itinerary chat adds is visible on both
  // tabs. `stagedActivities` still drives what "Build out itinerary" acts on.
  const allActivities = items.filter((i) => i.kind === "activity");
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
              <ActivityFeedButton onClick={() => setFeedOpen(true)} />
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
          <ActivityFeedDialog tripId={tripId} open={feedOpen} onOpenChange={setFeedOpen} />

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

          {tab === "activities" && (
            <ActivitiesPanel
              tripId={tripId}
              destination={destination}
              interests={interests}
              startDate={trip.start_date}
              endDate={trip.end_date}
              partySize={trip.party_size ?? 2}
              activities={allActivities}
              lodging={items.find(isBookedLodging) ?? null}
              unscheduledCount={staged.length}
              autoBrowse={!isManualTrip}
              onAdd={(item) => handleAdd(item)}
              onRemove={(id) => removeMut.mutate(id)}
              onOpenActivity={(id) => setOpenActivityId(id)}
            />
          )}

          {tab === "itinerary" && (
            <ItineraryPanel
              tripId={tripId}
              items={items}
              numDays={numDays}
              startDate={trip.start_date}
              onPinTime={(item, hhmm) => pinTimeMut.mutate({ item, hhmm })}
              renderMapPanel={() => (
                // Every activity, not the selected day's — the map is a
                // reference for the whole trip. `items.find(isBookedLodging)`
                // rather than any lodging row: candidates are still under
                // comparison and shouldn't anchor distances.
                <ActivityMapPanel
                  tripId={tripId}
                  activities={allActivities}
                  lodging={items.find(isBookedLodging) ?? null}
                />
              )}
              onAdd={(item) => handleAdd(item)}
              onRemove={(item) =>
                item.kind === "activity" ? unscheduleMut.mutate(item) : removeMut.mutate(item.id)
              }
              onReorder={(moves, moved) =>
                reorderMut.mutate({
                  moves,
                  movedTitle: moved ? (items.find((i) => i.id === moved.id)?.title ?? null) : null,
                })
              }
              onOpenActivity={(id) => setOpenActivityId(id)}
            />
          )}
        </div>
      </main>

      <ActivityDetailDialog
        item={items.find((i) => i.id === openActivityId) ?? null}
        destination={destination}
        startDate={trip.start_date}
        endDate={trip.end_date}
        onClose={() => setOpenActivityId(null)}
        onSave={(id, patch) => editItemMut.mutate({ id, patch })}
      />
    </div>
  );
}
