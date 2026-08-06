import { randomBytes } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const createInviteLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ trip_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: existing, error: findErr } = await context.supabase
      .from("trip_invites")
      .select("token")
      .eq("trip_id", data.trip_id)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (findErr) throw new Error(findErr.message);
    if (existing) return { token: existing.token };

    const token = randomBytes(24).toString("base64url");
    const { error: insErr } = await context.supabase.from("trip_invites").insert({
      trip_id: data.trip_id,
      token,
      created_by: context.userId,
    });
    if (insErr) throw new Error(insErr.message);
    return { token };
  });

export const revokeInviteLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ trip_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("trip_invites")
      .update({ revoked_at: new Date().toISOString() })
      .eq("trip_id", data.trip_id)
      .is("revoked_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listCollaborators = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ trip_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: trip, error: tripErr } = await context.supabase
      .from("trips")
      .select("user_id")
      .eq("id", data.trip_id)
      .single();
    if (tripErr) throw new Error(tripErr.message);

    const { data: rows, error: rowsErr } = await context.supabase
      .from("trip_collaborators")
      .select("id,user_id,role,created_at")
      .eq("trip_id", data.trip_id)
      .order("created_at");
    if (rowsErr) throw new Error(rowsErr.message);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const emailFor = async (userId: string) => {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(userId);
      return u?.user?.email ?? null;
    };

    const owner = { user_id: trip.user_id, email: await emailFor(trip.user_id) };
    const collaborators = await Promise.all(
      (rows ?? []).map(async (r) => ({ ...r, email: await emailFor(r.user_id) })),
    );

    return { owner, collaborators };
  });

export const removeCollaborator = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("trip_collaborators").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const redeemInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ trip_id: z.string().uuid(), token: z.string().min(10) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: invite, error: inviteErr } = await supabaseAdmin
      .from("trip_invites")
      .select("id,trip_id,revoked_at")
      .eq("trip_id", data.trip_id)
      .eq("token", data.token)
      .maybeSingle();
    if (inviteErr) throw new Error(inviteErr.message);
    if (!invite || invite.revoked_at) {
      // TEMP DIAGNOSTIC — remove once redemption is confirmed working. Never
      // logs the key itself, only whether admin-only calls succeed with it.
      const keyLen = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").length;
      let adminCheck = "unknown";
      try {
        const { error: listErr } = await supabaseAdmin.auth.admin.listUsers({
          page: 1,
          perPage: 1,
        });
        adminCheck = listErr ? `admin-call-failed: ${listErr.message}` : "admin-call-ok";
      } catch (e) {
        adminCheck = `admin-call-threw: ${e instanceof Error ? e.message : String(e)}`;
      }
      const { count: rawCount } = await supabaseAdmin
        .from("trip_invites")
        .select("*", { count: "exact", head: true });
      throw new Error(
        `DEBUG no-invite-found trip_id=${data.trip_id} token_len=${data.token.length} ` +
          `key_len=${keyLen} admin_check=${adminCheck} total_invite_rows=${rawCount}`,
      );
    }

    const { error: upsertErr } = await supabaseAdmin
      .from("trip_collaborators")
      .upsert(
        { trip_id: data.trip_id, user_id: context.userId, role: "editor" },
        { onConflict: "trip_id,user_id" },
      );
    if (upsertErr) throw new Error(upsertErr.message);

    return { trip_id: data.trip_id };
  });
