import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { searchActivities } from "@/lib/trip-ai.functions";
import { Button } from "@/components/ui/button";
import { ExternalLink, Star, Ticket, CalendarDays } from "lucide-react";
import { formatMoney, daysBetween } from "@/lib/workspace-store";
import { ProviderSetupCard } from "./provider-setup-card";

const CATEGORIES = [
  "All",
  "Food",
  "Nature",
  "Activity",
  "Relaxation",
  "Nightlife",
  "Spa",
  "Culture",
] as const;

interface Props {
  destination: string;
  interests: string[];
  startDate: string | null;
  endDate: string | null;
  partySize: number;
  numDays: number;
  onAdd: (item: {
    kind: "activity";
    title: string;
    subtitle?: string;
    category: string;
    cost_cents: number;
    day_index: number;
    details?: Record<string, unknown>;
    source_url?: string;
  }) => void;
}

export function ActivitiesPanel({
  destination,
  interests,
  startDate,
  endDate,
  partySize,
  numDays,
  onAdd,
}: Props) {
  const fn = useServerFn(searchActivities);
  const [cat, setCat] = useState<(typeof CATEGORIES)[number]>("All");
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["activities", destination, interests.join(","), startDate, endDate],
    queryFn: () =>
      fn({
        data: {
          destination,
          interests,
          start_date: startDate,
          end_date: endDate,
          party_size: partySize,
        },
      }),
    enabled: destination.length > 0,
    staleTime: Infinity,
    retry: false,
  });

  if (!destination)
    return (
      <div className="rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground">
        Pick a destination first.
      </div>
    );

  const places = data?.places.filter((a) => cat === "All" || a.category === cat) ?? [];

  const dayIndexFor = (localDate: string): number => {
    if (!startDate) return 0;
    const idx = daysBetween(startDate, localDate) - 1;
    return Math.max(0, Math.min(numDays - 1, idx));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-xl font-semibold">Things to do</h2>
          <p className="text-sm text-muted-foreground">
            Live events for your dates (Ticketmaster) + venues from Google Places.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? "…" : "Refresh"}
        </Button>
      </div>

      {isLoading && <div className="h-40 animate-pulse rounded-xl bg-muted/40" />}

      {/* ---- Events during the trip ---- */}
      {!isLoading && (
        <section className="space-y-3">
          <h3 className="flex items-center gap-2 font-display text-lg font-semibold">
            <Ticket className="h-4 w-4 text-primary" /> Events during your trip
            {startDate && endDate && (
              <span className="text-xs font-normal text-muted-foreground">
                {startDate} → {endDate}
              </span>
            )}
          </h3>

          {data?.events_missing_key && <ProviderSetupCard missingKey={data.events_missing_key} />}
          {data?.events_error && !data.events_missing_key && (data.events.length ?? 0) === 0 && (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              {data.events_error}
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            {data?.events.map((e) => {
              const price = e.price_min_cents ?? 0;
              return (
                <div
                  key={e.id}
                  className="overflow-hidden rounded-xl border border-border bg-card shadow-soft"
                >
                  {e.photo_url && (
                    <img
                      src={e.photo_url}
                      alt={e.name}
                      loading="lazy"
                      className="h-32 w-full object-cover"
                    />
                  )}
                  <div className="flex items-start justify-between gap-3 p-4">
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-semibold">{e.name}</h4>
                        <span className="rounded-full bg-accent/40 px-2 py-0.5 text-xs">
                          {e.segment}
                        </span>
                      </div>
                      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <CalendarDays className="h-3 w-3" />
                        {e.local_date}
                        {e.local_time ? ` · ${e.local_time}` : ""} · {e.venue}
                      </p>
                      {e.ticket_url && (
                        <a
                          href={e.ticket_url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          Tickets <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="font-display font-semibold">
                        {e.price_min_cents != null
                          ? `${formatMoney(e.price_min_cents)}${e.price_max_cents && e.price_max_cents !== e.price_min_cents ? `–${formatMoney(e.price_max_cents)}` : ""}`
                          : "See tickets"}
                      </div>
                      <Button
                        size="sm"
                        className="mt-2"
                        onClick={() =>
                          onAdd({
                            kind: "activity",
                            title: e.name,
                            subtitle: `${e.venue} · ${e.local_date}${e.local_time ? ` ${e.local_time}` : ""}`,
                            category: e.segment,
                            cost_cents: price * partySize,
                            day_index: dayIndexFor(e.local_date),
                            details: e as unknown as Record<string, unknown>,
                            source_url: e.ticket_url ?? undefined,
                          })
                        }
                      >
                        Add to day {dayIndexFor(e.local_date) + 1}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ---- Anytime venues ---- */}
      {!isLoading && (
        <section className="space-y-3">
          <h3 className="font-display text-lg font-semibold">Anytime — food & places</h3>

          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setCat(c)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${cat === c ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary"}`}
              >
                {c}
              </button>
            ))}
          </div>

          {data?.places_missing_key && <ProviderSetupCard missingKey={data.places_missing_key} />}
          {data?.places_error && !data.places_missing_key && places.length === 0 && (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              {data.places_error}
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            {places.map((a) => (
              <div
                key={a.name}
                className="overflow-hidden rounded-xl border border-border bg-card shadow-soft"
              >
                {a.photo_url && (
                  <img
                    src={a.photo_url}
                    alt={a.name}
                    loading="lazy"
                    className="h-32 w-full object-cover"
                  />
                )}
                <div className="flex items-start justify-between gap-3 p-4">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-semibold">{a.name}</h4>
                      <span className="rounded-full bg-accent/40 px-2 py-0.5 text-xs">
                        {a.category}
                      </span>
                      {a.rating != null && (
                        <span className="flex items-center gap-0.5 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-600 dark:text-amber-400">
                          <Star className="h-3 w-3 fill-current" />
                          {a.rating}
                          {a.review_count ? ` (${a.review_count})` : ""}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm">{a.description}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {a.best_time} · ~{a.duration_hours}h
                    </p>
                    {a.source_url && (
                      <a
                        href={a.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        Google Maps <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="font-display font-semibold">
                      {a.est_cost_cents === 0 ? "Free" : formatMoney(a.est_cost_cents)}
                    </div>
                    <select
                      className="mt-1 rounded-md border border-input bg-background px-1 py-0.5 text-xs"
                      onChange={(e) => {
                        const day = Number(e.target.value);
                        if (day >= 0) {
                          onAdd({
                            kind: "activity",
                            title: a.name,
                            subtitle: a.description,
                            category: a.category,
                            cost_cents: a.est_cost_cents,
                            day_index: day,
                            details: a,
                            source_url: a.source_url ?? undefined,
                          });
                          e.currentTarget.value = "-1";
                        }
                      }}
                      defaultValue="-1"
                    >
                      <option value="-1">Add to day…</option>
                      {Array.from({ length: numDays }).map((_, i) => (
                        <option key={i} value={i}>
                          Day {i + 1}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
