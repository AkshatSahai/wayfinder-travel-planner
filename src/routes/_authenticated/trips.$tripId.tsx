import { createFileRoute, getRouteApi, Link, notFound } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { ChevronLeft, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";

import {
  getTrip,
  updateTrip,
  addTripItem,
  removeTripItem,
  updateTripItem,
  updateTripItems,
} from "@/lib/trips.functions";
import { useTripRealtime } from "@/hooks/use-trip-realtime";
import { describeActivity } from "@/lib/activity-format";
import { ActivityFeedDialog, ActivityFeedButton } from "@/components/travel/activity-feed-dialog";
import {
  buildItinerary,
  chatItinerary,
  adviseItineraryChange,
  type ItineraryOp,
} from "@/lib/trip-ai.functions";
import { assessDay, averageDayCost, checkArrivalConflict } from "@/lib/itinerary-advice";
import {
  daysBetween,
  committedItems,
  isBookedLodging,
  isLodgingCandidate,
  isStagedActivity,
  minutesFromClock,
  minutesFromTimestamp,
  renumberDay,
  stagedActivities,
  timestampFor,
  LODGING_BOOKED,
  LODGING_CANDIDATE,
  type LatLng,
  type OrderableRow,
} from "@/lib/workspace-store";
import { AppSidebar, type WorkspaceTab } from "@/components/shell/app-sidebar";
import { TripMetaBar } from "@/components/shell/trip-meta-bar";

import { TripDetailsPanel } from "@/components/travel/trip-details-panel";
import { LodgingPanel } from "@/components/travel/lodging-panel";
import { TransportPanel } from "@/components/travel/transport-panel";
import { ActivitiesPanel } from "@/components/travel/activities-panel";
import { ItineraryPanel, type ItemMove } from "@/components/travel/itinerary-panel";
import { ItineraryDayPanel } from "@/components/travel/itinerary-day-panel";
import { MissingFieldsBanner } from "@/components/travel/missing-fields-banner";
import { ShareTripDialog } from "@/components/travel/share-trip-dialog";
import type { ParsedTrip } from "@/components/travel/destination-picker-dialog";
import type { Tables } from "@/integrations/supabase/types";

type Item = Tables<"trip_items">;

const authRoute = getRouteApi("/_authenticated");

/** Advisor calls allowed per page session, so a long editing spree can't run up a bill. */
const ADVISOR_CALL_BUDGET = 8;

export type AdviceNote = { day: number; itemId: string; note: string };

export type ChatMessage = { role: "user" | "assistant"; content: string };

type ChatEnrichment = {
  title: string;
  location: string | null;
  coords: { lat: number; lng: number } | null;
};

type ChatPatch = {
  id: string;
  day_index?: number;
  sort_order?: number;
  start_time?: string | null;
};

/**
 * Everything needed to put the itinerary back exactly as it was before a chat
 * edit: prior positions of every row touched, ids of anything created, and full
 * copies of anything deleted.
 */
type UndoSnapshot = {
  positions: {
    id: string;
    day_index: number | null;
    sort_order: number;
    start_time: string | null;
  }[];
  added: string[];
  removed: {
    kind: "lodging" | "transport" | "activity" | "block";
    category: string | null;
    day_index: number | null;
    title: string;
    subtitle: string | null;
    details: Record<string, unknown>;
    cost_cents: number;
    source_url: string | null;
    sort_order: number;
  }[];
};

const TABS = ["details", "lodging", "transport", "activities", "itinerary"] as const;

export const Route = createFileRoute("/_authenticated/trips/$tripId")({
  // `.catch` keeps links to the retired ?tab=destination working — unknown
  // tabs fall through to the dashboard rather than throwing.
  validateSearch: (s) => z.object({ tab: z.enum(TABS).optional().catch(undefined) }).parse(s),
  head: ({ params }) => ({
    meta: [
      { title: `Trip ${params.tripId.slice(0, 8)} — Wayfinder` },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: WorkspacePage,
});

function WorkspacePage() {
  const { tripId } = Route.useParams();
  const { tab: tabParam } = Route.useSearch();
  const navigate = Route.useNavigate();
  const tab: WorkspaceTab = tabParam ?? "details";
  const setTab = (t: WorkspaceTab) => navigate({ search: { tab: t }, replace: true });
  const { user } = authRoute.useRouteContext();
  const [shareOpen, setShareOpen] = useState(false);
  const [feedOpen, setFeedOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  // At most one advisor note is ever visible — see runAdvisor for the rest of
  // the anti-nag rules.
  const [advice, setAdvice] = useState<AdviceNote | null>(null);
  const advisorCallsRef = useRef(0);
  const lastAdvisedRef = useRef<string | null>(null);
  const dismissedRef = useRef<Set<string>>(new Set());

  const qc = useQueryClient();
  const getFn = useServerFn(getTrip);
  const updateFn = useServerFn(updateTrip);
  const addFn = useServerFn(addTripItem);
  const removeFn = useServerFn(removeTripItem);
  const updateItemFn = useServerFn(updateTripItem);
  const updateItemsFn = useServerFn(updateTripItems);
  const buildFn = useServerFn(buildItinerary);
  const chatFn = useServerFn(chatItinerary);
  const adviseFn = useServerFn(adviseItineraryChange);

  const { data, isLoading, error } = useQuery({
    queryKey: ["trip", tripId],
    queryFn: () => getFn({ data: { id: tripId } }),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["trip", tripId] });

  // Live sync + collaborator notifications. Everything funnels through the same
  // invalidate() chokepoint the mutations already use — realtime is a new
  // *trigger* for refreshing, not a second way of doing it.
  useTripRealtime({
    tripId,
    onTripChanged: invalidate,
    onActivity: (row) => {
      // Never tell someone about their own edit. This is the whole reason
      // notifications read trip_activity rather than trip_items: an item row's
      // user_id is creator provenance, so it cannot say who made *this* change.
      if (row.actor_id === user.id) return;
      qc.invalidateQueries({ queryKey: ["trip-activity", tripId] });
      toast(describeActivity(row), { duration: 6000 });
    },
  });

  const updateMut = useMutation({
    mutationFn: (patch: Record<string, unknown>) => updateFn({ data: { id: tripId, ...patch } }),
    onSuccess: invalidate,
  });

  type NewItem = {
    trip_id: string;
    kind: "lodging" | "transport" | "activity" | "block";
    category?: string | null;
    day_index?: number | null;
    start_time?: string | null;
    end_time?: string | null;
    title: string;
    subtitle?: string | null;
    details?: Record<string, unknown>;
    cost_cents: number;
    source_url?: string | null;
    sort_order?: number;
  };
  const addMut = useMutation({
    mutationFn: (item: NewItem) =>
      addFn({
        data: {
          ...item,
          activity: {
            trip_id: tripId,
            action: "added" as const,
            item_type: item.kind,
            item_name: item.title,
          },
        },
      }),
    onSuccess: (_res, item) => {
      invalidate();
      // Three destinations, three different messages — telling someone their
      // activity was "added to itinerary" when it was staged is exactly the
      // confusion this release is fixing.
      if (item.category === LODGING_CANDIDATE) toast.success("Added to comparison");
      else if (isStagedActivity(item)) toast.success("Added to your activities");
      else toast.success("Added to itinerary");
    },
  });

  const removeMut = useMutation({
    mutationFn: (id: string) =>
      removeFn({
        data: {
          id,
          activity: {
            trip_id: tripId,
            action: "removed" as const,
            item_type: data?.items.find((i) => i.id === id)?.kind ?? null,
            // Capture the title before the row is gone — the feed entry has to
            // outlive the thing it describes.
            item_name: data?.items.find((i) => i.id === id)?.title ?? null,
          },
        },
      }),
    onSuccess: invalidate,
  });

  // Booking is exclusive: the chosen stay becomes the itinerary's lodging block
  // and any previously booked stay drops back into the comparison list.
  const bookMut = useMutation({
    mutationFn: async (id: string) => {
      const previouslyBooked = (data?.items ?? []).filter((i) => isBookedLodging(i) && i.id !== id);
      await Promise.all([
        updateItemFn({ data: { id, category: LODGING_BOOKED } }),
        ...previouslyBooked.map((i) =>
          updateItemFn({ data: { id: i.id, category: LODGING_CANDIDATE } }),
        ),
      ]);
    },
    onSuccess: () => {
      invalidate();
      toast.success("Booked — added to your itinerary and budget");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // "Build out itinerary": AI schedules every staged activity onto a day, and
  // any location/coords it had to look up are written back onto the activity
  // rather than used once and discarded.
  const buildMut = useMutation({
    mutationFn: async () => {
      const trip = data!.trip;
      const parsedP = (trip.parsed_params ?? {}) as Record<string, unknown>;
      const staging = stagedActivities(data!.items);
      if (staging.length === 0) throw new Error("Add at least one activity first.");

      const booked = (data!.items ?? []).find(isBookedLodging);
      const bookedDetails = (booked?.details ?? {}) as Record<string, unknown>;
      // Undated trips have no real day count; fall back to something modest
      // rather than one day per activity, which would produce a 50-day trip.
      const days = daysBetween(trip.start_date, trip.end_date) || Math.min(staging.length, 7);

      const res = await buildFn({
        data: {
          destination: trip.destination ?? "",
          origin: (parsedP.origin as string) ?? null,
          start_date: trip.start_date,
          end_date: trip.end_date,
          num_days: Math.max(1, days),
          lodging: booked ? ((bookedDetails.location as string) ?? booked.title) : null,
          activities: staging.map((a) => {
            const d = (a.details ?? {}) as Record<string, unknown>;
            const coords = (d.coords ?? null) as { lat: number; lng: number } | null;
            return {
              id: a.id,
              title: a.title,
              category: a.category,
              cost_cents: a.cost_cents ?? 0,
              location: (d.location as string) ?? null,
              duration_hours: (d.duration_hours as number) ?? null,
              preferred_date: (d.preferred_date as string) ?? null,
              lat: coords?.lat ?? null,
              lng: coords?.lng ?? null,
            };
          }),
        },
      });
      if (res.error) throw new Error(res.error);

      const enrichById = new Map(res.enrichments.map((e) => [e.id, e]));
      const detailsById = new Map(
        staging.map((a) => [a.id, (a.details ?? {}) as Record<string, unknown>]),
      );

      const assignedIds = new Set(res.assignments.map((a) => a.id));
      const affectedDays = new Set(res.assignments.map((a) => a.day_index));

      // The planner only sees staged activities, so it numbers sort_order from 0
      // and would collide with whatever is already on that day (including the
      // booked stay). Renumbering each touched day is shared with the chat
      // editor — see renumberDay in workspace-store. Ordering is by position
      // only: the AI no longer assigns clock times, so `minutes` stays null for
      // every row here and renumberDay falls back to `prior` (the AI's own
      // sequence for new rows, the existing sort_order for old ones) — a
      // manually pinned time (set separately, per item) is never touched by a
      // rebuild.
      const rowsByDay = new Map<number, (OrderableRow & { isNew: boolean; day: number })[]>();
      for (const day of affectedDays) rowsByDay.set(day, []);

      for (const a of res.assignments) {
        rowsByDay.get(a.day_index)!.push({
          id: a.id,
          day: a.day_index,
          minutes: null,
          prior: a.sort_order,
          isNew: true,
        });
      }
      for (const item of data!.items) {
        if (assignedIds.has(item.id)) continue;
        if (isLodgingCandidate(item) || isStagedActivity(item)) continue;
        if (item.day_index == null || !affectedDays.has(item.day_index)) continue;
        rowsByDay.get(item.day_index)!.push({
          id: item.id,
          day: item.day_index,
          minutes: null,
          prior: item.sort_order ?? 0,
          isNew: false,
        });
      }

      const finalOrder = new Map<string, number>();
      for (const [, rows] of rowsByDay) {
        for (const [id, pos] of renumberDay(rows)) finalOrder.set(id, pos);
      }

      type ItemPatch = {
        id: string;
        day_index?: number;
        sort_order?: number;
        details?: Record<string, unknown>;
      };
      const patches: ItemPatch[] = res.assignments.map((a): ItemPatch => {
        const enrich = enrichById.get(a.id);
        const base = detailsById.get(a.id) ?? {};
        return {
          id: a.id,
          day_index: a.day_index,
          sort_order: finalOrder.get(a.id) ?? a.sort_order,
          details: {
            ...base,
            // Only fill what the activity was missing — never overwrite a
            // location or coords the traveler supplied.
            ...(enrich?.address && !base.location ? { location: enrich.address } : {}),
            ...(enrich?.coords && !base.coords ? { coords: enrich.coords } : {}),
            planner_reason: a.reason,
          },
        };
      });

      // Existing rows only need a patch when their position actually moved.
      for (const [, rows] of rowsByDay) {
        for (const r of rows) {
          if (r.isNew) continue;
          const next = finalOrder.get(r.id);
          if (next != null && next !== r.prior) patches.push({ id: r.id, sort_order: next });
        }
      }

      await updateItemsFn({ data: { patches } });
      return res;
    },
    onSuccess: (res) => {
      invalidate();
      setTab("itinerary");
      const enriched = res.enrichments.length;
      toast.success(
        `Itinerary built — ${res.assignments.length} activities scheduled` +
          (enriched ? `, ${enriched} location${enriched === 1 ? "" : "s"} looked up` : ""),
      );
      if (res.enrichment_error) toast.info(res.enrichment_error);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Itinerary chat: the model returns operations, which are applied here so the
  // plan changes deterministically. Every batch snapshots the rows it touches so
  // it can be undone — fuzzy name matching can resolve to the wrong row, and a
  // removal is otherwise unrecoverable.
  const applyOps = async (ops: ItineraryOp[], enrichments: ChatEnrichment[]) => {
    const trip = data!.trip;
    const numDays = Math.max(1, daysBetween(trip.start_date, trip.end_date) || 1);
    const live = data!.items.filter((i) => !isLodgingCandidate(i));
    const byId = new Map(live.map((i) => [i.id, i]));

    const undo: UndoSnapshot = { positions: [], added: [], removed: [] };
    const nextDay = new Map<string, number | null>();
    const removedIds = new Set<string>();

    for (const op of ops) {
      if (op.op === "remove" && op.id && byId.has(op.id)) {
        removedIds.add(op.id);
      } else if (op.op === "move" && op.id && byId.has(op.id) && op.day_index != null) {
        nextDay.set(op.id, op.day_index);
      } else if (op.op === "swap_days" && op.day_a != null && op.day_b != null) {
        // Everything on those days moves, not just activities — otherwise the
        // booked stay is left behind on the wrong day.
        for (const item of live) {
          if (item.day_index === op.day_a) nextDay.set(item.id, op.day_b);
          else if (item.day_index === op.day_b) nextDay.set(item.id, op.day_a);
        }
      }
    }

    // Snapshot before anything changes.
    for (const id of new Set([...nextDay.keys(), ...removedIds])) {
      const item = byId.get(id);
      if (item) {
        undo.positions.push({
          id,
          day_index: item.day_index,
          sort_order: item.sort_order ?? 0,
          start_time: item.start_time,
        });
      }
    }

    for (const id of removedIds) {
      const item = byId.get(id)!;
      undo.removed.push({
        kind: item.kind as NewItem["kind"],
        category: item.category,
        day_index: item.day_index,
        title: item.title,
        subtitle: item.subtitle,
        details: (item.details ?? {}) as Record<string, unknown>,
        cost_cents: item.cost_cents ?? 0,
        source_url: item.source_url,
        sort_order: item.sort_order ?? 0,
      });
      await removeFn({ data: { id } });
    }

    const createdRows: { id: string; day: number }[] = [];
    const enrichByTitle = new Map(enrichments.map((e) => [e.title.toLowerCase(), e]));
    for (const op of ops) {
      if (op.op !== "add" || !op.title) continue;
      const e = enrichByTitle.get(op.title.toLowerCase());
      const created = await addFn({
        data: {
          trip_id: tripId,
          kind: "activity",
          category: op.category ?? "Activity",
          day_index: op.day_index,
          title: op.title,
          cost_cents: op.cost_cents ?? 0,
          sort_order: 500,
          details: {
            ...(op.location || e?.location ? { location: e?.location ?? op.location } : {}),
            ...(e?.coords ? { coords: e.coords } : {}),
            planner_reason: "added from chat",
          },
        },
      });
      if (created?.item?.id) {
        undo.added.push(created.item.id);
        if (op.day_index != null) {
          nextDay.set(created.item.id, op.day_index);
          // Newly created rows aren't in `live`, so they must be fed into the
          // renumbering explicitly or they keep a placeholder position and
          // collide with whatever already sits at that spot.
          createdRows.push({ id: created.item.id, day: op.day_index });
        }
      }
    }

    // Rebuild each touched day so positions stay unique across every kind.
    const survivors = live.filter((i) => !removedIds.has(i.id));
    const dayOf = (i: (typeof survivors)[number]) =>
      nextDay.has(i.id) ? nextDay.get(i.id)! : i.day_index;
    const touched = new Set<number>();
    for (const [, d] of nextDay) if (d != null) touched.add(d);
    for (const s of undo.positions) if (s.day_index != null) touched.add(s.day_index);
    for (const c of createdRows) touched.add(c.day);

    const patches: ChatPatch[] = [];
    for (const day of touched) {
      if (day < 0 || day >= numDays) continue;
      // `minutes: null` for everything: chat only ever moves/adds/removes by
      // position now, never by clock time, so a manually pinned time (set
      // separately, per item) is never disturbed by a rebuild here.
      const rows: OrderableRow[] = survivors
        .filter((i) => dayOf(i) === day && !isStagedActivity({ ...i, day_index: dayOf(i) }))
        .map((i) => ({
          id: i.id,
          minutes: null,
          prior: i.sort_order ?? 0,
        }));
      // Freshly created rows have no prior position; park them at the end of
      // the day and let renumberDay give them a real one.
      for (const c of createdRows) {
        if (c.day === day) rows.push({ id: c.id, minutes: null, prior: Number.MAX_SAFE_INTEGER });
      }
      for (const [id, pos] of renumberDay(rows)) {
        patches.push({ id, day_index: day, sort_order: pos });
      }
    }
    // Rows whose day changed but whose new day had no other members.
    for (const [id, day] of nextDay) {
      if (patches.some((p) => p.id === id)) continue;
      patches.push({ id, day_index: day ?? undefined, sort_order: 0 });
    }

    if (patches.length > 0) await updateItemsFn({ data: { patches } });
    return undo;
  };

  const undoRef = useRef<UndoSnapshot | null>(null);

  const chatMut = useMutation({
    mutationFn: async (allMessages: ChatMessage[]) => {
      const trip = data!.trip;
      const numDays = Math.max(1, daysBetween(trip.start_date, trip.end_date) || 1);
      const res = await chatFn({
        data: {
          messages: allMessages,
          destination: trip.destination ?? "",
          start_date: trip.start_date,
          num_days: numDays,
          items: data!.items
            .filter((i) => !isLodgingCandidate(i))
            .map((i) => {
              const d = (i.details ?? {}) as Record<string, unknown>;
              const coords = (d.coords ?? null) as LatLng | null;
              return {
                id: i.id,
                kind: i.kind,
                title: i.title,
                day_index: i.day_index,
                sort_order: i.sort_order ?? 0,
                cost_cents: i.cost_cents ?? 0,
                location: (d.location as string) ?? null,
                start_time: i.start_time,
                lat: coords?.lat ?? null,
                lng: coords?.lng ?? null,
              };
            }),
        },
      });
      const undo =
        res.operations.length > 0 ? await applyOps(res.operations, res.enrichments) : null;
      return { ...res, undo };
    },
    onSuccess: (res) => {
      invalidate();
      setChatMessages((m) => [...m, { role: "assistant", content: res.reply }]);
      if (res.undo) {
        undoRef.current = res.undo;
        const n = res.operations.length;
        toast.success(`Updated your itinerary (${n} change${n === 1 ? "" : "s"})`, {
          action: { label: "Undo", onClick: () => undoMut.mutate() },
          duration: 8000,
        });
      }
    },
    onError: (err: Error) => {
      setChatMessages((m) => [...m, { role: "assistant", content: err.message }]);
      toast.error(err.message);
    },
  });

  const undoMut = useMutation({
    mutationFn: async () => {
      const snap = undoRef.current;
      if (!snap) return;
      for (const id of snap.added) await removeFn({ data: { id } });
      for (const r of snap.removed) await addFn({ data: { ...r, trip_id: tripId } });
      if (snap.positions.length > 0) {
        await updateItemsFn({
          data: {
            patches: snap.positions.map((p) => ({
              id: p.id,
              day_index: p.day_index,
              sort_order: p.sort_order,
              start_time: p.start_time,
            })),
          },
        });
      }
      undoRef.current = null;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Reverted");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const reorderMut = useMutation({
    // Batched so the whole drag logs ONE activity entry rather than one per
    // shifted row — a five-row day would otherwise fire five notifications.
    mutationFn: (payload: { moves: ItemMove[]; movedTitle: string | null }) =>
      updateItemsFn({
        data: {
          patches: payload.moves.map((m) => ({
            id: m.id,
            day_index: m.day_index,
            sort_order: m.sort_order,
          })),
          activity: {
            trip_id: tripId,
            action: "moved" as const,
            item_type: "itinerary",
            item_name: payload.movedTitle,
          },
        },
      }),
    onSuccess: invalidate,
    onError: (err: Error) => toast.error(err.message),
  });

  /**
   * "Remove from itinerary" for an activity: unschedule it (day_index -> null)
   * rather than delete it, so it returns to the staged list on the Activities
   * tab exactly like it started. Deleting an activity for good is still only
   * available from the Activities tab, which is the trip's master list.
   */
  const unscheduleMut = useMutation({
    mutationFn: (item: Item) =>
      updateItemFn({ data: { id: item.id, day_index: null, sort_order: 0 } }),
    onSuccess: () => {
      invalidate();
      toast.success("Moved back to your activities list");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  /**
   * Pin a single activity's arrival time — the one remaining write path for
   * `start_time`, now that the AI planner and chat only ever sequence by
   * position. Reuses the same lightweight, local pattern as the drag advisor
   * (`checkArrivalConflict`) rather than a second AI round trip: only surfaces
   * a note when the pin genuinely doesn't work given the day's other stops.
   */
  const pinTimeMut = useMutation({
    mutationFn: async (payload: { item: Item; hhmm: string | null }) => {
      const trip = data!.trip;
      const stamp = timestampFor(trip.start_date, payload.item.day_index ?? 0, payload.hhmm);
      await updateItemFn({ data: { id: payload.item.id, start_time: stamp } });
      return { item: payload.item, stamp };
    },
    onSuccess: ({ item, stamp }) => {
      invalidate();
      if (!stamp || item.day_index == null) return;

      const dayItems = committedItems(data!.items)
        .filter((i) => i.day_index === item.day_index)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((i) => {
          const d = (i.details ?? {}) as Record<string, unknown>;
          return {
            id: i.id,
            title: i.title,
            minutes:
              i.id === item.id ? minutesFromTimestamp(stamp) : minutesFromTimestamp(i.start_time),
            duration_hours: (d.duration_hours as number) ?? null,
            coords: (d.coords as LatLng) ?? null,
          };
        });

      const pinnedMinutes = minutesFromTimestamp(stamp);
      if (pinnedMinutes == null) return;
      const result = checkArrivalConflict(dayItems, item.id, pinnedMinutes);
      if (result.conflict && result.detail) {
        setAdvice({ day: item.day_index, itemId: item.id, note: result.detail });
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  /**
   * Second opinion on a manual drag. Deliberately fire-and-forget: it runs after
   * the reorder has already been persisted, never blocks or delays it, and any
   * failure is swallowed — an advisory feature must not turn a successful drag
   * into an error.
   */
  const runAdvisor = async (
    moves: ItemMove[],
    moved: { id: string; fromDay: number | null; toDay: number },
  ) => {
    const movedId = moved.id;
    if (advisorCallsRef.current >= ADVISOR_CALL_BUDGET) return;
    if (dismissedRef.current.has(movedId)) return;
    // Nudging about the same item on consecutive drags is the definition of naggy.
    if (lastAdvisedRef.current === movedId) return;

    // Assess the POST-drag arrangement. The query cache still holds pre-drag
    // state at this point (the reorder is only just being persisted), so the
    // moved item would not yet appear on its new day — project the moves over
    // the current items instead of waiting for a refetch. Excluding only
    // lodging candidates (not staged activities, unlike committedItems) so a
    // just-scheduled activity — previously staged, day_index null in cache —
    // is still picked up by the day filter below once its move is applied.
    const moveById = new Map(moves.map((m) => [m.id, m]));
    const projected = (data?.items ?? [])
      .filter((i) => !isLodgingCandidate(i))
      .map((i) => {
        const m = moveById.get(i.id);
        return m ? { ...i, day_index: m.day_index, sort_order: m.sort_order } : i;
      });

    const dayItems = projected
      .filter((i) => i.day_index === moved.toDay)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((i) => {
        const d = (i.details ?? {}) as Record<string, unknown>;
        return {
          id: i.id,
          title: i.title,
          category: i.category,
          cost_cents: i.cost_cents ?? 0,
          minutes: minutesFromTimestamp(i.start_time),
          duration_hours: (d.duration_hours as number) ?? null,
          coords: (d.coords as LatLng) ?? null,
        };
      });

    const signals = assessDay(dayItems, movedId, averageDayCost(projected));
    // The whole point of the local pass: no signal, no network call at all.
    if (signals.length === 0) return;

    advisorCallsRef.current += 1;
    lastAdvisedRef.current = movedId;
    try {
      const res = await adviseFn({
        data: {
          destination: data?.trip.destination ?? "",
          moved_title: dayItems.find((i) => i.id === movedId)?.title ?? "",
          from_day: moved.fromDay,
          to_day: moved.toDay,
          signals,
          day_summary: dayItems.map(
            (i) =>
              `${i.title}${i.minutes != null ? ` at ${String(Math.floor(i.minutes / 60)).padStart(2, "0")}:${String(i.minutes % 60).padStart(2, "0")}` : ""}` +
              `${i.cost_cents ? ` ($${Math.round(i.cost_cents / 100)})` : ""}`,
          ),
        },
      });
      if (res.surface && res.note) setAdvice({ day: moved.toDay, itemId: movedId, note: res.note });
    } catch (err) {
      // Advice is optional; the drag already succeeded.
      console.error("[advisor] skipped:", err);
    }
  };

  if (isLoading) return <div className="p-10 text-muted-foreground">Loading trip…</div>;
  if (error || !data?.trip) throw notFound();

  const { trip, items } = data;
  const parsed = (trip.parsed_params ?? {}) as Partial<ParsedTrip> & {
    entry_mode?: string;
    waypoints?: string[];
    origin_coords?: LatLng | null;
    destination_coords?: LatLng | null;
  };

  const numDays = daysBetween(trip.start_date, trip.end_date);
  // Only a confirmed destination counts — a parsed region stays unset.
  const destination = trip.destination ?? "";
  const origin = parsed.origin ?? "";
  const interests = parsed.interests ?? [];
  const waypoints = parsed.waypoints ?? [];
  const isManualTrip = parsed.entry_mode === "manual";
  const stays = items.filter((i) => i.kind === "lodging");
  // The Activities tab is the master list — scheduled rows included, labelled
  // with their day — so anything the itinerary chat adds is visible on both
  // tabs. `stagedActivities` still drives what "Build out itinerary" acts on.
  const allActivities = items.filter((i) => i.kind === "activity");
  const staged = stagedActivities(items);

  const parsedTrip: ParsedTrip = {
    destination: parsed.destination ?? null,
    destination_is_specific: parsed.destination_is_specific ?? false,
    region_hint: parsed.region_hint ?? null,
    origin: parsed.origin ?? null,
    start_date: parsed.start_date ?? null,
    end_date: parsed.end_date ?? null,
    party_size: parsed.party_size ?? null,
    travel_mode: parsed.travel_mode ?? null,
    interests,
    budget_cents: parsed.budget_cents ?? null,
    currency: parsed.currency ?? null,
    notes: parsed.notes ?? null,
    missing_fields: parsed.missing_fields ?? [],
  };

  const handleAdd = (item: Omit<NewItem, "trip_id">) => addMut.mutate({ ...item, trip_id: tripId });

  const updateWaypoints = (next: string[]) =>
    updateMut.mutate({ parsed_params: { ...parsed, waypoints: next } });

  return (
    <div className="flex min-h-screen bg-background max-lg:flex-col">
      <AppSidebar tab={tab} onNavigate={setTab} />

      <main className="min-w-0 flex-1 px-6 py-5">
        <div className="mx-auto max-w-7xl">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <TripMetaBar
              trip={trip}
              items={items}
              onEditBudget={(cents) => updateMut.mutate({ budget_cents: cents })}
            />
            <div className="flex items-center gap-3">
              <ActivityFeedButton onClick={() => setFeedOpen(true)} />
              {trip.user_id === user.id && (
                <Button variant="outline" size="sm" onClick={() => setShareOpen(true)}>
                  <Share2 className="mr-1 h-4 w-4" /> Share
                </Button>
              )}
              <Link
                to="/trips"
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="h-4 w-4" /> All trips
              </Link>
            </div>
          </div>

          <ShareTripDialog tripId={tripId} open={shareOpen} onOpenChange={setShareOpen} />
          <ActivityFeedDialog tripId={tripId} open={feedOpen} onOpenChange={setFeedOpen} />

          <MissingFieldsBanner trip={trip} onSave={(patch) => updateMut.mutate(patch)} />

          {tab === "details" && (
            <TripDetailsPanel
              parsed={parsedTrip}
              destination={destination}
              origin={origin}
              originCoords={parsed.origin_coords ?? null}
              destinationCoords={parsed.destination_coords ?? null}
              startDate={trip.start_date}
              endDate={trip.end_date}
              partySize={trip.party_size ?? 2}
              budgetCents={trip.budget_cents}
              waypoints={waypoints}
              items={items}
              onPick={(name) => updateMut.mutate({ destination: name, title: name })}
              onUpdateWaypoints={updateWaypoints}
            />
          )}

          {tab === "lodging" && (
            <LodgingPanel
              destination={destination}
              origin={origin}
              originCoords={parsed.origin_coords ?? null}
              startDate={trip.start_date}
              endDate={trip.end_date}
              partySize={trip.party_size ?? 2}
              interests={interests}
              budgetCents={trip.budget_cents}
              stays={stays}
              onAdd={(item) => handleAdd(item)}
              onBook={(id) => bookMut.mutate(id)}
              onRemove={(id) => removeMut.mutate(id)}
            />
          )}

          {tab === "transport" && (
            <TransportPanel
              origin={origin}
              destination={destination}
              mode={parsed.travel_mode ?? null}
              partySize={trip.party_size ?? 2}
              startDate={trip.start_date}
              endDate={trip.end_date}
              waypoints={waypoints}
              onAdd={(item) => handleAdd(item)}
            />
          )}

          {tab === "activities" && (
            <ActivitiesPanel
              destination={destination}
              interests={interests}
              startDate={trip.start_date}
              endDate={trip.end_date}
              partySize={trip.party_size ?? 2}
              activities={allActivities}
              unscheduledCount={staged.length}
              autoBrowse={!isManualTrip}
              onAdd={(item) => handleAdd(item)}
              onRemove={(id) => removeMut.mutate(id)}
              onBuildItinerary={() => buildMut.mutate()}
              building={buildMut.isPending}
            />
          )}

          {tab === "itinerary" && (
            <ItineraryPanel
              items={items}
              numDays={numDays}
              startDate={trip.start_date}
              onPinTime={(item, hhmm) => pinTimeMut.mutate({ item, hhmm })}
              chat={{
                messages: chatMessages,
                pending: chatMut.isPending,
                onSend: (text) => {
                  const next: ChatMessage[] = [...chatMessages, { role: "user", content: text }];
                  setChatMessages(next);
                  chatMut.mutate(next);
                },
              }}
              advice={advice}
              renderDayPanel={(dayIdx) => (
                <ItineraryDayPanel
                  tripId={tripId}
                  destination={destination}
                  dayIndex={dayIdx}
                  items={committedItems(items)
                    .filter((i) => i.day_index === dayIdx)
                    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))}
                />
              )}
              onDismissAdvice={() => {
                if (advice) dismissedRef.current.add(advice.itemId);
                setAdvice(null);
              }}
              onAdd={(item) => handleAdd(item)}
              onRemove={(item) =>
                item.kind === "activity" ? unscheduleMut.mutate(item) : removeMut.mutate(item.id)
              }
              onReorder={(moves, moved) => {
                reorderMut.mutate({
                  moves,
                  movedTitle: moved ? (items.find((i) => i.id === moved.id)?.title ?? null) : null,
                });
                // Deliberately not awaited: the drag is already persisting, and
                // advice must never gate or delay it.
                if (moved) void runAdvisor(moves, moved);
              }}
            />
          )}
        </div>
      </main>
    </div>
  );
}
