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
  Clock,
  ChevronsLeft,
  ChevronsRight,
  Undo2,
} from "lucide-react";
import {
  formatLeg,
  useActivityDistances,
  useDayLegs,
  type ActivityDistanceResult,
} from "@/hooks/use-activity-distances";
import type { ActivityDistance } from "@/lib/travel.functions";
import { committedItems, coordsOf, formatClockUTC, isBookedLodging } from "@/lib/workspace-store";
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

interface Props {
  tripId: string;
  items: Item[];
  numDays: number;
  startDate: string | null;
  /** Pin (or clear, with `hhmm: null`) a single activity's arrival time. */
  onPinTime: (item: Item, hhmm: string | null) => void;
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
   * `moved` describes what the traveler actually dragged, so the caller can
   * name it in the activity-feed entry without re-deriving it. `fromDay` is
   * null when the drag scheduled a previously-staged activity for the first
   * time.
   */
  onReorder: (
    moves: ItemMove[],
    moved?: { id: string; fromDay: number | null; toDay: number },
  ) => void;
  /**
   * The reference map and distance list, rendered full-width beneath the day
   * row. Takes no day index: it shows every activity on the trip, so it is
   * deliberately independent of which day tab is selected.
   */
  renderMapPanel: () => React.ReactNode;
}

export function ItineraryPanel({
  tripId,
  items,
  numDays,
  startDate,
  onPinTime,
  renderMapPanel,
  onAdd,
  onRemove,
  onReorder,
}: Props) {
  const [blockDay, setBlockDay] = useState<number | null>(null);
  const [blockTitle, setBlockTitle] = useState("");
  const [dragging, setDragging] = useState<Item | null>(null);
  const [activitiesOpen, setActivitiesOpen] = useState(true);
  const [selectedDayRaw, setSelectedDayRaw] = useState(0);

  // Lodging still under comparison never reaches the itinerary; staged
  // activities are excluded from day grouping but still show in the
  // activities panel below.
  const scheduled = committedItems(items);
  const allActivities = items
    .filter((i) => i.kind === "activity")
    .sort((a, b) => (a.day_index ?? -1) - (b.day_index ?? -1));

  // "N mi from stay" for the activities panel. Same query the map panel's table
  // uses — the hook's key is id-sorted, so the differing sort order here does
  // not split it into a second request.
  const bookedLodging = items.find(isBookedLodging) ?? null;
  const fromStay = useActivityDistances(tripId, allActivities, bookedLodging);

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
  const setSelectedDay = (d: number) => setSelectedDayRaw(d);

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
        {/* One column now: activities + day schedule on top, the trip-wide
            reference map and distance list full-width beneath. The fixed
            210px sidebar track that used to sit alongside existed only for
            the AI chat. */}
        <div className="space-y-4">
          <div className="flex items-start gap-4">
            <ActivitiesDragPanel
              activities={allActivities}
              fromStay={fromStay}
              open={activitiesOpen}
              onToggle={() => setActivitiesOpen((o) => !o)}
            />

            <div className="min-w-0 flex-1 space-y-4">
              {/* Day tabs double as drop targets so an item can still be moved
                    to a day that isn't currently shown — otherwise switching to
                    a day-at-a-time view would remove the only way to drag
                    across days. */}
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

              {[selectedDay].map((dayIdx) => {
                const dayItems = byDay.get(dayIdx) ?? [];
                const date = startDate
                  ? new Date(new Date(startDate).getTime() + dayIdx * 86400000).toLocaleDateString(
                      undefined,
                      {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      },
                    )
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
                        Nothing scheduled. Add a block above, or drag an activity here.
                      </p>
                    )}

                    <DayTimeline
                      tripId={tripId}
                      dayItems={dayItems}
                      dragging={dragging != null}
                      onRemove={onRemove}
                      onPinTime={onPinTime}
                    />
                  </DayColumn>
                );
              })}
            </div>
          </div>

          {/* Reference map + distance list, full width. Rendered once, outside
              the selected-day branch above — it shows the whole trip's
              activities, not the selected day's. */}
          <div data-testid="activity-map-row">{renderMapPanel()}</div>
        </div>

        <DragOverlay>{dragging ? <ItemRow item={dragging} dragging /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}

function ActivitiesDragPanel({
  activities,
  fromStay,
  open,
  onToggle,
}: {
  activities: Item[];
  fromStay: ActivityDistanceResult;
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
          <ActivityListRow key={a.id} item={a} fromStay={fromStay.byId.get(a.id) ?? null} />
        ))}
      </div>
    </div>
  );
}

