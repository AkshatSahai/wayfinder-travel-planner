import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { searchLodging } from "@/lib/trip-ai.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Link as LinkIcon, ExternalLink, Star } from "lucide-react";
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

  const [manualUrl, setManualUrl] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualCost, setManualCost] = useState("");

  if (!destination) return <EmptyState message="Pick a destination first." />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-xl font-semibold">Where you'll stay</h2>
          <p className="text-sm text-muted-foreground">{nights} nights · live from TravelPayouts</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? "…" : "Refresh"}
        </Button>
      </div>

      {isLoading && <div className="h-40 animate-pulse rounded-xl bg-muted/40" />}

      {data?.error && !isLoading && data.listings.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {data.error}
        </div>
      )}

      <div className="grid gap-3">
        {data?.listings.map((l) => {
          const total = l.nightly_cents * nights;
          return (
            <div
              key={l.name}
              className="overflow-hidden rounded-xl border border-border bg-card shadow-soft"
            >
              <div className="flex flex-col sm:flex-row">
                {l.photo_url && (
                  <img
                    src={l.photo_url}
                    alt={l.name}
                    loading="lazy"
                    className="h-40 w-full object-cover sm:h-auto sm:w-48"
                  />
                )}
                <div className="flex flex-1 items-start justify-between gap-3 p-4">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">{l.name}</h3>
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">
                        {l.type}
                      </span>
                      {l.rating != null && (
                        <span className="flex items-center gap-0.5 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-600 dark:text-amber-400">
                          <Star className="h-3 w-3 fill-current" />
                          {l.rating}
                        </span>
                      )}
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-primary">
                        TravelPayouts
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">{l.neighborhood}</p>
                    <p className="mt-2 text-sm">{l.rationale}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {l.amenities.slice(0, 6).map((a) => (
                        <span key={a} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                          {a}
                        </span>
                      ))}
                    </div>
                    {l.source_url && (
                      <a
                        href={l.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        View on Hotellook <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="font-display text-lg font-semibold">
                      {formatMoney(l.nightly_cents)}
                    </div>
                    <div className="text-xs text-muted-foreground">/ night</div>
                    <div className="mt-1 text-xs">Total {formatMoney(total)}</div>
                    <Button
                      size="sm"
                      className="mt-2"
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

      <div className="rounded-xl border border-dashed border-border p-4">
        <p className="mb-2 flex items-center gap-2 text-sm font-medium">
          <LinkIcon className="h-4 w-4" />
          Have your own listing?
        </p>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_100px_auto]">
          <Input
            placeholder="Name"
            value={manualName}
            onChange={(e) => setManualName(e.target.value)}
          />
          <Input
            placeholder="URL (optional)"
            value={manualUrl}
            onChange={(e) => setManualUrl(e.target.value)}
          />
          <Input
            placeholder="Total $"
            type="number"
            value={manualCost}
            onChange={(e) => setManualCost(e.target.value)}
          />
          <Button
            size="sm"
            disabled={!manualName || !manualCost}
            onClick={() => {
              onAdd({
                kind: "lodging",
                title: manualName,
                cost_cents: Math.round(Number(manualCost) * 100),
                day_index: 0,
                source_url: manualUrl || undefined,
              });
              setManualUrl("");
              setManualName("");
              setManualCost("");
            }}
          >
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground">
      {message}
    </div>
  );
}
