import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const tripInsertSchema = z.object({
  title: z.string().max(200).optional(),
  raw_prompt: z.string().max(4000).optional(),
  parsed_params: z.any().optional(),
  destination: z.string().max(200).nullable().optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  party_size: z.number().int().nullable().optional(),
  budget_cents: z.number().int().nullable().optional(),
  currency: z.string().max(8).optional(),
  // Per-day itinerary start time, keyed by day index ("0", "1", ...) -> "HH:MM".
  // Feeds drive-time guidance for that day only — never written onto items.
  day_start_times: z.record(z.string(), z.string()).nullable().optional(),
});

const tripUpdateSchema = tripInsertSchema.extend({ id: z.string().uuid() });

/**
 * Optional description of what the traveler actually did, logged to
 * `trip_activity` for the notification toast (B2) and the change feed (B3).
 *
 * Deliberately per-INTENT, not per-row. One drag or one AI build-out rewrites
 * many rows; logging each would produce a dozen toasts and an unreadable feed.
 * Callers doing internal bookkeeping (renumbering a day, applying a plan) simply
 * omit it.
 */
const activitySchema = z.object({
  trip_id: z.string().uuid(),
  action: z.enum(["added", "removed", "moved", "updated"]),
  item_type: z.string().max(60).nullable().optional(),
  item_name: z.string().max(300).nullable().optional(),
});

type ActivityIntent = z.infer<typeof activitySchema>;

type AuthedContext = {
  supabase: {
    from: (table: string) => {
      insert: (values: unknown) => Promise<{ error: { message: string } | null }>;
    };
  };
  userId: string;
  claims?: Record<string, unknown>;
};

/**
 * Fire-and-forget. An audit trail must never be able to fail the edit it is
 * describing, so a logging failure is reported to the server console and
 * swallowed rather than thrown.
 *
 * Uses the caller's own supabase client, so `auth.uid()` satisfies the RLS
 * check that pins `actor_id` — a forged actor is rejected by the database, not
 * by trust in this function.
 */
async function logActivity(context: AuthedContext, intent: ActivityIntent | undefined) {
  if (!intent) return;
  try {
    const email = typeof context.claims?.email === "string" ? context.claims.email : null;
    const { error } = await context.supabase.from("trip_activity").insert({
      trip_id: intent.trip_id,
      actor_id: context.userId,
      action: intent.action,
      item_type: intent.item_type ?? null,
      item_name: intent.item_name ?? null,
      // Denormalised so the feed and toasts need no admin lookup per row.
      details: email ? { actor_email: email } : null,
    });
    if (error) console.error("[activity] insert failed:", error.message);
  } catch (err) {
    console.error("[activity] insert threw:", err);
  }
}

const itemInsertSchema = z.object({
  trip_id: z.string().uuid(),
  kind: z.enum(["lodging", "transport", "activity", "block"]),
  category: z.string().max(60).nullable().optional(),
  day_index: z.number().int().nullable().optional(),
  start_time: z.string().nullable().optional(),
  end_time: z.string().nullable().optional(),
  title: z.string().max(300),
  subtitle: z.string().max(500).nullable().optional(),
  details: z.any().optional(),
  cost_cents: z.number().int().default(0),
  source_url: z.string().max(1000).nullable().optional(),
  sort_order: z.number().int().default(0),
});

export const listTrips = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("trips")
      .select("id,title,destination,start_date,end_date,budget_cents,currency,created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { trips: data ?? [] };
  });

export const createTrip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => tripInsertSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("trips")
      .insert({ ...data, user_id: context.userId })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { trip: row };
  });

export const updateTrip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => tripUpdateSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { error: updErr } = await context.supabase.from("trips").update(patch).eq("id", id);
    if (updErr) throw new Error(updErr.message);
    const { data: row, error: selErr } = await context.supabase
      .from("trips")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (selErr) throw new Error(selErr.message);
    if (!row) throw new Error("Trip not found");
    return { trip: row };
  });

export const deleteTrip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("trips").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getTrip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const [{ data: trip, error: e1 }, { data: items, error: e2 }] = await Promise.all([
      context.supabase.from("trips").select("*").eq("id", data.id).single(),
      context.supabase
        .from("trip_items")
        .select("*")
        .eq("trip_id", data.id)
        .order("day_index")
        .order("sort_order"),
    ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);
    return { trip, items: items ?? [] };
  });

export const addTripItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    itemInsertSchema.extend({ activity: activitySchema.optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { activity, ...item } = data;
    const { data: row, error } = await context.supabase
      .from("trip_items")
      .insert({ ...item, user_id: context.userId })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    await logActivity(context as unknown as AuthedContext, activity);
    return { item: row };
  });

export const removeTripItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), activity: activitySchema.optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("trip_items").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await logActivity(context as unknown as AuthedContext, data.activity);
    return { ok: true };
  });

const itemPatchSchema = z.object({
  id: z.string().uuid(),
  category: z.string().max(60).nullable().optional(),
  day_index: z.number().int().nullable().optional(),
  start_time: z.string().nullable().optional(),
  end_time: z.string().nullable().optional(),
  title: z.string().max(300).optional(),
  subtitle: z.string().max(500).nullable().optional(),
  // `details` is writable so enrichment (a looked-up address, coordinates, a
  // duration estimate) can be persisted back onto the activity rather than
  // being used once and thrown away.
  details: z.any().optional(),
  cost_cents: z.number().int().optional(),
  sort_order: z.number().int().optional(),
});

export const updateTripItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => itemPatchSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { data: row, error } = await context.supabase
      .from("trip_items")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { item: row };
  });

/**
 * Apply many item patches in one request. Building an itinerary re-days every
 * staged activity at once, which as N separate round trips is both slow and
 * partially-applicable if one fails midway. Patches still run as individual
 * UPDATEs (they have differing columns) but share a single request and a single
 * RLS-authenticated context.
 */
export const updateTripItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        patches: z.array(itemPatchSchema).max(200),
        activity: activitySchema.optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const results = await Promise.all(
      data.patches.map(async ({ id, ...patch }) => {
        const { error } = await context.supabase.from("trip_items").update(patch).eq("id", id);
        return error ? { id, error: error.message } : { id, error: null };
      }),
    );
    const failed = results.filter((r) => r.error);
    if (failed.length === results.length && failed.length > 0) {
      throw new Error(`No items could be updated: ${failed[0].error}`);
    }
    // One entry for the whole batch — this is exactly the case that would
    // otherwise emit a dozen near-identical notifications for one drag.
    await logActivity(context as unknown as AuthedContext, data.activity);
    return { updated: results.length - failed.length, failed };
  });

/** Newest-first change feed for one trip. RLS restricts it to trip members. */
export const listTripActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ trip_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("trip_activity")
      .select("id,trip_id,actor_id,action,item_type,item_name,details,created_at")
      .eq("trip_id", data.trip_id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return { activity: rows ?? [] };
  });
