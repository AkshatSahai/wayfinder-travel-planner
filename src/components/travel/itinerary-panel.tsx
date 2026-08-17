import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  closestCorners,
  pointerWithin,
  useDraggable,
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  MessageCircle,
  MapPin,
  Clock,
  ChevronsLeft,
  ChevronsRight,
  Undo2,
} from "lucide-react";
import { committedItems, formatClockUTC } from "@/lib/workspace-store";
import type { Tables } from "@/integrations/supabase/types";

type Item = Tables<"trip_items">;

const ICONS = { lodging: Bed, transport: Car, activity: Sparkles, block: Coffee } as const;

/** Drag ids for activities-panel rows are prefixed so the same trip_items id
 * can't collide with that item's day-column row registered in the same
 * DndContext (the day-N / daytab-N split exists for the same reason). */
const LIST_ID_PREFIX = "list-";
const ACTIVITIES_PANEL_DROP_ID = "activities-panel";

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
  /** Traveler-set start time per day, keyed by day index as a string ("0", "1", …). */
  dayStartTimes: Record<string, string>;
  onSetDayStartTime: (dayIndex: number, hhmm: string | null) => void;
  /** Pin (or clear, with `hhmm: null`) a single activity's arrival time. */
  onPinTime: (item: Item, hhmm: string | null) => void;
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
  /** Activities: unschedule (back to staged). Everything else: a real delete. */
  onRemove: (item: Item) => void;
  /**
   * Persists a drag: the moved item plus any siblings whose order shifted.
   * `moved` describes what the traveler actually dragged, so an advisory check
   * can run afterwards without re-deriving it. `fromDay` is null when the drag
   * scheduled a previously-staged activity for the first time.
   */
  onReorder: (
    moves: ItemMove[],
    moved?: { id: string; fromDay: number | null; toDay: number },
  ) => void;
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
  dayStartTimes,
  onSetDayStartTime,
  onPinTime,
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
  const [rightView, setRightView] = useState<"map" | "chat">("map");
  const [activitiesOpen, setActivitiesOpen] = useState(true);
  const [selectedDayRaw, setSelectedDayRaw] = useState(0);

  const sendChat = () => {
    const text = chatInput.trim();
    if (!text || chat.pending) return;
    chat.onSend(text);
    setChatInput("");
  };

  // Lodging still under comparison never reaches the itinerary; staged
  // activities are excluded from day grouping but still show in the
  // activities panel below.
  const scheduled = committedItems(items);
  const allActivities = items
    .filter((i) => i.kind === "activity")
    .sort((a, b) => (a.day_index ?? -1) - (b.day_index ?? -1));

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

  // Droppable ids are an item id, a day column ("day-N"), a day tab
  // ("daytab-N"), or the activities panel itself. Tabs need their OWN prefix:
  // the selected day renders both a tab and a column, and registering two
  // droppables under the same id breaks dnd-kit's registry — which silently
  // killed drops onto tabs.
  const resolveTargetDay = (overId: string): number | null => {
    if (overId.startsWith("daytab-")) return Number(overId.slice(7));
    if (overId.startsWith("day-")) return Number(overId.slice(4));
    return dayOf(overId);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDragging(null);
    const { active, over } = event;
    if (!over) return;

    const rawActiveId = String(active.id);
    const activeId = rawActiveId.startsWith(LIST_ID_PREFIX)
      ? rawActiveId.slice(LIST_ID_PREFIX.length)
      : rawActiveId;
    const overId = String(over.id);

    // Dropped onto the activities panel itself: unschedule a scheduled
    // activity. A staged one dropped back onto its own list is a no-op.
    if (overId === ACTIVITIES_PANEL_DROP_ID) {
      const item = items.find((i) => i.id === activeId);
      if (item && item.kind === "activity" && item.day_index != null) onRemove(item);
      return;
    }

    const toDay = resolveTargetDay(overId);
    if (toDay == null) return;

    // null here means "staged" — the activity has no current day, so this
    // drag schedules it for the first time rather than moving it.
    const fromDay = dayOf(activeId);
    const item = items.find((i) => i.id === activeId);
    if (!item) return;

    if (fromDay != null && fromDay === toDay) {
      const source = [...(byDay.get(fromDay) ?? [])];
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
    target.splice(insertAt, 0, item);

    const remaining =
      fromDay != null ? (byDay.get(fromDay) ?? []).filter((i) => i.id !== activeId) : [];
    onReorder(
      [
        ...target.map((i, idx) => ({ id: i.id, day_index: toDay, sort_order: idx })),
        ...remaining.map((i, idx) => ({ id: i.id, day_index: fromDay!, sort_order: idx })),
      ],
      { id: activeId, fromDay, toDay },
    );
  };

  const handleDragStart = (event: DragStartEvent) => {
    const rawId = String(event.active.id);
    const realId = rawId.startsWith(LIST_ID_PREFIX) ? rawId.slice(LIST_ID_PREFIX.length) : rawId;
    setDragging(items.find((i) => i.id === realId) ?? null);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-xl font-semibold">Day by day</h2>
        <p className="text-sm text-muted-foreground">
          Drag any activity onto a day to schedule it, or drag it back here to unschedule.
        </p>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div className="flex items-start gap-4">
          <ActivitiesDragPanel
            activities={allActivities}
            open={activitiesOpen}
            onToggle={() => setActivitiesOpen((o) => !o)}
          />

          <div className="min-w-0 flex-1 space-y-4">
            {/* Day tabs double as drop targets so an item can still be moved to
                a day that isn't currently shown — otherwise switching to a
                day-at-a-time view would remove the only way to drag across
                days. */}
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
                    ? new Date(
                        new Date(startDate).getTime() + dayIdx * 86400000,
                      ).toLocaleDateString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })
                    : null;

                  return (
                    <DayColumn key={dayIdx} dayIdx={dayIdx}>
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <h3 className="font-display font-semibold">
                          Day {dayIdx + 1}{" "}
                          {date && (
                            <span className="ml-2 text-sm font-normal text-muted-foreground">
                              {date}
                            </span>
                          )}
                        </h3>
                        <div className="flex items-center gap-2">
                          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Clock className="h-3.5 w-3.5" />
                            Start
                            <Input
                              type="time"
                              className="h-7 w-24 px-2 text-xs"
                              value={dayStartTimes[String(dayIdx)] ?? ""}
                              onChange={(e) => onSetDayStartTime(dayIdx, e.target.value || null)}
                              data-testid={`day-start-time-${dayIdx}`}
                            />
                          </label>
                          <Button variant="ghost" size="sm" onClick={() => setBlockDay(dayIdx)}>
                            <Plus className="mr-1 h-3 w-3" /> Block
                          </Button>
                        </div>
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
                          className="mb-3 flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning/5 py-1 pl-2.5 pr-1 text-xs"
                          data-testid="advisor-note"
                        >
                          <Lightbulb className="h-3 w-3 shrink-0 text-warning-foreground" />
                          <p className="flex-1 leading-snug text-muted-foreground">{advice.note}</p>
                          <button
                            onClick={onDismissAdvice}
                            aria-label="Dismiss suggestion"
                            data-testid="advisor-dismiss"
                            className="shrink-0 rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      )}

                      {dayItems.length === 0 && (
                        <p className="text-sm text-muted-foreground">
                          Nothing scheduled. Add a block above, or drag an activity here.
                        </p>
                      )}

                      <SortableContext
                        items={dayItems.map((i) => i.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        <div className="space-y-2">
                          {dayItems.map((it) => (
                            <SortableRow
                              key={it.id}
                              item={it}
                              onRemove={onRemove}
                              onPinTime={onPinTime}
                            />
                          ))}
                        </div>
                      </SortableContext>
                    </DayColumn>
                  );
                })}
              </div>

              <div className="space-y-3">
                <div className="flex gap-1 rounded-lg border border-border bg-muted/40 p-1 text-sm">
                  <button
                    onClick={() => setRightView("map")}
                    data-testid="itinerary-right-map-tab"
                    className={`flex-1 rounded-md px-3 py-1.5 font-medium transition-colors ${
                      rightView === "map"
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <MapPin className="mr-1.5 inline h-3.5 w-3.5" /> Map
                  </button>
                  <button
                    onClick={() => setRightView("chat")}
                    data-testid="itinerary-right-chat-tab"
                    className={`flex-1 rounded-md px-3 py-1.5 font-medium transition-colors ${
                      rightView === "chat"
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <MessageCircle className="mr-1.5 inline h-3.5 w-3.5" /> Ask AI
                    {chat.messages.length > 0 && (
                      <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                        {chat.messages.length}
                      </span>
                    )}
                  </button>
                </div>

                {rightView === "map" ? (
                  dayPanel
                ) : (
                  <div
                    className="flex min-h-[420px] flex-col rounded-2xl border border-border bg-card p-4 shadow-soft"
                    data-testid="itinerary-chat"
                  >
                    <p className="mb-2 text-xs text-muted-foreground">
                      Ask for a change — "move the aquarium to day 3", "swap days 1 and 2" — or ask
                      a question — "what are good restaurants near day 2's stops?"
                    </p>
                    <div className="flex-1 space-y-2 overflow-y-auto">
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
                        placeholder="Ask for a change or a question…"
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
                )}
              </div>
            </div>
          </div>
        </div>

        <DragOverlay>{dragging ? <ItemRow item={dragging} dragging /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}

function ActivitiesDragPanel({
  activities,
  open,
  onToggle,
}: {
  activities: Item[];
  open: boolean;
  onToggle: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: ACTIVITIES_PANEL_DROP_ID });

  if (!open) {
    return (
      <button
        onClick={onToggle}
        aria-label="Show activities list"
        data-testid="activities-panel-expand"
        className="mt-1 flex shrink-0 flex-col items-center gap-2 rounded-xl border border-border bg-card px-1.5 py-3 text-muted-foreground hover:text-foreground"
      >
        <ChevronsRight className="h-4 w-4" />
        <span className="[writing-mode:vertical-lr] text-xs font-medium">Activities</span>
      </button>
    );
  }

  return (
    <div
      ref={setNodeRef}
      data-testid="activities-drag-panel"
      className={`w-64 shrink-0 space-y-2 rounded-2xl border p-3 shadow-soft transition-colors ${
        isOver ? "border-primary bg-primary/5" : "border-border bg-card"
      }`}
    >
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm font-semibold">Activities</h3>
        <button
          onClick={onToggle}
          aria-label="Hide activities list"
          data-testid="activities-panel-collapse"
          className="text-muted-foreground hover:text-foreground"
        >
          <ChevronsLeft className="h-4 w-4" />
        </button>
      </div>
      <p className="text-xs text-muted-foreground">Drag onto a day to schedule.</p>
      <div className="max-h-[540px] space-y-1.5 overflow-y-auto">
        {activities.length === 0 && (
          <p className="py-4 text-center text-xs text-muted-foreground">No activities yet.</p>
        )}
        {activities.map((a) => (
          <ActivityListRow key={a.id} item={a} />
        ))}
      </div>
    </div>
  );
}

function ActivityListRow({ item }: { item: Item }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `${LIST_ID_PREFIX}${item.id}`,
  });
  const Icon = ICONS[item.kind as keyof typeof ICONS] ?? Coffee;
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ transform: transform ? CSS.Translate.toString(transform) : undefined }}
      data-testid="activities-panel-row"
      className={`flex cursor-grab items-center gap-2 rounded-lg border border-border bg-background p-2 text-sm touch-none active:cursor-grabbing ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />
      <span className="flex-1 truncate">{item.title}</span>
      {item.day_index != null ? (
        <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
          Day {item.day_index + 1}
        </span>
      ) : (
        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          Unscheduled
        </span>
      )}
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

function SortableRow({
  item,
  onRemove,
  onPinTime,
}: {
  item: Item;
  onRemove: (item: Item) => void;
  onPinTime: (item: Item, hhmm: string | null) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "opacity-40" : undefined}
    >
      <ItemRow
        item={item}
        onRemove={onRemove}
        onPinTime={onPinTime}
        handleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}

/** "2026-08-17T09:00:00.000Z" -> "09:00", for the pin-time input's initial value. */
function hhmmFromTimestamp(ts: string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function ItemRow({
  item,
  onRemove,
  onPinTime,
  handleProps,
  dragging,
}: {
  item: Item;
  onRemove?: (item: Item) => void;
  onPinTime?: (item: Item, hhmm: string | null) => void;
  handleProps?: Record<string, unknown>;
  dragging?: boolean;
}) {
  const Icon = ICONS[item.kind as keyof typeof ICONS] ?? Coffee;
  const time = formatClockUTC(item.start_time);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinValue, setPinValue] = useState(() => hhmmFromTimestamp(item.start_time));
  const isActivity = item.kind === "activity";
  return (
    <div
      className={`group flex items-center gap-2 rounded-lg border border-border bg-background p-3 ${
        dragging ? "shadow-card" : ""
      }`}
    >
      <button
        {...handleProps}
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
        title="Drag to reorder or move day"
        aria-label={`Reorder ${item.title}`}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <Icon className="h-4 w-4 shrink-0 text-primary" />
      <p className="flex-1 truncate font-medium">{item.title}</p>
      {onPinTime && (
        <Popover
          open={pinOpen}
          onOpenChange={(open) => {
            setPinOpen(open);
            if (open) setPinValue(hhmmFromTimestamp(item.start_time));
          }}
        >
          <PopoverTrigger asChild>
            <button
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                time
                  ? "border-primary/30 bg-primary/5 text-primary"
                  : "border-border text-muted-foreground opacity-0 group-hover:opacity-100"
              }`}
              data-testid="pin-time-trigger"
              aria-label={time ? `Arrival time ${time}` : `Set arrival time for ${item.title}`}
            >
              <Clock className="h-3 w-3" />
              {time ?? "Set time"}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-56" align="end">
            <p className="mb-2 text-xs text-muted-foreground">Planned arrival time</p>
            <div className="flex gap-2">
              <Input
                type="time"
                value={pinValue}
                onChange={(e) => setPinValue(e.target.value)}
                className="h-8"
                data-testid="pin-time-input"
              />
              <Button
                size="sm"
                onClick={() => {
                  onPinTime(item, pinValue || null);
                  setPinOpen(false);
                }}
                disabled={!pinValue}
              >
                Set
              </Button>
            </div>
            {time && (
              <button
                className="mt-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  onPinTime(item, null);
                  setPinOpen(false);
                }}
              >
                Clear time
              </button>
            )}
          </PopoverContent>
        </Popover>
      )}
      {onRemove && (
        <button
          onClick={() => onRemove(item)}
          className="opacity-0 group-hover:opacity-100"
          title={isActivity ? "Move back to your activities list" : "Remove"}
          aria-label={isActivity ? `Unschedule ${item.title}` : `Remove ${item.title}`}
        >
          {isActivity ? (
            <Undo2 className="h-4 w-4 text-muted-foreground hover:text-foreground" />
          ) : (
            <X className="h-4 w-4 text-muted-foreground hover:text-destructive" />
          )}
        </button>
      )}
    </div>
  );
}
