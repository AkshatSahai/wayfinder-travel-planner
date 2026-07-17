import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { z } from "zod";
import { ChevronLeft } from "lucide-react";

import { getTrip, updateTrip, addTripItem, removeTripItem } from "@/lib/trips.functions";
import { getRecommendations } from "@/lib/trip-ai.functions";
import { daysBetween } from "@/lib/workspace-store";
import { AppSidebar, type WorkspaceTab } from "@/components/shell/app-sidebar";
import { TripMetaBar } from "@/components/shell/trip-meta-bar";

import { DestinationPanel } from "@/components/travel/destination-panel";
import { LodgingPanel } from "@/components/travel/lodging-panel";
import { TransportPanel } from "@/components/travel/transport-panel";
import { ActivitiesPanel } from "@/components/travel/activities-panel";
import { ItineraryPanel } from "@/components/travel/itinerary-panel";
import { BudgetRail } from "@/components/travel/budget-rail";
import { MissingFieldsBanner } from "@/components/travel/missing-fields-banner";

const TABS = ["destination", "lodging", "transport", "activities", "itinerary"] as const;

export const Route = createFileRoute("/_authenticated/trips/$tripId")({
  validateSearch: (s) => z.object({ tab: z.enum(TABS).optional() }).parse(s),
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
  const tab: WorkspaceTab = tabParam ?? "destination";
  const setTab = (t: WorkspaceTab) => navigate({ search: { tab: t }, replace: true });

  const qc = useQueryClient();
  const getFn = useServerFn(getTrip);
  const updateFn = useServerFn(updateTrip);
  const addFn = useServerFn(addTripItem);
  const removeFn = useServerFn(removeTripItem);
  const recFn = useServerFn(getRecommendations);

  const { data, isLoading, error } = useQuery({
    queryKey: ["trip", tripId],
    queryFn: () => getFn({ data: { id: tripId } }),
  });

  const updateMut = useMutation({
    mutationFn: (patch: Record<string, unknown>) => updateFn({ data: { id: tripId, ...patch } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trip", tripId] }),
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trip", tripId] });
      toast.success("Added to itinerary");
    },
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => removeFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trip", tripId] }),
  });

  type RecVars = {
    destination: string;
    start_date: string | null;
    end_date: string | null;
    budget_cents: number | null;
    total_cents: number;
    itemsSummary: string;
  };
  const recMut = useMutation({
    mutationFn: (vars: RecVars) => recFn({ data: vars }),
  });

  if (isLoading) return <div className="p-10 text-muted-foreground">Loading trip…</div>;
  if (error || !data?.trip) throw notFound();

  const { trip, items } = data;
  const parsed = (trip.parsed_params ?? {}) as {
    destination?: string | null;
    origin?: string | null;
    interests?: string[];
    travel_mode?: "car" | "flight" | "train" | "unknown" | null;
    missing_fields?: string[];
    waypoints?: string[];
  };

  const totalCents = items.reduce((s, i) => s + (i.cost_cents ?? 0), 0);
  const numDays = daysBetween(trip.start_date, trip.end_date);
  const destination = trip.destination ?? parsed.destination ?? "";
  const origin = parsed.origin ?? "";
  const interests = parsed.interests ?? [];
  const waypoints = parsed.waypoints ?? [];

  const handleAdd = (item: Omit<NewItem, "trip_id">) => addMut.mutate({ ...item, trip_id: tripId });

  const updateWaypoints = (next: string[]) =>
    updateMut.mutate({ parsed_params: { ...parsed, waypoints: next } });

  const refreshTips = () =>
    recMut.mutate({
      destination,
      start_date: trip.start_date,
      end_date: trip.end_date,
      budget_cents: trip.budget_cents,
      total_cents: totalCents,
      itemsSummary:
        items
          .map(
            (i) =>
              `- [${i.kind}] Day ${i.day_index ?? "?"}: ${i.title} ($${((i.cost_cents ?? 0) / 100).toFixed(0)})`,
          )
          .join("\n") || "(empty)",
    });

  const rail = (
    <BudgetRail
      items={items}
      budgetCents={trip.budget_cents}
      currency={trip.currency}
      onEditBudget={(cents) => updateMut.mutate({ budget_cents: cents })}
      tips={recMut.data?.tips}
      onRefreshTips={refreshTips}
      tipsLoading={recMut.isPending}
    />
  );

  return (
    <div className="flex min-h-screen bg-background max-lg:flex-col">
      <AppSidebar tab={tab} onNavigate={setTab} />

      <main className="min-w-0 flex-1 px-6 py-5">
        <div className="mx-auto max-w-7xl">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <TripMetaBar trip={trip} />
            <Link
              to="/trips"
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" /> All trips
            </Link>
          </div>

          <MissingFieldsBanner trip={trip} onSave={(patch) => updateMut.mutate(patch)} />

          {tab === "destination" ? (
            <DestinationPanel
              parsed={parsed as Parameters<typeof DestinationPanel>[0]["parsed"]}
              current={destination}
              origin={origin}
              waypoints={waypoints}
              onPick={(name) => updateMut.mutate({ destination: name, title: name })}
              onUpdateWaypoints={updateWaypoints}
            />
          ) : (
            <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
              <div className="min-w-0">
                {tab === "lodging" && (
                  <LodgingPanel
                    destination={destination}
                    startDate={trip.start_date}
                    endDate={trip.end_date}
                    partySize={trip.party_size ?? 2}
                    interests={interests}
                    budgetCents={trip.budget_cents}
                    onAdd={(item) => handleAdd(item)}
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
                    numDays={numDays}
                    onAdd={(item) => handleAdd(item)}
                  />
                )}
                {tab === "itinerary" && (
                  <ItineraryPanel
                    items={items}
                    numDays={numDays}
                    startDate={trip.start_date}
                    onAdd={(item) => handleAdd(item)}
                    onRemove={(id) => removeMut.mutate(id)}
                  />
                )}
              </div>
              {rail}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
