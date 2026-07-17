import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Compass, ChevronLeft, MapPin, Bed, Car, Sparkles, CalendarRange } from "lucide-react";

import { getTrip, updateTrip, addTripItem, removeTripItem } from "@/lib/trips.functions";
import { getRecommendations } from "@/lib/trip-ai.functions";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney, daysBetween } from "@/lib/workspace-store";

import { DestinationPanel } from "@/components/travel/destination-panel";
import { LodgingPanel } from "@/components/travel/lodging-panel";
import { TransportPanel } from "@/components/travel/transport-panel";
import { ActivitiesPanel } from "@/components/travel/activities-panel";
import { ItineraryPanel } from "@/components/travel/itinerary-panel";
import { BudgetRail } from "@/components/travel/budget-rail";
import { MissingFieldsBanner } from "@/components/travel/missing-fields-banner";

export const Route = createFileRoute("/_authenticated/trips/$tripId")({
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
  const qc = useQueryClient();
  const getFn = useServerFn(getTrip);
  const updateFn = useServerFn(updateTrip);
  const addFn = useServerFn(addTripItem);
  const removeFn = useServerFn(removeTripItem);
  const recFn = useServerFn(getRecommendations);

  const [tab, setTab] = useState<
    "destination" | "lodging" | "transport" | "activities" | "itinerary"
  >("destination");

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
  };

  const totalCents = items.reduce((s, i) => s + (i.cost_cents ?? 0), 0);
  const numDays = daysBetween(trip.start_date, trip.end_date);
  const destination = trip.destination ?? parsed.destination ?? "";
  const origin = parsed.origin ?? "";
  const interests = parsed.interests ?? [];

  const handleAdd = (item: Omit<NewItem, "trip_id">) => addMut.mutate({ ...item, trip_id: tripId });

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

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-4">
            <Link
              to="/trips"
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" /> Trips
            </Link>
            <Link to="/" className="flex items-center gap-2 font-display text-lg font-semibold">
              <Compass className="h-5 w-5 text-primary" /> Wayfinder
            </Link>
          </div>
          <div className="text-right">
            <h1 className="font-display text-lg font-semibold leading-tight">{trip.title}</h1>
            {destination && (
              <p className="text-xs text-muted-foreground">
                {destination}
                {trip.start_date && ` · ${trip.start_date} → ${trip.end_date}`}
              </p>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-6 py-6 lg:grid-cols-[1fr_320px]">
        <div>
          <MissingFieldsBanner trip={trip} onSave={(patch) => updateMut.mutate(patch)} />

          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="destination">
                <MapPin className="mr-1 h-4 w-4" />
                Destination
              </TabsTrigger>
              <TabsTrigger value="lodging">
                <Bed className="mr-1 h-4 w-4" />
                Lodging
              </TabsTrigger>
              <TabsTrigger value="transport">
                <Car className="mr-1 h-4 w-4" />
                Transport
              </TabsTrigger>
              <TabsTrigger value="activities">
                <Sparkles className="mr-1 h-4 w-4" />
                Activities
              </TabsTrigger>
              <TabsTrigger value="itinerary">
                <CalendarRange className="mr-1 h-4 w-4" />
                Itinerary
              </TabsTrigger>
            </TabsList>

            <TabsContent value="destination" className="mt-4">
              <DestinationPanel
                parsed={parsed as Parameters<typeof DestinationPanel>[0]["parsed"]}
                current={destination}
                origin={origin}
                startDate={trip.start_date}
                endDate={trip.end_date}
                partySize={trip.party_size ?? 2}
                interests={interests}
                travelMode={parsed.travel_mode ?? null}
                onPick={(name) => updateMut.mutate({ destination: name, title: name })}
                onNavigate={(t) => setTab(t)}
              />
            </TabsContent>

            <TabsContent value="lodging" className="mt-4">
              <LodgingPanel
                destination={destination}
                startDate={trip.start_date}
                endDate={trip.end_date}
                partySize={trip.party_size ?? 2}
                interests={interests}
                budgetCents={trip.budget_cents}
                onAdd={(item) => handleAdd(item)}
              />
            </TabsContent>

            <TabsContent value="transport" className="mt-4">
              <TransportPanel
                origin={origin}
                destination={destination}
                mode={parsed.travel_mode ?? null}
                partySize={trip.party_size ?? 2}
                startDate={trip.start_date}
                endDate={trip.end_date}
                onAdd={(item) => handleAdd(item)}
              />
            </TabsContent>

            <TabsContent value="activities" className="mt-4">
              <ActivitiesPanel
                destination={destination}
                interests={interests}
                startDate={trip.start_date}
                endDate={trip.end_date}
                partySize={trip.party_size ?? 2}
                numDays={numDays}
                onAdd={(item) => handleAdd(item)}
              />
            </TabsContent>

            <TabsContent value="itinerary" className="mt-4">
              <ItineraryPanel
                items={items}
                numDays={numDays}
                startDate={trip.start_date}
                onAdd={(item) => handleAdd(item)}
                onRemove={(id) => removeMut.mutate(id)}
              />
            </TabsContent>
          </Tabs>
        </div>

        <BudgetRail
          items={items}
          budgetCents={trip.budget_cents}
          currency={trip.currency}
          onEditBudget={(cents) => updateMut.mutate({ budget_cents: cents })}
          tips={recMut.data?.tips}
          onRefreshTips={refreshTips}
          tipsLoading={recMut.isPending}
        />
      </div>
    </div>
  );
}
