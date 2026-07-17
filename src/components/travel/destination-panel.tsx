import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { suggestDestinations, searchTransport, searchLodging } from "@/lib/trip-ai.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney, daysBetween } from "@/lib/workspace-store";
import {
  Sparkles,
  Check,
  MapPin,
  CalendarRange,
  Users,
  Car,
  Plane,
  TrainFront,
  Bed,
  ArrowRight,
  AlertCircle,
  Pencil,
} from "lucide-react";

type Parsed = {
  destination: string | null;
  region_hint: string | null;
  origin?: string | null;
  start_date: string | null;
  end_date: string | null;
  party_size: number | null;
  travel_mode: "car" | "flight" | "train" | "unknown" | null;
  interests: string[];
  budget_cents: number | null;
  currency: string | null;
  notes: string | null;
  missing_fields: string[];
};

interface Props {
  parsed: Parsed;
  current: string;
  origin: string;
  startDate: string | null;
  endDate: string | null;
  partySize: number;
  interests: string[];
  travelMode: "car" | "flight" | "train" | "unknown" | null;
  onPick: (name: string) => void;
  onNavigate: (tab: "lodging" | "transport" | "activities" | "itinerary") => void;
}

export function DestinationPanel(props: Props) {
  const [showPicker, setShowPicker] = useState(false);
  if (!props.current || showPicker) {
    return (
      <DestinationPicker
        {...props}
        onPick={(name) => {
          props.onPick(name);
          setShowPicker(false);
        }}
        onCancel={props.current ? () => setShowPicker(false) : undefined}
      />
    );
  }
  return <DestinationOverview {...props} onChangeDestination={() => setShowPicker(true)} />;
}

// ---------- Picker ----------

