import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus, ListPlus } from "lucide-react";
import { ActivityFields, EMPTY_ACTIVITY_FIELDS, type ActivityFieldValues } from "./activity-fields";

interface Props {
  destination: string;
  startDate: string | null;
  endDate: string | null;
  onAdd: (item: {
    kind: "activity";
    title: string;
    subtitle?: string;
    cost_cents: number;
    /** Always null here — added activities stage, they don't schedule. */
    day_index: number | null;
    start_time?: string | null;
    details?: Record<string, unknown>;
    source_url?: string;
  }) => void;
}

export function ActivityManualForm({ destination, startDate, endDate, onAdd }: Props) {
  const [values, setValues] = useState<ActivityFieldValues>(EMPTY_ACTIVITY_FIELDS);

  const update = (patch: Partial<ActivityFieldValues>) => setValues((v) => ({ ...v, ...patch }));

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

      <div className="mt-4">
        <ActivityFields
          idPrefix="act"
          destination={destination}
          startDate={startDate}
          endDate={endDate}
          values={values}
          onChange={update}
        />
      </div>

      <div className="mt-4 flex justify-end">
        <Button
          disabled={!values.name.trim()}
          onClick={() => {
            onAdd({
              kind: "activity",
              title: values.name.trim(),
              subtitle: values.notes.trim() || undefined,
              cost_cents: values.price ? Math.round(Number(values.price) * 100) : 0,
              // Staged, never scheduled. A date the traveler typed is kept as a
              // preference for "Build out itinerary" to honour, not as a day
              // assignment — adding an activity must not touch the itinerary.
              day_index: null,
              start_time: values.date ? `${values.date}T${values.time || "00:00"}:00` : null,
              details: {
                location: values.location.trim() || undefined,
                duration_hours: values.durationHours ? Number(values.durationHours) : undefined,
                preferred_date: values.date || undefined,
              },
              source_url: values.sourceUrl.trim() || undefined,
            });
            setValues(EMPTY_ACTIVITY_FIELDS);
          }}
        >
          <Plus className="mr-1 h-4 w-4" /> Add
        </Button>
      </div>
    </section>
  );
}
