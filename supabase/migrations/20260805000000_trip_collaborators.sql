-- Trip collaboration: invite-link based sharing with a single non-owner
-- role ("editor" — full read/write, cannot delete the trip or manage other
-- collaborators). Phase 1 only: refresh-to-see-changes, no realtime/presence.

CREATE TABLE public.trip_collaborators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('editor')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (trip_id, user_id)
);
CREATE INDEX trip_collaborators_trip_idx ON public.trip_collaborators(trip_id);
CREATE INDEX trip_collaborators_user_idx ON public.trip_collaborators(user_id);

CREATE TABLE public.trip_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('editor')),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX trip_invites_trip_idx ON public.trip_invites(trip_id);
CREATE INDEX trip_invites_token_idx ON public.trip_invites(token);

-- Membership check, used by RLS policies below. LANGUAGE sql validates its
-- body against the catalog at creation time, so both tables above must exist
-- first. SECURITY DEFINER avoids RLS-policy recursion (trips policy ->
-- trip_collaborators policy -> trips policy ...) by running this check
-- outside RLS entirely.
CREATE OR REPLACE FUNCTION public.is_trip_member(_trip_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.trips t WHERE t.id = _trip_id AND t.user_id = _user_id)
      OR EXISTS (SELECT 1 FROM public.trip_collaborators c WHERE c.trip_id = _trip_id AND c.user_id = _user_id);
$$;

GRANT SELECT, DELETE ON public.trip_collaborators TO authenticated;
GRANT ALL ON public.trip_collaborators TO service_role;
ALTER TABLE public.trip_collaborators ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trip_collaborators_select" ON public.trip_collaborators FOR SELECT
  USING (public.is_trip_member(trip_id, auth.uid()));

-- No INSERT policy for `authenticated` on purpose: rows are only created by
-- redeemInvite via the service-role client, so collaborators can't add
-- themselves except through a valid invite token.
CREATE POLICY "trip_collaborators_delete" ON public.trip_collaborators FOR DELETE
  USING (user_id = auth.uid()
      OR EXISTS (SELECT 1 FROM public.trips t WHERE t.id = trip_id AND t.user_id = auth.uid()));

GRANT SELECT, INSERT, UPDATE ON public.trip_invites TO authenticated;
GRANT ALL ON public.trip_invites TO service_role;
ALTER TABLE public.trip_invites ENABLE ROW LEVEL SECURITY;

-- Owner-only visibility/management. Redemption bypasses these entirely via
-- supabaseAdmin (the invitee has no row access to trip_invites yet).
CREATE POLICY "trip_invites_select" ON public.trip_invites FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.trips t WHERE t.id = trip_id AND t.user_id = auth.uid()));
CREATE POLICY "trip_invites_insert" ON public.trip_invites FOR INSERT
  WITH CHECK (created_by = auth.uid()
      AND EXISTS (SELECT 1 FROM public.trips t WHERE t.id = trip_id AND t.user_id = auth.uid()));
CREATE POLICY "trip_invites_update" ON public.trip_invites FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.trips t WHERE t.id = trip_id AND t.user_id = auth.uid()));

-- Rewrite trips/trip_items RLS: membership-based instead of sole-owner.
--
-- trips_select/trips_update deliberately do NOT call is_trip_member() here,
-- unlike trip_items below. is_trip_member() re-queries `trips` internally,
-- and Postgres RLS's implicit SELECT-policy check on INSERT ... RETURNING
-- runs within the same statement as the insert — a row is not yet visible
-- to a *separate* sub-query against the same table until the statement
-- completes. That made createTrip's `.insert(...).select().single()` (one
-- INSERT ... RETURNING statement) fail with "new row violates row-level
-- security policy", even though a plain, later SELECT worked fine. Checking
-- ownership inline (`auth.uid() = user_id`, no subquery) sidesteps this —
-- only the collaborator check subqueries a *different* table
-- (trip_collaborators), which was never the table being written to, so it
-- has no such visibility problem.
DROP POLICY "Users manage own trips" ON public.trips;
CREATE POLICY "trips_select" ON public.trips FOR SELECT
  USING (auth.uid() = user_id
      OR EXISTS (SELECT 1 FROM public.trip_collaborators c WHERE c.trip_id = id AND c.user_id = auth.uid()));
CREATE POLICY "trips_insert" ON public.trips FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "trips_update" ON public.trips FOR UPDATE
  USING (auth.uid() = user_id
      OR EXISTS (SELECT 1 FROM public.trip_collaborators c WHERE c.trip_id = id AND c.user_id = auth.uid()))
  WITH CHECK (auth.uid() = user_id
      OR EXISTS (SELECT 1 FROM public.trip_collaborators c WHERE c.trip_id = id AND c.user_id = auth.uid()));
CREATE POLICY "trips_delete" ON public.trips FOR DELETE USING (auth.uid() = user_id);
-- Only the owner can delete the trip; collaborators cannot.

DROP POLICY "Users manage own trip items" ON public.trip_items;
-- trip_items.user_id remains creator provenance only, not an RLS key, post-rewrite.
CREATE POLICY "trip_items_all" ON public.trip_items FOR ALL
  USING (public.is_trip_member(trip_id, auth.uid())) WITH CHECK (public.is_trip_member(trip_id, auth.uid()));
