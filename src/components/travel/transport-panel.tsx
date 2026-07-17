import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { searchTransport } from "@/lib/trip-ai.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Info, Fuel, Car, Plane, TrainFront, ExternalLink, LayoutGrid } from "lucide-react";
import { formatMoney } from "@/lib/workspace-store";
import { ProviderSetupCard } from "./provider-setup-card";

interface Props {
  origin: string;
  destination: string;
  mode: "car" | "flight" | "train" | "unknown" | null;
  partySize: number;
  startDate: string | null;
  endDate: string | null;
  onAdd: (item: {
    kind: "transport";
    title: string;
    subtitle?: string;
    cost_cents: number;
    day_index: number;
    details?: Record<string, unknown>;
  }) => void;
}

type ModeFilter = "all" | "car" | "flight" | "train";

const MODE_TABS: { value: ModeFilter; label: string; icon: React.ReactNode }[] = [
  { value: "all", label: "All", icon: <LayoutGrid className="h-3 w-3" /> },
  { value: "car", label: "Car", icon: <Car className="h-3 w-3" /> },
  { value: "flight", label: "Flight", icon: <Plane className="h-3 w-3" /> },
  { value: "train", label: "Train", icon: <TrainFront className="h-3 w-3" /> },
];

export function TransportPanel({
  origin: initialOrigin,
  destination,
  mode,
  partySize,
  startDate,
  endDate,
  onAdd,
}: Props) {
  const fn = useServerFn(searchTransport);
  const [origin, setOrigin] = useState(initialOrigin);
  const [mpg, setMpg] = useState("28");
  const [gasPrice, setGasPrice] = useState("3.5");
  const [modeFilter, setModeFilter] = useState<ModeFilter>("all");

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["transport", origin, destination, mode, mpg, gasPrice],
    queryFn: () =>
      fn({
        data: {
          origin,
          destination,
          mode,
          party_size: partySize,
          start_date: startDate,
          end_date: endDate,
          mpg: Number(mpg),
          fuel_price_per_gallon: Number(gasPrice),
        },
      }),
    enabled: origin.length > 0 && destination.length > 0,
    staleTime: Infinity,
  });

  if (!destination)
    return (
      <div className="rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground">
        Pick a destination first.
      </div>
    );

  const filtered = (data?.options ?? []).filter(
    (o) => modeFilter === "all" || o.mode === modeFilter,
  );
  const showTrainNotice = modeFilter === "all" || modeFilter === "train";

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-xl font-semibold">Getting there</h2>
        <p className="text-sm text-muted-foreground">
          Live flight offers from Duffel · real driving route from OSRM.
        </p>
      </div>

      <div className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-[1fr_120px_120px_auto]">
        <div>
          <Label htmlFor="origin">From</Label>
          <Input
            id="origin"
            placeholder="e.g. Chicago, IL"
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="mpg">MPG</Label>
          <Input id="mpg" type="number" value={mpg} onChange={(e) => setMpg(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="gas">$ / gal</Label>
          <Input
            id="gas"
            type="number"
            step="0.01"
            value={gasPrice}
            onChange={(e) => setGasPrice(e.target.value)}
          />
        </div>
        <div className="flex items-end">
          <Button className="w-full" disabled={!origin || isFetching} onClick={() => refetch()}>
            {isFetching ? "Searching…" : "Search"}
          </Button>
        </div>
      </div>

      {!origin && (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Enter where you're leaving from to compare live prices.
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {MODE_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setModeFilter(t.value)}
            className={`flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition-colors ${modeFilter === t.value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary"}`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {(isLoading || isFetching) && origin && (
        <div className="h-32 animate-pulse rounded-xl bg-muted/40" />
      )}

      {data?.missing_key && <ProviderSetupCard missingKey={data.missing_key} />}

      {data?.ai_advice && (
        <div className="flex gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-sm">{data.ai_advice}</p>
        </div>
      )}

      {data?.errors && data.errors.length > 0 && (
        <div className="rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
          {data.errors.map((e, i) => (
            <div key={i}>· {e}</div>
          ))}
        </div>
      )}

      {data && !isLoading && !isFetching && filtered.length === 0 && modeFilter !== "train" && (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No live {modeFilter === "all" ? "" : `${modeFilter} `}results. Try adjusting dates,
          destination, or origin.
        </div>
      )}

      <div className="grid gap-3">
        {filtered.map((o, idx) => (
          <div key={idx} className="rounded-xl border border-border bg-card p-4 shadow-soft">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-xs uppercase">
                    {o.mode}
                  </span>
                  <h3 className="font-semibold">{o.label}</h3>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${o.source === "duffel" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
                  >
                    {o.source === "duffel" ? "Duffel · live" : "OSRM route"}
                  </span>
                </div>
                <p className="mt-1 text-sm">{o.details}</p>
                {o.notes && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <Fuel className="h-3 w-3" />
                    {o.notes}
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">~{o.est_duration_hours}h</p>
              </div>
              <div className="text-right">
                <div className="font-display text-lg font-semibold">
                  {formatMoney(o.est_cost_cents)}
                </div>
                <Button
                  size="sm"
                  className="mt-2"
                  onClick={() =>
                    onAdd({
                      kind: "transport",
                      title: `${o.mode.toUpperCase()}: ${o.label}`,
                      subtitle: o.details,
                      cost_cents: o.est_cost_cents,
                      day_index: 0,
                      details: o,
                    })
                  }
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Add
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {showTrainNotice && (
        <div className="rounded-xl border border-dashed border-border p-4">
          <div className="flex items-start gap-3">
            <TrainFront className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="text-sm">
              <p className="font-medium">Train prices aren't available live</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Amtrak doesn't offer a public pricing API, and we only show real prices — check
                fares directly and add the cost manually from the Itinerary tab.
              </p>
              <a
                href={`https://www.amtrak.com/tickets/departure.html`}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Check Amtrak fares <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
