import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { searchLodging } from "@/lib/trip-ai.functions";
import { geocodeLabels } from "@/lib/places.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProviderSetupCard } from "./provider-setup-card";
import { PlaceAutocomplete } from "./place-autocomplete";
import { DestinationMap, type MapCardPin } from "./destination-map";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Plus,
  ExternalLink,
  Star,
  Home,
  Hotel,
  Check,
  ArrowUpDown,
  Trash2,
  Link as LinkIcon,
} from "lucide-react";
import { fetchLinkMetadata } from "@/lib/url-metadata.functions";
import {
  formatMoney,
  daysBetween,
  haversineMiles,
  isLodgingCandidate,
  LODGING_CANDIDATE,
  type LatLng,
} from "@/lib/workspace-store";
import type { Tables } from "@/integrations/supabase/types";

type Item = Tables<"trip_items">;

type NewStay = {
  kind: "lodging";
  category: string;
  title: string;
  subtitle?: string;
  cost_cents: number;
  day_index: number;
  details?: Record<string, unknown>;
  source_url?: string;
};

interface Props {
  destination: string;
  origin: string;
  originCoords: LatLng | null;
  startDate: string | null;
  endDate: string | null;
  partySize: number;
  interests: string[];
  budgetCents: number | null;
  /** Every lodging row on this trip — candidates and the booked stay alike. */
  stays: Item[];
  onAdd: (item: NewStay) => void;
  onBook: (id: string) => void;
  onRemove: (id: string) => void;
}

type SortKey = "title" | "location" | "distance" | "cost";

const stayDetails = (s: Item) => (s.details ?? {}) as Record<string, unknown>;
const stayLocation = (s: Item) => (stayDetails(s).location as string | undefined) ?? "";
const staySource = (s: Item) => (stayDetails(s).source as string | undefined) ?? "manual";
const stayCoords = (s: Item): LatLng | null => {
  const c = stayDetails(s).coords as LatLng | undefined;
  return c && typeof c.lat === "number" && typeof c.lng === "number" ? c : null;
};