function DestinationPicker({
  parsed,
  current,
  onPick,
  onCancel,
}: Props & { onCancel?: () => void }) {
  const fn = useServerFn(suggestDestinations);
  const [manual, setManual] = useState("");
  // Normalize so trips saved before schema changes still validate server-side.
  const normalized = {
    destination: parsed.destination ?? null,
    region_hint: parsed.region_hint ?? null,
    origin: parsed.origin ?? null,
    start_date: parsed.start_date ?? null,
    end_date: parsed.end_date ?? null,
    party_size: parsed.party_size ?? null,
    travel_mode: parsed.travel_mode ?? null,
    interests: parsed.interests ?? [],
    budget_cents: parsed.budget_cents ?? null,
    currency: parsed.currency ?? null,
    notes: parsed.notes ?? null,
    missing_fields: parsed.missing_fields ?? [],
  };
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: [
      "destinations",
      normalized.destination,
      normalized.region_hint,
      normalized.interests.join(","),
    ],
    queryFn: () => fn({ data: { parsed: normalized } }),
    staleTime: Infinity,
    retry: false,
  });

  const empty = !isLoading && !isError && (data?.destinations.length ?? 0) === 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-xl font-semibold">Pick your area</h2>
          <p className="text-sm text-muted-foreground">
            Ranked to your interests. Tap to lock it in.
          </p>
        </div>
        <div className="flex gap-2">
          {onCancel && (
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <Sparkles className="mr-1 h-4 w-4" /> {isFetching ? "…" : "Re-curate"}
          </Button>
        </div>
      </div>

      {(isLoading || isFetching) && <SkeletonList />}

      {(isError || empty) && !isFetching && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 p-6 text-center">
          <AlertCircle className="mx-auto h-5 w-5 text-warning-foreground" />
          <p className="mt-2 text-sm font-medium">
            {isError ? "Destination suggestions failed" : "No suggestions came back"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {isError
              ? error instanceof Error
                ? error.message
                : "The AI service returned an error."
              : "Try again, or type your destination below."}
          </p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {data?.destinations.map((d) => {
          const isCurrent = current === d.name;
          return (
            <button
              key={d.name}
              onClick={() => onPick(d.name)}
              className={`group rounded-xl border p-4 text-left shadow-soft transition-all hover:shadow-glow ${isCurrent ? "border-primary bg-primary/5" : "border-border bg-card"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-display text-lg font-semibold">{d.name}</h3>
                  <p className="text-xs text-muted-foreground">{d.region}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    {d.match_score}
                  </span>
                  {isCurrent && <Check className="h-4 w-4 text-primary" />}
                </div>
              </div>
              <p className="mt-2 text-sm italic text-muted-foreground">"{d.hero_tagline}"</p>
              <p className="mt-2 text-sm">{d.rationale}</p>
              <div className="mt-3 flex flex-wrap gap-1">
                {d.best_for.map((b) => (
                  <span key={b} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                    {b}
                  </span>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      <div className="rounded-xl border border-dashed border-border p-4">
        <p className="mb-2 text-sm font-medium">Or type your destination</p>
        <div className="flex gap-2">
          <Input
            placeholder="e.g. Traverse City, MI"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && manual.trim()) onPick(manual.trim());
            }}
          />
          <Button disabled={!manual.trim()} onClick={() => onPick(manual.trim())}>
            Use it
          </Button>
        </div>
      </div>
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-40 animate-pulse rounded-xl border border-border bg-muted/40" />
      ))}
    </div>
  );
}

// ---------- Overview dashboard ----------

function DestinationOverview({
  current,
  origin,
  startDate,
  endDate,
  partySize,
  interests,
  travelMode,
  onNavigate,
  onChangeDestination,
}: Props & { onChangeDestination: () => void }) {
  const transportFn = useServerFn(searchTransport);
  const lodgingFn = useServerFn(searchLodging);
  const nights = Math.max(1, daysBetween(startDate, endDate) - 1);

  // Same query keys as the Transport / Lodging tabs so each search runs once.
  const transportQ = useQuery({
    queryKey: ["transport", origin, current, travelMode, "28", "3.5"],
    queryFn: () =>
      transportFn({
        data: {
          origin,
          destination: current,
          mode: travelMode,
          party_size: partySize,
          start_date: startDate,
          end_date: endDate,
          mpg: 28,
          fuel_price_per_gallon: 3.5,
        },
      }),
    enabled: origin.length > 0 && current.length > 0,
    staleTime: Infinity,
    retry: false,
  });

  const lodgingQ = useQuery({
    queryKey: ["lodging", current, startDate, endDate, partySize],
    queryFn: () =>
      lodgingFn({
        data: {
          destination: current,
          start_date: startDate,
          end_date: endDate,
          party_size: partySize,
          interests,
          budget_cents: null,
        },
      }),
    enabled: current.length > 0,
    staleTime: Infinity,
    retry: false,
  });

  const cheapest = (mode: "car" | "flight") => {
    const opts = (transportQ.data?.options ?? []).filter((o) => o.mode === mode);
    if (opts.length === 0) return null;
    return opts.reduce((min, o) => (o.est_cost_cents < min.est_cost_cents ? o : min));
  };
  const car = cheapest("car");
  const flight = cheapest("flight");

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-primary" />
              <h2 className="font-display text-2xl font-semibold">{current}</h2>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {startDate && endDate && (
                <span className="flex items-center gap-1">
                  <CalendarRange className="h-4 w-4" />
                  {startDate} → {endDate} · {nights} night{nights === 1 ? "" : "s"}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Users className="h-4 w-4" />
                {partySize} traveler{partySize === 1 ? "" : "s"}
              </span>
              {origin && (
                <span className="flex items-center gap-1">
                  <Car className="h-4 w-4" />
                  from {origin}
                </span>
              )}
            </div>
            {interests.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {interests.map((i) => (
                  <span key={i} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                    {i}
                  </span>
                ))}
              </div>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={onChangeDestination}>
            <Pencil className="mr-1 h-3 w-3" /> Change destination
          </Button>
        </div>
      </div>

      <div>
        <h3 className="mb-2 font-display text-lg font-semibold">Getting there at a glance</h3>
        {!origin && (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Add where you're leaving from (banner above) to compare live transport prices.
          </div>
        )}
        {origin && (
          <div className="grid gap-3 sm:grid-cols-3">
            <GlanceCard
              icon={<Car className="h-5 w-5" />}
              title="Car"
              loading={transportQ.isLoading}
              price={car ? car.est_cost_cents : null}
              caption={car ? car.details : "No driving route found"}
              onClick={() => onNavigate("transport")}
            />
            <GlanceCard
              icon={<Plane className="h-5 w-5" />}
              title="Flight"
              loading={transportQ.isLoading}
              price={flight ? flight.est_cost_cents : null}
              caption={
                flight
                  ? flight.label
                  : transportQ.data?.missing_key
                    ? "Connect Duffel for live fares"
                    : "No live offers"
              }
              onClick={() => onNavigate("transport")}
            />
            <GlanceCard
              icon={<TrainFront className="h-5 w-5" />}
              title="Train"
              loading={false}
              price={null}
              caption="No live pricing source — check Amtrak"
              onClick={() => onNavigate("transport")}
            />
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold">Places to stay</h3>
          <Button variant="ghost" size="sm" onClick={() => onNavigate("lodging")}>
            All lodging <ArrowRight className="ml-1 h-3 w-3" />
          </Button>
        </div>
        {lodgingQ.isLoading && <div className="h-32 animate-pulse rounded-xl bg-muted/40" />}
        {lodgingQ.data?.error && lodgingQ.data.listings.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {lodgingQ.data.error}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          {lodgingQ.data?.listings.slice(0, 3).map((l) => (
            <button
              key={l.name}
              onClick={() => onNavigate("lodging")}
              className="overflow-hidden rounded-xl border border-border bg-card text-left shadow-soft transition-all hover:shadow-glow"
            >
              {l.photo_url && (
                <img
                  src={l.photo_url}
                  alt={l.name}
                  loading="lazy"
                  className="h-28 w-full object-cover"
                />
              )}
              <div className="p-3">
                <p className="flex items-center gap-1 text-sm font-semibold">
                  <Bed className="h-3 w-3 text-primary" />
                  {l.name}
                </p>
                <p className="text-xs text-muted-foreground">{l.neighborhood}</p>
                <p className="mt-1 text-sm font-medium">
                  {formatMoney(l.nightly_cents)}
                  <span className="text-xs text-muted-foreground"> / night</span>
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => onNavigate("activities")}>
          Browse activities & events <ArrowRight className="ml-1 h-3 w-3" />
        </Button>
        <Button variant="outline" onClick={() => onNavigate("itinerary")}>
          Open itinerary <ArrowRight className="ml-1 h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

function GlanceCard({
  icon,
  title,
  loading,
  price,
  caption,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  loading: boolean;
  price: number | null;
  caption: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-xl border border-border bg-card p-4 text-left shadow-soft transition-all hover:shadow-glow"
    >
      <div className="flex items-center gap-2 text-primary">
        {icon}
        <span className="font-medium text-foreground">{title}</span>
      </div>
      {loading ? (
        <div className="mt-2 h-6 w-20 animate-pulse rounded bg-muted/60" />
      ) : (
        <div className="mt-2 font-display text-xl font-semibold">
          {price != null ? formatMoney(price) : "—"}
        </div>
      )}
      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{caption}</p>
    </button>
  );
}
