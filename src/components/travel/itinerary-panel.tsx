import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Plus, Bed, Car, Sparkles, Coffee } from "lucide-react";
import { formatMoney } from "@/lib/workspace-store";
import type { Tables } from "@/integrations/supabase/types";

type Item = Tables<"trip_items">;

const ICONS = { lodging: Bed, transport: Car, activity: Sparkles, block: Coffee } as const;

interface Props {
  items: Item[];
  numDays: number;
  startDate: string | null;
  onAdd: (item: {
    kind: "block";
    title: string;
    subtitle?: string;
    cost_cents: number;
    day_index: number;
  }) => void;
  onRemove: (id: string) => void;
}

export function ItineraryPanel({ items, numDays, startDate, onAdd, onRemove }: Props) {
  const [blockDay, setBlockDay] = useState<number | null>(null);
  const [blockTitle, setBlockTitle] = useState("");

  const groupedByDay = new Map<number, Item[]>();
  items.forEach((i) => {
    const d = i.day_index ?? 0;
    if (!groupedByDay.has(d)) groupedByDay.set(d, []);
    groupedByDay.get(d)!.push(i);
  });

  const days = numDays > 0 ? numDays : Math.max(1, ...items.map((i) => (i.day_index ?? 0) + 1));

  return (
    <div className="space-y-4">
      <h2 className="font-display text-xl font-semibold">Day by day</h2>

      {Array.from({ length: days }).map((_, dayIdx) => {
        const dayItems = groupedByDay.get(dayIdx) ?? [];
        const date = startDate
          ? new Date(new Date(startDate).getTime() + dayIdx * 86400000).toLocaleDateString(
              undefined,
              { weekday: "short", month: "short", day: "numeric" },
            )
          : null;

        return (
          <div key={dayIdx} className="rounded-xl border border-border bg-card p-4 shadow-soft">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display font-semibold">
                Day {dayIdx + 1}{" "}
                {date && (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">{date}</span>
                )}
              </h3>
              <Button variant="ghost" size="sm" onClick={() => setBlockDay(dayIdx)}>
                <Plus className="mr-1 h-3 w-3" /> Block
              </Button>
            </div>

            {blockDay === dayIdx && (
              <div className="mb-3 flex gap-2">
                <Input
                  placeholder="e.g. Relax, no plans"
                  value={blockTitle}
                  onChange={(e) => setBlockTitle(e.target.value)}
                />
                <Button
                  size="sm"
                  onClick={() => {
                    if (blockTitle.trim()) {
                      onAdd({ kind: "block", title: blockTitle, cost_cents: 0, day_index: dayIdx });
                      setBlockTitle("");
                      setBlockDay(null);
                    }
                  }}
                >
                  Add
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setBlockDay(null);
                    setBlockTitle("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            )}

            {dayItems.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nothing scheduled. Add activities, or a free-form block above.
              </p>
            )}

            <div className="space-y-2">
              {dayItems.map((it) => {
                const Icon = ICONS[it.kind as keyof typeof ICONS] ?? Coffee;
                return (
                  <div
                    key={it.id}
                    className="group flex items-start gap-3 rounded-lg border border-border bg-background p-3"
                  >
                    <Icon className="mt-0.5 h-4 w-4 text-primary shrink-0" />
                    <div className="flex-1">
                      <p className="font-medium">{it.title}</p>
                      {it.subtitle && (
                        <p className="text-xs text-muted-foreground">{it.subtitle}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">
                        {it.cost_cents ? formatMoney(it.cost_cents) : "—"}
                      </p>
                    </div>
                    <button
                      onClick={() => onRemove(it.id)}
                      className="opacity-0 group-hover:opacity-100"
                    >
                      <X className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