export function LodgingPanel({
  destination,
  origin,
  originCoords,
  startDate,
  endDate,
  partySize,
  interests,
  budgetCents,
  stays,
  onAdd,
  onBook,
  onRemove,
}: Props) {
  const fn = useServerFn(searchLodging);
  const geocodeFn = useServerFn(geocodeLabels);
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
  const [location, setLocation] = useState("");
  const [url, setUrl] = useState("");
  const [price, setPrice] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [autoFilled, setAutoFilled] = useState<Set<"name" | "location" | "price">>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("cost");
  const [sortAsc, setSortAsc] = useState(true);
  const [openStayId, setOpenStayId] = useState<string | null>(null);

  const fetchLinkFn = useServerFn(fetchLinkMetadata);
  const fetchLinkMut = useMutation({
    mutationFn: () => fetchLinkFn({ data: { url: url.trim() } }),
    onSuccess: ({ meta, error }) => {
      if (!meta) {
        toast.error(error ?? "Couldn't read that link — enter details manually.");
        return;
      }
      const filled = new Set<"name" | "location" | "price">();
      if (meta.title && !name.trim()) {
        setName(meta.title);
        filled.add("name");
      }
      if (meta.address && !location.trim()) {
        setLocation(meta.address);
        filled.add("location");
      }
      if (meta.price_cents != null && !price) {
        setPrice((meta.price_cents / 100).toString());
        filled.add("price");
      }
      if (meta.image) setImage(meta.image);
      setAutoFilled(filled);
      toast.success("Pulled in what we could find — review before adding.");
    },
    onError: () => toast.error("Couldn't read that link — enter details manually."),
  });
  const urlLooksValid = /^https?:\/\/.+/i.test(url.trim());

  // Stays saved before coordinates existed (or whose geocode failed) still need
  // a pin and a distance, so backfill them from their stored location text.
  const ungeocoded = stays.filter((s) => !stayCoords(s) && stayLocation(s));
  const ungeocodedKey = ungeocoded.map((s) => stayLocation(s)).join("|");
  const { data: geocoded } = useQuery({
    queryKey: ["stay-coords", ungeocodedKey],
    queryFn: () => geocodeFn({ data: { labels: ungeocoded.map((s) => stayLocation(s)) } }),
    enabled: ungeocoded.length > 0,
    staleTime: Infinity,
    retry: false,
  });

  const coordsFor = (s: Item): LatLng | null => {
    const stored = stayCoords(s);
    if (stored) return stored;
    const hit = geocoded?.results.find((r) => r.label === stayLocation(s));
    return hit?.coords ?? null;
  };

  const rows = useMemo(() => {
    const mapped = stays.map((s) => {
      const coords = coordsFor(s);
      return {
        item: s,
        coords,
        distance: coords && originCoords ? haversineMiles(originCoords, coords) : null,
        booked: !isLodgingCandidate(s),
      };
    });
    const dir = sortAsc ? 1 : -1;
    return mapped.sort((a, b) => {
      switch (sortKey) {
        case "title":
          return dir * a.item.title.localeCompare(b.item.title);
        case "location":
          return dir * stayLocation(a.item).localeCompare(stayLocation(b.item));
        case "distance":
          // Unlocatable stays sink to the bottom regardless of direction.
          if (a.distance == null) return 1;
          if (b.distance == null) return -1;
          return dir * (a.distance - b.distance);
        default:
          return dir * ((a.item.cost_cents ?? 0) - (b.item.cost_cents ?? 0));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stays, geocoded, originCoords, sortKey, sortAsc]);

  const pins: MapCardPin[] = rows
    .filter((r) => r.coords)
    .map((r) => ({
      id: r.item.id,
      name: r.item.title,
      subtitle: `${formatMoney(r.item.cost_cents ?? 0)}${r.booked ? " · Booked" : ""}`,
      lat: r.coords!.lat,
      lng: r.coords!.lng,
    }));

  const openRow = rows.find((r) => r.item.id === openStayId) ?? null;

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  if (!destination)
    return (
      <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground">
        Pick a destination first.
      </div>
    );

  const missingKey = data?.error?.includes("TRAVELPAYOUTS_API_KEY missing")
    ? "TRAVELPAYOUTS_API_KEY"
    : null;

  const addStay = (stay: Omit<NewStay, "kind" | "category" | "day_index">) =>
    onAdd({ ...stay, kind: "lodging", category: LODGING_CANDIDATE, day_index: 0 });

  return (
    <div className="space-y-6">
      {/* ---- Add a stay to the comparison list ---- */}
      <section
        className="rounded-2xl border border-border bg-card p-5 shadow-soft"
        data-testid="lodging-manual"
      >
        <div className="flex items-center gap-2">
          <Home className="h-5 w-5 text-primary" />
          <h2 className="font-display text-xl font-semibold">Add a stay to compare</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Found a place on Airbnb, VRBO, or anywhere else? Add it here to compare ({nights} night
          {nights === 1 ? "" : "s"}). Nothing hits your itinerary or budget until you book it.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.2fr_1.2fr_1fr_110px_auto]">
          <div>
            <Label htmlFor="stay-name">
              Name
              {autoFilled.has("name") && (
                <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  auto-filled
                </span>
              )}
            </Label>
            <Input
              id="stay-name"
              placeholder="e.g. Lakeview Cottage"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setAutoFilled((s) => new Set([...s].filter((k) => k !== "name")));
              }}
            />
          </div>
          <div>
            <Label htmlFor="stay-location">
              City / address
              {autoFilled.has("location") && (
                <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  auto-filled
                </span>
              )}
            </Label>
            <PlaceAutocomplete
              id="stay-location"
              value={location}
              onChange={(v) => {
                setLocation(v);
                setAutoFilled((s) => new Set([...s].filter((k) => k !== "location")));
              }}
              placeholder={destination}
            />
          </div>
          <div>
            <Label htmlFor="stay-url">Listing URL (optional)</Label>
            <div className="flex gap-2">
              <Input
                id="stay-url"
                placeholder="https://airbnb.com/rooms/…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                title="Fetch details from this link"
                disabled={!urlLooksValid || fetchLinkMut.isPending}
                onClick={() => fetchLinkMut.mutate()}
              >
                <LinkIcon className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div>
            <Label htmlFor="stay-price">
              Total $
              {autoFilled.has("price") && (
                <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  auto-filled
                </span>
              )}
            </Label>
            <Input
              id="stay-price"
              type="number"
              placeholder="900"
              value={price}
              onChange={(e) => {
                setPrice(e.target.value);
                setAutoFilled((s) => new Set([...s].filter((k) => k !== "price")));
              }}
            />
          </div>
          <div className="flex items-end">
            <Button
              className="w-full"
              disabled={!name.trim() || !price}
              onClick={() => {
                addStay({
                  title: name.trim(),
                  subtitle: `${nights} night${nights === 1 ? "" : "s"}`,
                  cost_cents: Math.round(Number(price) * 100),
                  details: {
                    location: location.trim() || destination,
                    source: "manual",
                    nights,
                    image: image ?? undefined,
                  },
                  source_url: url.trim() || undefined,
                });
                setName("");
                setLocation("");
                setUrl("");
                setPrice("");
                setImage(null);
                setAutoFilled(new Set());
              }}
            >
              <Plus className="mr-1 h-4 w-4" /> Add
            </Button>
          </div>
        </div>
        {image && <img src={image} alt="" className="mt-3 h-20 w-32 rounded-lg object-cover" />}
      </section>

      {/* ---- Comparison table + map ---- */}
      <section className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <div className="min-w-0 space-y-3">
          <h3 className="font-display text-lg font-semibold">
            Comparing {rows.length} stay{rows.length === 1 ? "" : "s"}
          </h3>
          {rows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No stays yet. Add one above, or pull one in from the live hotel search below.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
              <table className="w-full text-sm" data-testid="lodging-table">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <SortHeader
                      label="Stay"
                      active={sortKey === "title"}
                      onClick={() => toggleSort("title")}
                    />
                    <SortHeader
                      label="Location"
                      active={sortKey === "location"}
                      onClick={() => toggleSort("location")}
                    />
                    <SortHeader
                      label={origin ? "From origin" : "Distance"}
                      active={sortKey === "distance"}
                      onClick={() => toggleSort("distance")}
                    />
                    <SortHeader
                      label="Total"
                      active={sortKey === "cost"}
                      onClick={() => toggleSort("cost")}
                    />
                    <th className="px-3 py-2 font-medium">Nights</th>
                    <th className="px-3 py-2 font-medium">Book</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.item.id}
                      onClick={() => setOpenStayId(r.item.id)}
                      className={`cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50 ${
                        r.booked ? "bg-primary/5" : ""
                      }`}
                    >
                      <td className="px-3 py-2.5 font-medium">
                        <span className="flex items-center gap-1.5">
                          {r.booked && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                          {r.item.title}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {stayLocation(r.item) || "—"}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {r.distance != null ? `${Math.round(r.distance)} mi` : "—"}
                      </td>
                      <td className="px-3 py-2.5">{formatMoney(r.item.cost_cents ?? 0)}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {(stayDetails(r.item).nights as number | undefined) ?? nights}
                      </td>
                      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        {r.booked ? (
                          <span className="inline-flex items-center gap-1 text-xs text-primary">
                            <Check className="h-3.5 w-3.5" /> Booked
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            data-testid="lodging-book-btn"
                            onClick={() => onBook(r.item.id)}
                          >
                            Book
                          </Button>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          title="Remove from comparison"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemove(r.item.id);
                          }}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!originCoords && origin && rows.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Distances need your starting location on the map — they'll fill in once it resolves.
            </p>
          )}
        </div>

        <div className="min-h-[360px] xl:sticky xl:top-4 xl:h-[calc(100vh-10rem)]">
          <DestinationMap
            pins={pins}
            routeDestination={null}
            origin={null}
            waypoints={[]}
            selectedPinId={openStayId}
            onPinClick={(p) => setOpenStayId(p.id)}
          />
        </div>
      </section>

      {/* ---- Live hotel search feeds the same comparison list ---- */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Hotel className="h-5 w-5 text-primary" />
            <div>
              <h3 className="font-display text-lg font-semibold">Live hotel search</h3>
              <p className="text-xs text-muted-foreground">
                Results add into the comparison table above.
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
                          addStay({
                            title: l.name,
                            subtitle: `${l.type} · ${l.neighborhood}`,
                            cost_cents: total,
                            details: {
                              ...l,
                              nights,
                              location: `${l.neighborhood}, ${destination}`,
                              source: "live",
                            },
                            source_url: l.source_url ?? undefined,
                          })
                        }
                      >
                        <Plus className="mr-1 h-3 w-3" />
                        Compare
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ---- Detail modal ---- */}
      <Dialog open={openRow != null} onOpenChange={(v) => !v && setOpenStayId(null)}>
        <DialogContent className="max-w-lg">
          {openRow && (
            <>
              <DialogHeader>
                <DialogTitle className="font-display text-2xl">{openRow.item.title}</DialogTitle>
                <DialogDescription>{stayLocation(openRow.item) || destination}</DialogDescription>
              </DialogHeader>

              <dl className="grid grid-cols-2 gap-3 text-sm">
                <Detail label="Total cost" value={formatMoney(openRow.item.cost_cents ?? 0)} />
                <Detail
                  label="Nights"
                  value={String((stayDetails(openRow.item).nights as number | undefined) ?? nights)}
                />
                <Detail
                  label="Dates"
                  value={startDate && endDate ? `${startDate} → ${endDate}` : "TBD"}
                />
                <Detail
                  label="From origin"
                  value={openRow.distance != null ? `${Math.round(openRow.distance)} mi` : "—"}
                />
                <Detail label="Source" value={staySource(openRow.item)} />
                <Detail label="Status" value={openRow.booked ? "Booked" : "Comparing"} />
              </dl>

              {openRow.item.source_url && (
                <a
                  href={openRow.item.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  View original listing <ExternalLink className="h-3 w-3" />
                </a>
              )}

              <div className="mt-2 flex items-center justify-between gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onRemove(openRow.item.id);
                    setOpenStayId(null);
                  }}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove
                </Button>
                <Button
                  disabled={openRow.booked}
                  onClick={() => {
                    onBook(openRow.item.id);
                    setOpenStayId(null);
                  }}
                >
                  {openRow.booked ? (
                    <>
                      <Check className="mr-1 h-4 w-4" /> Booked
                    </>
                  ) : (
                    "Book this stay"
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Booking adds this stay to your itinerary and budget. Any previously booked stay
                drops back to comparison.
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SortHeader({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <th className="px-3 py-2 font-medium">
      <button
        onClick={onClick}
        className={`inline-flex items-center gap-1 hover:text-foreground ${active ? "text-foreground" : ""}`}
      >
        {label}
        <ArrowUpDown className="h-3 w-3" />
      </button>
    </th>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium capitalize">{value}</dd>
    </div>
  );
}
