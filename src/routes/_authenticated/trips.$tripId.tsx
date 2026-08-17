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
} from "@/lib/trips.functions";
import {
  daysBetween,
  isBookedLodging,
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
              onBuildItinerary={() =>
                toast.info("AI itinerary building lands next — your activities are saved.")
              }
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
