import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { searchTransport } from "@/lib/trip-ai.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Info, Fuel, Car, Plane, TrainFront } from "lucide-react";
import { formatMoney } from "@/lib/workspace-store";
import { ProviderSetupCard } from "./provider-setup-card";

interface Props {
  origin: string;
  destination: string;
  mode: "car" | "flight" | "train" | "unknown" | null;
  partySize: number;
  startDate: string | null;
  endDate: string | null;
  waypoints: string[];
  onAdd: (item: {
    kind: "transport";
    title: string;
    subtitle?: string;
    cost_cents: number;
    day_index: number;
    details?: Record<string, unknown>;
  }) => void;
}

export function TransportPanel({
  origin: initialOrigin,
  destination,
  mode,
  partySize,
  startDate,
  endDate,
  waypoints,
  onAdd,
}: Props) {
  const fn = useServerFn(searchTransport);
  const [origin, setOrigin] = useState(initialOrigin);
  const [mpg, setMpg] = useState("28");
  const [gasOverride, setGasOverride] = useState("");

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["transport", origin, destination, mode, mpg, gasOverride, waypoints.join("|")],
    queryFn: () =>
      fn({
        data: {
          origin,
          destination,
          mode,
          party_size: partySize,
          start_date: startDate,
          end_date: endDate,
          mpg: Number(mpg) || 28,
          fuel_price_per_gallon: gasOverride ? Number(gasOverride) : null,
          waypoints,
        },
      }),
    enabled: origin.length > 0 && destination.length > 0,
    staleTime: Infinity,
    retry: false,
  });

  if (!destination)
    return (
      <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground">
        Pick a destination first.
      </div>
    );

  const options = data?.options ?? [];
  const drive = options.filter((o) => o.mode === "car");
  const flights = options.filter((o) => o.mode === "flight");
  const cheapest = (list: typeof options) =>
    list.length ? list.reduce((m, o) => (o.est_cost_cents < m.est_cost_cents ? o : m)) : null;
  const bestDrive = cheapest(drive);
  const bestFlight = cheapest(flights);
  const busy = isLoading || isFetching;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl font-semibold">Getting there</h2>
        <p className="text-sm text-muted-foreground">
          Compare driving, flying, and rail — live routes, fares, and gas prices.
        </p>
      </div>

      <div className="grid gap-3 rounded-2xl border border-border bg-card p-4 shadow-soft sm:grid-cols-[1fr_110px_130px_auto]">
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
          <Label htmlFor="gas">$ / gal override</Label>
          <Input
            id="gas"
            type="number"
            step="0.01"
            placeholder="live price"
            value={gasOverride}
            onChange={(e) => setGasOverride(e.target.value)}
          />
        </div>
        <div className="flex items-end">
          <Button className="w-full" disabled={!origin || busy} onClick={() => refetch()}>
            {busy ? "Searching…" : "Search"}
          </Button>
        </div>
      </div>

      {!origin && (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Enter where you're leaving from to compare live prices.
        </div>
      )}

      {/* ---- Three-way comparison ---- */}
      {origin && (
        <div className="grid gap-3 sm:grid-cols-3" data-testid="transport-comparison">
          <CompareCard
            icon={<Car className="h-5 w-5" />}
            title="Drive"
            loading={busy}
            price={bestDrive?.est_cost_cents ?? null}
            caption={
              bestDrive
                ? `${bestDrive.details}${waypoints.length ? "" : ""}`
                : "No driving route found"
            }
          />
          <CompareCard
            icon={<Plane className="h-5 w-5" />}
            title="Fly"
            loading={busy}
            price={bestFlight?.est_cost_cents ?? null}
            caption={
              bestFlight
                ? `${bestFlight.label}${bestFlight.fare_brand ? ` · ${bestFlight.fare_brand}` : ""}`
                : data?.missing_key
                  ? "Connect Duffel for live fares"
                  : "No live offers"
            }
          />
          <CompareCard
            icon={<TrainFront className="h-5 w-5" />}
            title="Train"
            loading={false}
            price={null}
            caption="Add fares you find below"
          />
        </div>
      )}

      {data?.missing_key && <ProviderSetupCard missingKey={data.missing_key} />}

      {data?.ai_advice && (
        <div className="flex gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-sm">{data.ai_advice}</p>
        </div>
      )}

      {data?.errors && data.errors.length > 0 && (
        <div className="rounded-2xl border border-dashed border-border p-3 text-xs text-muted-foreground">
          {data.errors.map((e, i) => (
            <div key={i}>· {e}</div>
          ))}
        </div>
      )}

      {/* ---- Detailed options ---- */}
      <div className="grid gap-3">
        {options.map((o, idx) => (
          <div key={idx} className="rounded-2xl border border-border bg-card p-4 shadow-soft">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-xs uppercase">
                    {o.mode}
                  </span>
                  <h3 className="font-semibold">{o.label}</h3>
                  {o.mode === "flight" && (
                    <>
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs capitalize text-primary">
                        {o.fare_brand ?? o.cabin ?? "economy"}
                      </span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                        {o.stops === 0 ? "nonstop" : `${o.stops} stop${o.stops === 1 ? "" : "s"}`}
                      </span>
                    </>
                  )}
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

      {/* ---- Train: manual add ---- */}
      <TrainManualAdd onAdd={onAdd} />
    </div>
  );
}

function CompareCard({
  icon,
  title,
  loading,
  price,
  caption,
}: {
  icon: React.ReactNode;
  title: string;
  loading: boolean;
  price: number | null;
  caption: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
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
    </div>
  );
}

function TrainManualAdd({ onAdd }: { onAdd: Props["onAdd"] }) {
  const [route, setRoute] = useState("");
  const [price, setPrice] = useState("");
  const [depart, setDepart] = useState("");
  const [arrive, setArrive] = useState("");

  return (
    <section
      className="rounded-2xl border border-border bg-card p-5 shadow-soft"
      data-testid="train-manual"
    >
      <div className="flex items-center gap-2">
        <TrainFront className="h-5 w-5 text-primary" />
        <h3 className="font-display text-lg font-semibold">Add a train</h3>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        US rail has no public pricing API — check{" "}
        <a
          href="https://www.amtrak.com"
          target="_blank"
          rel="noreferrer"
          className="text-primary hover:underline"
        >
          amtrak.com
        </a>{" "}
        and add what you find.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-[1.4fr_100px_1fr_1fr_auto]">
        <div>
          <Label htmlFor="train-route">Route / train</Label>
          <Input
            id="train-route"
            placeholder="e.g. Amtrak Wolverine 352"
            value={route}
            onChange={(e) => setRoute(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="train-price">Total $</Label>
          <Input
            id="train-price"
            type="number"
            placeholder="120"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="train-depart">Departs</Label>
          <Input
            id="train-depart"
            placeholder="e.g. 8:15 AM"
            value={depart}
            onChange={(e) => setDepart(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="train-arrive">Arrives</Label>
          <Input
            id="train-arrive"
            placeholder="e.g. 1:40 PM"
            value={arrive}
            onChange={(e) => setArrive(e.target.value)}
          />
        </div>
        <div className="flex items-end">
          <Button
            className="w-full"
            disabled={!route.trim() || !price}
            onClick={() => {
              onAdd({
                kind: "transport",
                title: `TRAIN: ${route.trim()}`,
                subtitle: [depart && `Departs ${depart}`, arrive && `arrives ${arrive}`]
                  .filter(Boolean)
                  .join(" · "),
                cost_cents: Math.round(Number(price) * 100),
                day_index: 0,
              });
              setRoute("");
              setPrice("");
              setDepart("");
              setArrive("");
            }}
          >
            <Plus className="mr-1 h-4 w-4" /> Add
          </Button>
        </div>
      </div>
    </section>
  );
}
