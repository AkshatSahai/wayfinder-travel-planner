import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ActivityFields, EMPTY_ACTIVITY_FIELDS, type ActivityFieldValues } from "./activity-fields";
import { timestampFor } from "@/lib/workspace-store";
import type { Tables } from "@/integrations/supabase/types";

type Item = Tables<"trip_items">;

function detailString(details: unknown, key: string): string {
  const d = details as Record<string, unknown> | null;
  const v = d?.[key];
  return typeof v === "string" ? v : "";
}

function detailNumber(details: unknown, key: string): string {
  const d = details as Record<string, unknown> | null;
  const v = d?.[key];
  return typeof v === "number" ? String(v) : "";
}

/**
 * `start_time` on an activity is a wall-clock label, not a real instant — both
 * the staged "preferred date/time" (naive local string) and the scheduled
 * pinned-arrival timestamp (UTC-labelled, see `timestampFor`) put the intended
 * HH:MM directly after the `T`, so a plain string split works for either.
 */
function fieldsFromItem(item: Item): ActivityFieldValues {
  const [datePart, timePart] = (item.start_time ?? "").split("T");
  const preferredDate = detailString(item.details, "preferred_date");
  return {
    name: item.title ?? "",
    date: preferredDate || datePart || "",
    time: timePart ? timePart.slice(0, 5) : "",
    durationHours: detailNumber(item.details, "duration_hours"),
    price: item.cost_cents ? (item.cost_cents / 100).toString() : "",
    location: detailString(item.details, "location"),
    notes: item.subtitle ?? "",
    sourceUrl: item.source_url ?? "",
  };
}

interface Props {
  item: Item | null;
  destination: string;
  startDate: string | null;
  endDate: string | null;
  onClose: () => void;
  onSave: (id: string, patch: Record<string, unknown>) => void;
}

export function ActivityDetailDialog({
  item,
  destination,
  startDate,
  endDate,
  onClose,
  onSave,
}: Props) {
  const [values, setValues] = useState<ActivityFieldValues>(EMPTY_ACTIVITY_FIELDS);
  const [autoFilled, setAutoFilled] = useState<Set<keyof ActivityFieldValues>>(new Set());

  useEffect(() => {
    if (item) {
      setValues(fieldsFromItem(item));
      setAutoFilled(new Set());
    }
  }, [item]);

  const update = (patch: Partial<ActivityFieldValues>) => {
    setValues((v) => ({ ...v, ...patch }));
    setAutoFilled((prev) => {
      const next = new Set(prev);
      for (const key of Object.keys(patch) as (keyof ActivityFieldValues)[]) next.delete(key);
      return next;
    });
  };

  const handleAutoFilled = (keys: (keyof ActivityFieldValues)[]) => {
    setAutoFilled((prev) => new Set([...prev, ...keys]));
  };

  return (
    <Dialog open={item != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit activity</DialogTitle>
        </DialogHeader>

        {item && (
          <>
            <ActivityFields
              idPrefix="act-edit"
              destination={destination}
              startDate={startDate}
              endDate={endDate}
              values={values}
              onChange={update}
              autoFilled={autoFilled}
              onAutoFilled={handleAutoFilled}
              dateLockedReason={
                item.day_index != null
                  ? "This activity is scheduled — drag it on the Itinerary tab to change its day."
                  : undefined
              }
            />

            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                disabled={!values.name.trim()}
                onClick={() => {
                  // Scheduled items store `start_time` as a UTC-labelled wall
                  // clock (see `timestampFor`) so `minutesFromTimestamp`'s
                  // UTC read stays correct; staged items use a plain naive
                  // string instead, matching the add form and never read
                  // through those UTC helpers.
                  const startTime =
                    item.day_index != null
                      ? timestampFor(startDate, item.day_index, values.time || null)
                      : values.date
                        ? `${values.date}T${values.time || "00:00"}:00`
                        : null;
                  onSave(item.id, {
                    title: values.name.trim(),
                    subtitle: values.notes.trim() || null,
                    cost_cents: values.price ? Math.round(Number(values.price) * 100) : 0,
                    start_time: startTime,
                    source_url: values.sourceUrl.trim() || null,
                    details: {
                      ...((item.details as Record<string, unknown> | null) ?? {}),
                      location: values.location.trim() || undefined,
                      duration_hours: values.durationHours
                        ? Number(values.durationHours)
                        : undefined,
                      preferred_date: values.date || undefined,
                    },
                  });
                  onClose();
                }}
              >
                Save changes
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
