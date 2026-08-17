import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { searchActivities } from "@/lib/trip-ai.functions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ExternalLink,
  Star,
  Ticket,
  CalendarDays,
  Sparkles,
  X,
  MapPin,
  CalendarRange,
} from "lucide-react";
import { formatMoney } from "@/lib/workspace-store";
import { ProviderSetupCard } from "./provider-setup-card";
import { ActivityManualForm } from "./activity-manual-form";
import { ACTIVITY_CATEGORIES } from "@/lib/activity-categories";
import type { Tables } from "@/integrations/supabase/types";

const CATEGORIES = ["All", ...ACTIVITY_CATEGORIES] as const;

type Item = Tables<"trip_items">;

export interface NewActivity {
  kind: "activity";
  title: string;
  subtitle?: string;
  category: string;
  cost_cents: number;
  /**
   * Always null from this tab. Activities stage here and are only placed on a
   * day by "Build out itinerary" or a manual drag on the Itinerary tab.
   */
  day_index: number | null;
  start_time?: string | null;
  details?: Record<string, unknown>;
  source_url?: string;
}

interface Props {
  destination: string;
  interests: string[];
  startDate: string | null;
  endDate: string | null;
  partySize: number;
  /** Activities added to this trip but not yet scheduled onto a day. */
  staged: Item[];
  /**
   * Manually-created trips open on a blank slate — nothing is fetched until the
   * traveler asks for suggestions. AI trips pre-open the browse dialog.
   */
  autoBrowse: boolean;
  onAdd: (item: NewActivity) => void;
  onRemove: (id: string) => void;
  onBuildItinerary: () => void;
}

export function ActivitiesPanel({
  destination,
  interests,
  startDate,
  endDate,
  partySize,
  staged,
  autoBrowse,
  onAdd,
  onRemove,
  onBuildItinerary,
}: Props) {
  const fn = useServerFn(searchActivities);
  const [cat, setCat] = useState<(typeof CATEGORIES)[number]>("All");
  const [browseOpen, setBrowseOpen] = useState(autoBrowse);

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
    // No AI/provider call fires until the traveler opens the browse dialog.
    enabled: browseOpen && destination.length > 0,
    staleTime: Infinity,
    retry: false,
  });

  if (!destination)
    return (
      <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground">
        Pick a destination first.
      </div>
    );

  const places = data?.places.filter((a) => cat === "All" || a.category === cat) ?? [];

  return (
    <div className="space-y-6">
      <ActivityManualForm
        destination={destination}
        startDate={startDate}
        endDate={endDate}
        onAdd={onAdd}
      />

      <StagedList
        staged={staged}
        destination={destination}
        onRemove={onRemove}
        onBrowse={() => setBrowseOpen(true)}
        onBuildItinerary={onBuildItinerary}
      />

      <Dialog open={browseOpen} onOpenChange={setBrowseOpen}>
        <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" /> Browse activities
            </DialogTitle>
            <DialogDescription>
              Live events for your dates (Ticketmaster) and venues around {destination} (Google
              Places). Anything you add lands in your activities list — not your itinerary.
            </DialogDescription>
          </DialogHeader>

          <div className="flex justify-end">
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

              {data?.events_missing_key && (
                <ProviderSetupCard missingKey={data.events_missing_key} />
              )}
              {data?.events_error &&
                !data.events_missing_key &&
                (data.events.length ?? 0) === 0 && (
                  <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                    {data.events_error}
                  </div>
                )}

              <div className="grid gap-3 md:grid-cols-2">
                {data?.events.map((e) => {
                  const price = e.price_min_cents ?? 0;
                  return (
                    <div
                      key={e.id}
                      className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft"
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
                                day_index: null,
                                details: {
                                  ...(e as unknown as Record<string, unknown>),
                                  location: e.venue,
                                  preferred_date: e.local_date,
                                },
                                source_url: e.ticket_url ?? undefined,
                              })
                            }
                          >
                            Add
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

              {data?.places_missing_key && (
                <ProviderSetupCard missingKey={data.places_missing_key} />
              )}
              {data?.places_error && !data.places_missing_key && places.length === 0 && (
                <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  {data.places_error}
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-2">
                {places.map((a) => (
                  <div
                    key={a.name}
                    className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft"
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
                        <Button
                          size="sm"
                          className="mt-2"
                          onClick={() =>
                            onAdd({
                              kind: "activity",
                              title: a.name,
                              subtitle: a.description,
                              category: a.category,
                              cost_cents: a.est_cost_cents,
                              day_index: null,
                              details: a,
                              source_url: a.source_url ?? undefined,
                            })
                          }
                        >
                          Add
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Reads a staged row's optional enrichment without trusting the JSONB shape. */
function detailOf(item: Item, key: string): string | null {
  const details = item.details as Record<string, unknown> | null;
  const value = details?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function StagedList({
  staged,
  destination,
  onRemove,
  onBrowse,
  onBuildItinerary,
}: {
  staged: Item[];
  destination: string;
  onRemove: (id: string) => void;
  onBrowse: () => void;
  onBuildItinerary: () => void;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold">Your activities</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {staged.length === 0
              ? "Nothing added yet. Add your own above, or browse what's on around " +
                destination +
                "."
              : `${staged.length} ${staged.length === 1 ? "activity" : "activities"} ready to schedule. Nothing is on your itinerary until you build it out.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onBrowse}>
            <Sparkles className="mr-1 h-4 w-4" /> Browse activities
          </Button>
          <Button
            size="sm"
            disabled={staged.length === 0}
            onClick={onBuildItinerary}
            data-testid="build-itinerary-btn"
            title={
              staged.length === 0
                ? "Add at least one activity first"
                : "Let AI arrange these into a day-by-day plan"
            }
          >
            <CalendarRange className="mr-1 h-4 w-4" /> Build out itinerary
          </Button>
        </div>
      </div>

      {staged.length === 0 ? (
        <div
          className="mt-4 rounded-xl border border-dashed border-border p-8 text-center"
          data-testid="activities-blank-slate"
        >
          <Sparkles className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Activities you add collect here first, so you can gather options without committing them
            to a day.
          </p>
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm" data-testid="activities-staged-table">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Activity</th>
                <th className="py-2 pr-3 font-medium">Category</th>
                <th className="py-2 pr-3 font-medium">When</th>
                <th className="py-2 pr-3 font-medium">Location</th>
                <th className="py-2 pr-3 text-right font-medium">Cost</th>
                <th className="py-2 w-8" />
              </tr>
            </thead>
            <tbody>
              {staged.map((a) => {
                const when = detailOf(a, "preferred_date");
                const location = detailOf(a, "location");
                return (
                  <tr
                    key={a.id}
                    className="border-b border-border/60 last:border-0"
                    data-testid="activities-staged-row"
                  >
                    <td className="py-2 pr-3">
                      <span className="font-medium">{a.title}</span>
                      {a.subtitle && (
                        <span className="mt-0.5 block max-w-md truncate text-xs text-muted-foreground">
                          {a.subtitle}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <span className="rounded-full bg-accent/40 px-2 py-0.5 text-xs">
                        {a.category ?? "Activity"}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {when ? (
                        <span className="flex items-center gap-1">
                          <CalendarDays className="h-3 w-3" /> {when}
                        </span>
                      ) : (
                        <span className="text-xs">Any day</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {location ? (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          <span className="max-w-[14rem] truncate">{location}</span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right font-medium">
                      {a.cost_cents ? formatMoney(a.cost_cents) : "Free"}
                    </td>
                    <td className="py-2">
                      <button
                        onClick={() => onRemove(a.id)}
                        aria-label={`Remove ${a.title}`}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
