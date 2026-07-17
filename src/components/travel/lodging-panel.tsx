import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { searchLodging } from "@/lib/trip-ai.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProviderSetupCard } from "./provider-setup-card";
import { Plus, ExternalLink, Star, Home, Hotel } from "lucide-react";
import { formatMoney, daysBetween } from "@/lib/workspace-store";

interface Props {
  destination: string;
  startDate: string | null;
  endDate: string | null;
  partySize: number;
  interests: string[];
  budgetCents: number | null;
  onAdd: (item: {
    kind: "lodging";
    title: string;
    subtitle?: string;
    cost_cents: number;
    day_index: number;
    details?: Record<string, unknown>;
    source_url?: string;
  }) => void;
}

export function LodgingPanel({
  destination,
  startDate,
  endDate,
  partySize,
  interests,
  budgetCents,
  onAdd,
}: Props) {
  const fn = useServerFn(searchLodging);
  const nights = Math.max(1, daysBetween(startDate, endDate) - 1);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["lodging", destination, startDate, endDate, partySize],
    queryFn: () =>
      fn({
        data: {
          destination,
          start_date: startDate,
          end_date: endDate,
          party_size: partySize,
          interests,
          budget_cents: budgetCents,
        },
      }),
    enabled: destination.length > 0,
    staleTime: Infinity,
    retry: false,
  });

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [price, setPrice] = useState("");

  if (!destination)
    return (
      <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground">
        Pick a destination first.
      </div>
    );

  const missingKey = data?.error?.includes("TRAVELPAYOUTS_API_KEY missing")
    ? "TRAVELPAYOUTS_API_KEY"
    : null;

  return (
    <div className="space-y-6">
      {/* ---- Primary: manual add (Airbnb / VRBO / anything) ---- */}
      <section
        className="rounded-2xl border border-border bg-card p-5 shadow-soft"
        data-testid="lodging-manual"
      >
        <div className="flex items-center gap-2">
          <Home className="h-5 w-5 text-primary" />
          <h2 className="font-display text-xl font-semibold">Add your stay</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Found a place on Airbnb, VRBO, or anywhere else? Add it here — this is the main way to
          track your stay ({nights} night{nights === 1 ? "" : "s"}).
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1.2fr_1.2fr_120px_auto]">
          <div>
            <Label htmlFor="stay-name">Name</Label>
            <Input
              id="stay-name"
              placeholder="e.g. Lakeview Cottage"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="stay-url">Listing URL (optional)</Label>
            <Input
              id="stay-url"
              placeholder="https://airbnb.com/rooms/…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="stay-price">Total $</Label>
            <Input
              id="stay-price"
              type="number"
              placeholder="900"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button
              className="w-full"
              disabled={!name.trim() || !price}
              onClick={() => {
                onAdd({
                  kind: "lodging",
                  title: name.trim(),
                  subtitle: `Manual · ${nights} night${nights === 1 ? "" : "s"}`,
                  cost_cents: Math.round(Number(price) * 100),
                  day_index: 0,
                  source_url: url.trim() || undefined,
                });
                setName("");
                setUrl("");
                setPrice("");
              }}
            >
              <Plus className="mr-1 h-4 w-4" /> Add stay
            </Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Coming soon: paste a listing link and we'll fill this in automatically.
        </p>
      </section>

      {/* ---- Secondary: live hotel search ---- */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Hotel className="h-5 w-5 text-primary" />
            <div>
              <h3 className="font-display text-lg font-semibold">Hotel search</h3>
              <p className="text-xs text-muted-foreground">
                Live hotel inventory via TravelPayouts.
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? "…" : "Refresh"}
          </Button>
        </div>

        {isLoading && <div className="h-40 animate-pulse rounded-2xl bg-muted/40" />}

        {missingKey && <ProviderSetupCard missingKey={missingKey} />}

        {data?.error && !missingKey && data.listings.length === 0 && !isLoading && (
          <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            <p>Live hotel search is unavailable right now.</p>
            <p className="mt-1 text-xs">{data.error}</p>
            <Button size="sm" variant="outline" className="mt-3" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {data?.listings.map((l) => {
            const total = l.nightly_cents * nights;
            return (
              <div
                key={l.name}
                className="overflow-hidden rounded-2xl border border-border bg-card shadow-card transition-shadow hover:shadow-glow"
              >
                {l.photo_url && (
                  <img
                    src={l.photo_url}
                    alt={l.name}
                    loading="lazy"
                    className="h-40 w-full object-cover"
                  />
                )}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="truncate font-semibold">{l.name}</h4>
                      <p className="text-xs text-muted-foreground">{l.neighborhood}</p>
                    </div>
                    {l.rating != null && (
                      <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-600">
                        <Star className="h-3 w-3 fill-current" />
                        {l.rating}
                      </span>
                    )}
                  </div>
                  <div className="mt-3 flex items-end justify-between">
                    <div>
                      <span className="font-display text-lg font-semibold">
                        {formatMoney(l.nightly_cents)}
                      </span>
                      <span className="text-xs text-muted-foreground"> / night</span>
                      <p className="text-xs text-muted-foreground">{formatMoney(total)} total</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {l.source_url && (
                        <a
                          href={l.source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-muted-foreground hover:text-foreground"
                          title="View listing"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                      <Button
                        size="sm"
                        onClick={() =>
                          onAdd({
                            kind: "lodging",
                            title: l.name,
                            subtitle: `${l.type} · ${l.neighborhood}`,
                            cost_cents: total,
                            day_index: 0,
                            details: { ...l, nights },
                            source_url: l.source_url ?? undefined,
                          })
                        }
                      >
                        <Plus className="mr-1 h-3 w-3" />
                        Add
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