function ActivityListRow({ item, fromStay }: { item: Item; fromStay: ActivityDistance | null }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `${LIST_ID_PREFIX}${item.id}`,
  });
  const Icon = ICONS[item.kind as keyof typeof ICONS] ?? Coffee;
  // Distance from the booked stay — NOT this activity's leg in any day's
  // sequence. The two are different measurements; see use-activity-distances.
  const distance = fromStay ? formatLeg(fromStay.miles, fromStay.hours) : null;
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ transform: transform ? CSS.Translate.toString(transform) : undefined }}
      data-testid="activities-panel-row"
      className={`cursor-grab rounded-lg border border-border bg-background p-2 text-sm touch-none active:cursor-grabbing ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <div className="flex items-center gap-2">
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
      {/* Omitted entirely with no stay booked, no coordinates, or still
          loading — the panel is narrow and every row is a drag target, so a
          placeholder dash would cost height for nothing. */}
      {distance && (
        <p
          className="mt-1 flex items-center gap-1 pl-[1.375rem] text-[10px] text-muted-foreground"
          data-testid="activity-from-stay"
        >
          <Car className="h-2.5 w-2.5 shrink-0" />
          {distance} from stay
          {fromStay?.straight_line ? "*" : ""}
        </p>
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

/** Horizontal offset of the rail from the column's left edge. */
const RAIL_X = "0.5rem";

/**
 * A segment of the spine. Drawn per row rather than as one absolutely
 * positioned line spanning the whole timeline: the spine has to start at the
 * first node's centre and end at the last node's centre, and a single line can
 * only guess where those land once row heights vary (a pinned time chip, a
 * wrapped title). Segments are exact at any height.
 *
 * It also handles dragging for free — leg rows unmount mid-drag, so the
 * remaining row segments become adjacent and the spine stays continuous.
 */
function RailSegment({ from = "0", to = "0" }: { from?: string; to?: string }) {
  return (
    <span
      aria-hidden
      className="absolute w-0.5 -translate-x-1/2 bg-muted-foreground/25"
      style={{ left: RAIL_X, top: from, bottom: to }}
    />
  );
}

/**
 * The day's stops as a vertical timeline: a spine down the left, a node per
 * stop, and the driving leg between each consecutive pair sitting on the rail
 * *between* the two cards it connects.
 *
 * Putting the number between the cards is the point — a distance rendered
 * inside a card reads as a property of that stop, when it actually describes
 * the trip from the previous one.
 *
 * A leg is only drawn when BOTH ends have coordinates. A stop without them
 * keeps its node (hollow) and the spine runs past it unbroken, but its two
 * adjacent gaps read "no location" rather than bridging a number across it —
 * a bridged figure would sit next to a stop it never measured from.
 */
function DayTimeline({
  tripId,
  dayItems,
  dragging,
  onRemove,
  onPinTime,
}: {
  tripId: string;
  dayItems: Item[];
  dragging: boolean;
  onRemove: (item: Item) => void;
  onPinTime: (item: Item, hhmm: string | null) => void;
}) {
  const legs = useDayLegs(tripId, dayItems);
  if (dayItems.length === 0) return null;

  return (
    <SortableContext items={dayItems.map((i) => i.id)} strategy={verticalListSortingStrategy}>
      <div className="relative" data-testid="day-timeline">
        {dayItems.map((it, idx) => {
          const next = dayItems[idx + 1];
          const leg = next ? legs.legBetween(it.id, next.id) : null;
          const bothLocated =
            next != null && coordsOf(it.details) != null && coordsOf(next.details) != null;
          return (
            <div key={it.id}>
              <SortableRow
                item={it}
                located={coordsOf(it.details) != null}
                isFirst={idx === 0}
                isLast={idx === dayItems.length - 1}
                onRemove={onRemove}
                onPinTime={onPinTime}
              />
              {/* Legs are plain, non-sortable rows interleaved between the
                  sortable ones, so dnd-kit's registry is untouched. They're
                  hidden mid-drag: cards translate but these don't, so leaving
                  them up would point numbers at the wrong pairs. */}
              {next && !dragging && (
                <div
                  className="relative flex items-center gap-1.5 py-1.5 text-xs text-muted-foreground"
                  style={{ paddingLeft: `calc(${RAIL_X} + 1.25rem)` }}
                  data-testid="day-leg"
                >
                  <RailSegment />
                  {bothLocated && leg ? (
                    <>
                      <Car className="h-3.5 w-3.5 shrink-0" />
                      <span>
                        {formatLeg(leg.miles, leg.hours)}
                        {leg.straight_line ? "*" : ""}
                      </span>
                    </>
                  ) : (
                    <span className="italic opacity-70" data-testid="day-leg-unknown">
                      no location
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </SortableContext>
  );
}

/**
 * The rail's node vocabulary, in decreasing prominence:
 *
 * - **solid, largest** — the booked stay, which anchors the day it sits on
 * - **hollow, grey ring** — an ordinary stop
 * - **hollow, faded** — a stop with no coordinates
 *
 * The faded step exists because hollow-grey is the *ordinary* stop here, so
 * "we don't know where this is" needed its own treatment rather than reusing
 * it. The node is only a hint; the explicit signal is the "no location" text
 * on both gaps beside it.
 */
function SortableRow({
  item,
  located,
  isFirst,
  isLast,
  onRemove,
  onPinTime,
}: {
  item: Item;
  located: boolean;
  isFirst: boolean;
  isLast: boolean;
  onRemove: (item: Item) => void;
  onPinTime: (item: Item, hhmm: string | null) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const isStay = isBookedLodging(item);
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`relative ${isDragging ? "opacity-40" : ""}`}
    >
      {/* Spine halves, omitted at the ends so the rail begins and finishes on
          a node rather than overshooting the list. */}
      {!isFirst && <RailSegment to="50%" />}
      {!isLast && <RailSegment from="50%" />}
      <span
        aria-hidden
        className={`absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full ${
          isStay
            ? "h-3.5 w-3.5 border-2 border-primary bg-primary"
            : // The ring is deliberately darker than --border (which is nearly
              // white): at that lightness the hollow node barely read at all,
              // and the faded variant below vanished outright.
              `h-3 w-3 border-2 border-muted-foreground/45 bg-card ${located ? "" : "opacity-40"}`
        }`}
        style={{ left: RAIL_X }}
        data-testid={isStay ? "rail-node-stay" : located ? "rail-node" : "rail-node-unlocated"}
      />
      <div style={{ paddingLeft: `calc(${RAIL_X} + 1.25rem)` }}>
        <ItemRow
          item={item}
          onRemove={onRemove}
          onPinTime={onPinTime}
          handleProps={{ ...attributes, ...listeners }}
        />
      </div>
      {isFirst && isStay && <span className="sr-only">Start of the day</span>}
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
