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
});

const tripUpdateSchema = tripInsertSchema.extend({ id: z.string().uuid() });

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
  .inputValidator((d: unknown) => itemInsertSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("trip_items")
      .insert({ ...data, user_id: context.userId })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { item: row };
  });

export const removeTripItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("trip_items").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateTripItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        day_index: z.number().int().nullable().optional(),
        start_time: z.string().nullable().optional(),
        end_time: z.string().nullable().optional(),
        title: z.string().max(300).optional(),
        subtitle: z.string().max(500).nullable().optional(),
        cost_cents: z.number().int().optional(),
        sort_order: z.number().int().optional(),
      })
      .parse(d),
  )
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
