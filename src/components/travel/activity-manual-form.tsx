import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PlaceAutocomplete } from "./place-autocomplete";
import { Plus, Link as LinkIcon, ListPlus } from "lucide-react";
import { ACTIVITY_CATEGORIES, type ActivityCategory } from "@/lib/activity-categories";
import { fetchLinkMetadata } from "@/lib/url-metadata.functions";

interface Props {
  destination: string;
  startDate: string | null;
  endDate: string | null;
  onAdd: (item: {
    kind: "activity";
    title: string;
    subtitle?: string;
    category: string;
    cost_cents: number;
    /** Always null here — added activities stage, they don't schedule. */
    day_index: number | null;
    start_time?: string | null;
    details?: Record<string, unknown>;
    source_url?: string;
  }) => void;
}

export function ActivityManualForm({ destination, startDate, endDate, onAdd }: Props) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ActivityCategory>("Activity");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [durationHours, setDurationHours] = useState("");
  const [price, setPrice] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchFn = useServerFn(fetchLinkMetadata);
  const fetchMut = useMutation({
    mutationFn: () => fetchFn({ data: { url: sourceUrl.trim() } }),
    onSuccess: ({ meta, error }) => {
      if (!meta) {
        setFetchError(error ?? "Couldn't read that link — enter details manually.");
        return;
      }
      setFetchError(null);
      if (meta.title && !name.trim()) setName(meta.title);
      if (meta.description && !notes.trim()) setNotes(meta.description);
      if (meta.price_cents != null && !price) setPrice((meta.price_cents / 100).toString());
      toast.success("Pulled in what we could find — review before adding.");
    },
    onError: () => setFetchError("Couldn't read that link — enter details manually."),
  });

  const reset = () => {
    setName("");
    setCategory("Activity");
    setDate("");
    setTime("");
    setDurationHours("");
    setPrice("");
    setLocation("");
    setNotes("");
    setSourceUrl("");
    setFetchError(null);
  };

  const urlLooksValid = /^https?:\/\/.+/i.test(sourceUrl.trim());

  return (
    <section
      className="rounded-2xl border border-border bg-card p-5 shadow-soft"
      data-testid="activities-manual"
    >
      <div className="flex items-center gap-2">
        <ListPlus className="h-5 w-5 text-primary" />
        <h2 className="font-display text-xl font-semibold">Add your own activity</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Have somewhere specific in mind? Add it directly, or paste a link and we'll try to fill in
        the details for you to review.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <Label htmlFor="act-name">Name</Label>
          <Input
            id="act-name"
            placeholder="e.g. Riverside walking tour"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="act-category">Category</Label>
          <select
            id="act-category"
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
            value={category}
            onChange={(e) => setCategory(e.target.value as ActivityCategory)}
          >
            {ACTIVITY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="act-location">Location (optional)</Label>
          <PlaceAutocomplete
            id="act-location"
            value={location}
            onChange={setLocation}
            placeholder={destination}
          />
        </div>
        <div>
          <Label htmlFor="act-date">Date (optional)</Label>
          <Input
            id="act-date"
            type="date"
            min={startDate ?? undefined}
            max={endDate ?? undefined}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="act-time">Time (optional)</Label>
          <Input
            id="act-time"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            disabled={!date}
          />
        </div>
        <div>
          <Label htmlFor="act-duration">Duration, hours (optional)</Label>
          <Input
            id="act-duration"
            type="number"
            step="0.5"
            placeholder="2"
            value={durationHours}
            onChange={(e) => setDurationHours(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="act-cost">Cost $ (optional)</Label>
          <Input
            id="act-cost"
            type="number"
            placeholder="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
        <div className="sm:col-span-2 lg:col-span-2">
          <Label htmlFor="act-notes">Notes (optional)</Label>
          <Textarea
            id="act-notes"
            placeholder="Anything worth remembering about this one"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <Label htmlFor="act-source">Source link (optional)</Label>
          <div className="mt-1 flex gap-2">
            <Input
              id="act-source"
              placeholder="https://…"
              value={sourceUrl}
              onChange={(e) => {
                setSourceUrl(e.target.value);
                setFetchError(null);
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={!urlLooksValid || fetchMut.isPending}
              onClick={() => fetchMut.mutate()}
            >
              <LinkIcon className="mr-1 h-4 w-4" />
              {fetchMut.isPending ? "Fetching…" : "Fetch details"}
            </Button>
          </div>
          {fetchError && <p className="mt-1 text-xs text-destructive">{fetchError}</p>}
          {fetchMut.data?.meta?.image && (
            <img
              src={fetchMut.data.meta.image}
              alt=""
              className="mt-2 h-20 w-32 rounded-lg object-cover"
            />
          )}
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <Button
          disabled={!name.trim()}
          onClick={() => {
            onAdd({
              kind: "activity",
              title: name.trim(),
              subtitle: notes.trim() || undefined,
              category,
              cost_cents: price ? Math.round(Number(price) * 100) : 0,
              // Staged, never scheduled. A date the traveler typed is kept as a
              // preference for "Build out itinerary" to honour, not as a day
              // assignment — adding an activity must not touch the itinerary.
              day_index: null,
              start_time: date ? `${date}T${time || "00:00"}:00` : null,
              details: {
                location: location.trim() || undefined,
                duration_hours: durationHours ? Number(durationHours) : undefined,
                preferred_date: date || undefined,
              },
              source_url: sourceUrl.trim() || undefined,
            });
            reset();
          }}
        >
          <Plus className="mr-1 h-4 w-4" /> Add
        </Button>
      </div>
    </section>
  );
}
