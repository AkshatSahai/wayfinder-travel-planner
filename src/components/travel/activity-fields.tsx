import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PlaceAutocomplete } from "./place-autocomplete";
import { Link as LinkIcon } from "lucide-react";
import { fetchLinkMetadata } from "@/lib/url-metadata.functions";

export interface ActivityFieldValues {
  name: string;
  date: string;
  time: string;
  durationHours: string;
  price: string;
  location: string;
  notes: string;
  sourceUrl: string;
}

export const EMPTY_ACTIVITY_FIELDS: ActivityFieldValues = {
  name: "",
  date: "",
  time: "",
  durationHours: "",
  price: "",
  location: "",
  notes: "",
  sourceUrl: "",
};

interface Props {
  idPrefix: string;
  destination: string;
  startDate: string | null;
  endDate: string | null;
  values: ActivityFieldValues;
  onChange: (patch: Partial<ActivityFieldValues>) => void;
  /** Field keys currently shown with an "auto-filled" badge. */
  autoFilled?: Set<keyof ActivityFieldValues>;
  /** Called after a successful link fetch with the keys it populated. */
  onAutoFilled?: (keys: (keyof ActivityFieldValues)[]) => void;
  /**
   * Disables the Date field with an explanatory caption — for an already
   * scheduled activity, the day comes from dragging it on the Itinerary tab,
   * not from this field, so leaving it editable here would silently do
   * nothing.
   */
  dateLockedReason?: string;
}

/**
 * The activity field set shared between the add form and the edit dialog —
 * including the "paste a link, fetch details" flow. Kept as one component
 * because that flow is real logic (a mutation, an image preview, an
 * only-fill-if-empty policy), not just markup worth copy-pasting twice.
 */
export function ActivityFields({
  idPrefix,
  destination,
  startDate,
  endDate,
  values,
  onChange,
  autoFilled,
  onAutoFilled,
  dateLockedReason,
}: Props) {
  const fetchFn = useServerFn(fetchLinkMetadata);
  const fetchMut = useMutation({
    mutationFn: () => fetchFn({ data: { url: values.sourceUrl.trim() } }),
    onSuccess: ({ meta, error }) => {
      if (!meta) {
        toast.error(error ?? "Couldn't read that link — enter details manually.");
        return;
      }
      const patch: Partial<ActivityFieldValues> = {};
      const filled: (keyof ActivityFieldValues)[] = [];
      if (meta.title && !values.name.trim()) {
        patch.name = meta.title;
        filled.push("name");
      }
      if (meta.address && !values.location.trim()) {
        patch.location = meta.address;
        filled.push("location");
      }
      // Ticket price is more specific than a generic OG price when both exist.
      const priceCents = meta.ticket_price_cents ?? meta.price_cents;
      if (priceCents != null && !values.price) {
        patch.price = (priceCents / 100).toString();
        filled.push("price");
      }
      if (!values.notes.trim()) {
        // Everything here is a line pulled from something the page or Google
        // actually said — the description, then any structured planning
        // caveats found in JSON-LD — never a generated summary.
        const lines = [
          meta.description,
          meta.hours ? `Hours: ${meta.hours}` : null,
          meta.requires_reservation ? "Reservation required." : null,
          meta.notes,
        ].filter((x): x is string => Boolean(x));
        if (lines.length > 0) {
          patch.notes = lines.join("\n");
          filled.push("notes");
        }
      }
      onChange(patch);
      onAutoFilled?.(filled);
      toast.success("Pulled in what we could find — review before saving.");
    },
    onError: () => toast.error("Couldn't read that link — enter details manually."),
  });

  const urlLooksValid = /^https?:\/\/.+/i.test(values.sourceUrl.trim());
  const id = (field: string) => `${idPrefix}-${field}`;
  const badge = (field: keyof ActivityFieldValues) =>
    autoFilled?.has(field) ? (
      <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
        auto-filled
      </span>
    ) : null;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div>
        <Label htmlFor={id("name")}>Name{badge("name")}</Label>
        <Input
          id={id("name")}
          placeholder="e.g. Riverside walking tour"
          value={values.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </div>
      <div>
        <Label htmlFor={id("location")}>Location (optional){badge("location")}</Label>
        <PlaceAutocomplete
          id={id("location")}
          value={values.location}
          onChange={(v) => onChange({ location: v })}
          placeholder={destination}
        />
      </div>
      <div>
        <Label htmlFor={id("date")}>Date (optional)</Label>
        <Input
          id={id("date")}
          type="date"
          min={startDate ?? undefined}
          max={endDate ?? undefined}
          value={values.date}
          onChange={(e) => onChange({ date: e.target.value })}
          disabled={Boolean(dateLockedReason)}
        />
        {dateLockedReason && (
          <p className="mt-1 text-xs text-muted-foreground">{dateLockedReason}</p>
        )}
      </div>
      <div>
        <Label htmlFor={id("time")}>Time (optional)</Label>
        <Input
          id={id("time")}
          type="time"
          value={values.time}
          onChange={(e) => onChange({ time: e.target.value })}
          disabled={!values.date && !dateLockedReason}
        />
      </div>
      <div>
        <Label htmlFor={id("duration")}>Duration, hours (optional)</Label>
        <Input
          id={id("duration")}
          type="number"
          step="0.5"
          placeholder="2"
          value={values.durationHours}
          onChange={(e) => onChange({ durationHours: e.target.value })}
        />
      </div>
      <div>
        <Label htmlFor={id("cost")}>Cost $ (optional){badge("price")}</Label>
        <Input
          id={id("cost")}
          type="number"
          placeholder="0"
          value={values.price}
          onChange={(e) => onChange({ price: e.target.value })}
        />
      </div>
      <div className="sm:col-span-2 lg:col-span-2">
        <Label htmlFor={id("notes")}>Notes (optional){badge("notes")}</Label>
        <Textarea
          id={id("notes")}
          placeholder="Anything worth remembering about this one"
          value={values.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          rows={2}
        />
      </div>
      <div className="sm:col-span-2 lg:col-span-3">
        <Label htmlFor={id("source")}>Source link (optional)</Label>
        <div className="mt-1 flex gap-2">
          <Input
            id={id("source")}
            placeholder="https://…"
            value={values.sourceUrl}
            onChange={(e) => onChange({ sourceUrl: e.target.value })}
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
        {fetchMut.data?.meta?.image && (
          <img
            src={fetchMut.data.meta.image}
            alt=""
            className="mt-2 h-20 w-32 rounded-lg object-cover"
          />
        )}
      </div>
    </div>
  );
}
