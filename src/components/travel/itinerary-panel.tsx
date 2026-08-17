import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  closestCorners,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
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
import {
  X,
  Plus,
  Bed,
  Car,
  Sparkles,
  Coffee,
  GripVertical,
  SendHorizonal,
  Lightbulb,
} from "lucide-react";
import { formatMoney, committedItems } from "@/lib/workspace-store";
import type { Tables } from "@/integrations/supabase/types";

type Item = Tables<"trip_items">;

const ICONS = { lodging: Bed, transport: Car, activity: Sparkles, block: Coffee } as const;

export interface ItemMove {
  id: string;
  day_index: number;
  sort_order: number;
}

export type ItineraryChatMessage = { role: "user" | "assistant"; content: string };

interface Props {
  items: Item[];
  numDays: number;
  startDate: string | null;
  chat: {
    messages: ItineraryChatMessage[];
    pending: boolean;
    onSend: (text: string) => void;
  };
  onAdd: (item: {
    kind: "block";
    title: string;
    subtitle?: string;
    cost_cents: number;
    day_index: number;
  }) => void;
  onRemove: (id: string) => void;
  /**
   * Persists a drag: the moved item plus any siblings whose order shifted.
   * `moved` describes what the traveler actually dragged, so an advisory check
   * can run afterwards without re-deriving it.
   */
  onReorder: (moves: ItemMove[], moved?: { id: string; fromDay: number; toDay: number }) => void;
  /** At most one advisory note, or null. */
  advice: { day: number; itemId: string; note: string } | null;
  onDismissAdvice: () => void;
  /** Right-hand panel for the selected day — map, drive time, and notes. */
  renderDayPanel: (dayIdx: number) => React.ReactNode;
  onSelectedDayChange?: (dayIdx: number) => void;
}

