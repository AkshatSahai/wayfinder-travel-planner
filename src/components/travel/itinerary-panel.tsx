import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Plus, Bed, Car, Sparkles, Coffee, GripVertical } from "lucide-react";
import { formatMoney, committedItems } from "@/lib/workspace-store";
import type { Tables } from "@/integrations/supabase/types";

type Item = Tables<"trip_items">;

const ICONS = { lodging: Bed, transport: Car, activity: Sparkles, block: Coffee } as const;

export interface ItemMove {
  id: string;
  day_index: number;
  sort_order: number;
}

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
  /** Persists a drag: the moved item plus any siblings whose order shifted. */
  onReorder: (moves: ItemMove[]) => void;
}

export function ItineraryPanel({ items, numDays, startDate, onAdd, onRemove, onReorder }: Props) {
  const [blockDay, setBlockDay] = useState<number | null>(null);
  const [blockTitle, setBlockTitle] = useState("");
  const [dragging, setDragging] = useState<Item | null>(null);

  // Lodging still under comparison never reaches the itinerary.
  const scheduled = committedItems(items);

  const days = numDays > 0 ? numDays : Math.max(1, ...scheduled.map((i) => (i.day_index ?? 0) + 1));

  const byDay = new Map<number, Item[]>();
  for (let d = 0; d < days; d++) byDay.set(d, []);
  scheduled.forEach((i) => {
    const d = Math.min(Math.max(i.day_index ?? 0, 0), days - 1);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(i);
  });
  for (const list of byDay.values()) {
    list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }

  const sensors = useSensors(
    // A small activation distance keeps the row's remove button clickable.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const dayOf = (id: string): number | null => {
    for (const [day, list] of byDay) if (list.some((i) => i.id === id)) return day;
    return null;
  };

  // Droppable ids are either an item id or an empty day's "day-N" container.
  const resolveTargetDay = (overId: string): number | null =>
    overId.startsWith("day-") ? Number(overId.slice(4)) : dayOf(overId);

  const handleDragEnd = (event: DragEndEvent) => {
    setDragging(null);
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    const fromDay = dayOf(activeId);
    const toDay = resolveTargetDay(overId);
    if (fromDay == null || toDay == null) return;

    const source = [...(byDay.get(fromDay) ?? [])];
    const moved = source.find((i) => i.id === activeId);
    if (!moved) return;

    if (fromDay === toDay) {
      const oldIndex = source.findIndex((i) => i.id === activeId);
      const newIndex = overId.startsWith("day-")
        ? source.length - 1
        : source.findIndex((i) => i.id === overId);
      if (oldIndex === newIndex || newIndex < 0) return;
      const next = arrayMove(source, oldIndex, newIndex);
      onReorder(next.map((i, idx) => ({ id: i.id, day_index: toDay, sort_order: idx })));
      return;
    }

    const target = [...(byDay.get(toDay) ?? [])].filter((i) => i.id !== activeId);
    const insertAt = overId.startsWith("day-")
      ? target.length
      : Math.max(
          0,
          target.findIndex((i) => i.id === overId),
        );
    target.splice(insertAt, 0, moved);

    const remaining = source.filter((i) => i.id !== activeId);
    onReorder([
      ...target.map((i, idx) => ({ id: i.id, day_index: toDay, sort_order: idx })),
      ...remaining.map((i, idx) => ({ id: i.id, day_index: fromDay, sort_order: idx })),
    ]);
  };

  const handleDragStart = (event: DragStartEvent) => {
    setDragging(scheduled.find((i) => i.id === String(event.active.id)) ?? null);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-xl font-semibold">Day by day</h2>
        <p className="text-sm text-muted-foreground">
          Drag any item to reorder it, or move it to another day.
        </p>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        {Array.from({ length: days }).map((_, dayIdx) => {
          const dayItems = byDay.get(dayIdx) ?? [];
          const date = startDate
            ? new Date(new Date(startDate).getTime() + dayIdx * 86400000).toLocaleDateString(
                undefined,
                { weekday: "short", month: "short", day: "numeric" },
              )
            : null;

          return (
            <DayColumn key={dayIdx} dayIdx={dayIdx}>
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
                        onAdd({
                          kind: "block",
                          title: blockTitle,
                          cost_cents: 0,
                          day_index: dayIdx,
                        });
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
                  Nothing scheduled. Add a block above, or drag an item here.
                </p>
              )}

              <SortableContext
                items={dayItems.map((i) => i.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2">
                  {dayItems.map((it) => (
                    <SortableRow key={it.id} item={it} onRemove={onRemove} />
                  ))}
                </div>
              </SortableContext>
            </DayColumn>
          );
        })}

        <DragOverlay>{dragging ? <ItemRow item={dragging} dragging /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}

function DayColumn({ dayIdx, children }: { dayIdx: number; children: React.ReactNode }) {
  // Gives empty days a drop target of their own.
  const { setNodeRef, isOver } = useDroppable({ id: `day-${dayIdx}` });
  return (
    <div
      ref={setNodeRef}
      data-testid={`itinerary-day-${dayIdx}`}
      className={`rounded-2xl border bg-card p-4 shadow-soft transition-colors ${
        isOver ? "border-primary bg-primary/5" : "border-border"
      }`}
    >
      {children}
    </div>
  );
}

function SortableRow({ item, onRemove }: { item: Item; onRemove: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "opacity-40" : undefined}
    >
      <ItemRow item={item} onRemove={onRemove} handleProps={{ ...attributes, ...listeners }} />
    </div>
  );
}

function ItemRow({
  item,
  onRemove,
  handleProps,
  dragging,
}: {
  item: Item;
  onRemove?: (id: string) => void;
  handleProps?: Record<string, unknown>;
  dragging?: boolean;
}) {
  const Icon = ICONS[item.kind as keyof typeof ICONS] ?? Coffee;
  return (
    <div
      className={`group flex items-start gap-2 rounded-lg border border-border bg-background p-3 ${
        dragging ? "shadow-card" : ""
      }`}
    >
      <button
        {...handleProps}
        className="mt-0.5 cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
        title="Drag to reorder or move day"
        aria-label={`Reorder ${item.title}`}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div className="flex-1">
        <p className="font-medium">{item.title}</p>
        {item.subtitle && <p className="text-xs text-muted-foreground">{item.subtitle}</p>}
      </div>
      <div className="text-right">
        <p className="text-sm font-medium">
          {item.cost_cents ? formatMoney(item.cost_cents) : "—"}
        </p>
      </div>
      {onRemove && (
        <button onClick={() => onRemove(item.id)} className="opacity-0 group-hover:opacity-100">
          <X className="h-4 w-4 text-muted-foreground hover:text-destructive" />
        </button>
      )}
    </div>
  );
}