export function ItineraryPanel({
  items,
  numDays,
  startDate,
  chat,
  advice,
  onDismissAdvice,
  renderDayPanel,
  onSelectedDayChange,
  onAdd,
  onRemove,
  onReorder,
}: Props) {
  const [blockDay, setBlockDay] = useState<number | null>(null);
  const [blockTitle, setBlockTitle] = useState("");
  const [dragging, setDragging] = useState<Item | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [selectedDayRaw, setSelectedDayRaw] = useState(0);

  const sendChat = () => {
    const text = chatInput.trim();
    if (!text || chat.pending) return;
    chat.onSend(text);
    setChatInput("");
  };

  // Lodging still under comparison, and activities still staged on the
  // Activities tab, never reach the itinerary.
  const scheduled = committedItems(items);

  const days = numDays > 0 ? numDays : Math.max(1, ...scheduled.map((i) => (i.day_index ?? 0) + 1));

  const byDay = new Map<number, Item[]>();
  for (let d = 0; d < days; d++) byDay.set(d, []);
  scheduled.forEach((i) => {
    // Deliberately no `?? 0` fallback: a null day_index means "not scheduled",
    // and coercing it to day 0 is exactly what used to dump every freshly-added
    // activity onto Day 1. committedItems already drops staged activities; this
    // guard covers any other row that reaches here without a day.
    if (i.day_index == null) return;
    const d = Math.min(Math.max(i.day_index, 0), days - 1);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(i);
  });
  for (const list of byDay.values()) {
    list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }

  // Clamp rather than store a raw index: the trip's length can shrink (dates
  // edited, chat removing a day's contents) while a later day is selected.
  const selectedDay = Math.min(selectedDayRaw, Math.max(0, days - 1));
  const setSelectedDay = (d: number) => {
    setSelectedDayRaw(d);
    onSelectedDayChange?.(d);
  };
  const dayPanel = renderDayPanel(selectedDay);

  const sensors = useSensors(
    // A small activation distance keeps the row's remove button clickable.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Pointer position first, geometry only as a fallback.
  //
  // `closestCorners` alone compares the *dragged row's* rectangle against each
  // droppable. An itinerary row is far wider than a day tab, so its corners
  // overlap the neighbouring tab even when the pointer is dead-centre on the
  // intended one — dropping onto tabs reliably landed one day off. Resolving by
  // pointer fixes that; closestCorners still covers empty day columns, where
  // the pointer may not be inside any droppable.
  const collisionDetection: CollisionDetection = (args) => {
    const byPointer = pointerWithin(args);
    return byPointer.length > 0 ? byPointer : closestCorners(args);
  };

  const dayOf = (id: string): number | null => {
    for (const [day, list] of byDay) if (list.some((i) => i.id === id)) return day;
    return null;
  };

  // Droppable ids are an item id, a day column ("day-N"), or a day tab
  // ("daytab-N"). Tabs need their OWN prefix: the selected day renders both a
  // tab and a column, and registering two droppables under the same id breaks
  // dnd-kit's registry — which silently killed drops onto tabs.
  const resolveTargetDay = (overId: string): number | null => {
    if (overId.startsWith("daytab-")) return Number(overId.slice(7));
    if (overId.startsWith("day-")) return Number(overId.slice(4));
    return dayOf(overId);
  };

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
      onReorder(
        next.map((i, idx) => ({ id: i.id, day_index: toDay, sort_order: idx })),
        { id: activeId, fromDay, toDay },
      );
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
    onReorder(
      [
        ...target.map((i, idx) => ({ id: i.id, day_index: toDay, sort_order: idx })),
        ...remaining.map((i, idx) => ({ id: i.id, day_index: fromDay, sort_order: idx })),
      ],
      { id: activeId, fromDay, toDay },
    );
  };

  const handleDragStart = (event: DragStartEvent) => {
    setDragging(scheduled.find((i) => i.id === String(event.active.id)) ?? null);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-xl font-semibold">Day by day</h2>
        <p className="text-sm text-muted-foreground">
          Drag any item to reorder it, or move it to another day — or just ask below.
        </p>
      </div>

      {/* Conversational editing. The assistant applies changes directly; every
          batch is undoable from its confirmation toast. */}
      <div
        className="rounded-2xl border border-border bg-card p-4 shadow-soft"
        data-testid="itinerary-chat"
      >
        <div className="max-h-48 space-y-2 overflow-y-auto">
          {chat.messages.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Tell me what to change — "move the aquarium to day 3", "remove the boat tour", "swap
              days 1 and 2", "add dinner at a steakhouse on day 2" — and I'll update the plan.
            </p>
          )}
          {chat.messages.map((m, i) => (
            <div
              key={i}
              className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                m.role === "user"
                  ? "ml-auto bg-sidebar-active text-white"
                  : "bg-muted text-foreground"
              }`}
            >
              {m.content}
            </div>
          ))}
          {chat.pending && (
            <div className="w-16 rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
              …
            </div>
          )}
        </div>
        <div className="mt-3 flex gap-2">
          <Input
            placeholder="Ask for a change…"
            value={chatInput}
            data-testid="itinerary-chat-input"
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") sendChat();
            }}
          />
          <Button
            size="icon"
            onClick={sendChat}
            data-testid="itinerary-chat-send"
            disabled={!chatInput.trim() || chat.pending}
          >
            <SendHorizonal className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        {/* Day tabs double as drop targets so an item can still be moved to a
            day that isn't currently shown — otherwise switching to a day-at-a-
            time view would remove the only way to drag across days. */}
        <div className="flex flex-wrap gap-2" data-testid="day-tabs">
          {Array.from({ length: days }).map((_, dayIdx) => (
            <DayTab
              key={dayIdx}
              dayIdx={dayIdx}
              active={dayIdx === selectedDay}
              count={(byDay.get(dayIdx) ?? []).length}
              startDate={startDate}
              onSelect={() => setSelectedDay(dayIdx)}
            />
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            {[selectedDay].map((dayIdx) => {
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
                        <span className="ml-2 text-sm font-normal text-muted-foreground">
                          {date}
                        </span>
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

                  {advice?.day === dayIdx && (
                    <div
                      className="mb-3 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3"
                      data-testid="advisor-note"
                    >
                      <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" />
                      <p className="flex-1 text-sm">{advice.note}</p>
                      <button
                        onClick={onDismissAdvice}
                        aria-label="Dismiss suggestion"
                        data-testid="advisor-dismiss"
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-4 w-4" />
                      </button>
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
          </div>

          <div className="space-y-3">{dayPanel}</div>
        </div>

        <DragOverlay>{dragging ? <ItemRow item={dragging} dragging /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}

function DayTab({
  dayIdx,
  active,
  count,
  startDate,
  onSelect,
}: {
  dayIdx: number;
  active: boolean;
  count: number;
  startDate: string | null;
  onSelect: () => void;
}) {
  // `daytab-` not `day-`: the selected day renders a tab AND a column, and two
  // droppables sharing one id break dnd-kit's registry.
  const { setNodeRef, isOver } = useDroppable({ id: `daytab-${dayIdx}` });
  const date = startDate
    ? new Date(new Date(startDate).getTime() + dayIdx * 86400000).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : null;
  return (
    <button
      ref={setNodeRef}
      onClick={onSelect}
      aria-current={active ? "page" : undefined}
      data-testid={`day-tab-${dayIdx}`}
      className={`rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
        isOver
          ? "border-primary bg-primary/10"
          : active
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-card hover:border-primary"
      }`}
    >
      <span className="font-medium">Day {dayIdx + 1}</span>
      {date && <span className="ml-2 text-xs opacity-80">{date}</span>}
      <span className="ml-2 text-xs opacity-70">
        {count} {count === 1 ? "item" : "items"}
      </span>
    </button>
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
  const details = (item.details ?? {}) as Record<string, unknown>;
  const reason = typeof details.planner_reason === "string" ? details.planner_reason : null;
  const time = item.start_time
    ? new Date(item.start_time).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })
    : null;
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
        <p className="font-medium">
          {time && <span className="mr-2 text-xs text-muted-foreground">{time}</span>}
          {item.title}
        </p>
        {item.subtitle && <p className="text-xs text-muted-foreground">{item.subtitle}</p>}
        {reason && (
          <p className="mt-0.5 text-xs italic text-muted-foreground" data-testid="planner-reason">
            {reason}
          </p>
        )}
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
