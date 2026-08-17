-- Part B groundwork: publish trip tables to Supabase Realtime, and add the
-- append-only activity feed behind B3.
--
-- Applied by hand in the Supabase SQL editor (see context.md §3 — DDL can't run
-- with only a publishable key). Written to be safe to re-run: getting an RLS
-- migration right here has historically taken several rounds, and a script that
-- fails on line 2 with "already a member of publication" wastes one of them.
--
-- NOTE: the SQL editor runs a multi-statement script as a single implicit
-- transaction, so a failure anywhere rolls the whole thing back. That's why a
-- partially-applied state generally isn't a concern, but the guards below cost
-- nothing and remove the doubt.

-- ============================================================
-- 1. Realtime on the existing trip tables
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'trip_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.trip_items;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'trips'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.trips;
  END IF;
END $$;

-- REPLICA IDENTITY FULL makes DELETE payloads carry the whole old row. With the
-- default, a delete event carries only the primary key — so a notification like
-- "Sarah removed the boat tour" would have no title to name. Costs extra WAL on
-- every update; accepted deliberately for these two tables.
ALTER TABLE public.trip_items REPLICA IDENTITY FULL;
ALTER TABLE public.trips      REPLICA IDENTITY FULL;

-- ============================================================
-- 2. Activity feed (B3)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.trip_activity (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id    UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  -- ON DELETE CASCADE matches every other auth.users FK in this schema. Without
  -- it, deleting a user who had ever touched a trip fails on the FK — which
  -- would break the routine cleanup of verification accounts.
  actor_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action     TEXT NOT NULL CHECK (action IN ('added', 'removed', 'moved', 'updated')),
  item_type  TEXT,
  item_name  TEXT,
  details    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The feed always reads "most recent N for this trip".
CREATE INDEX IF NOT EXISTS trip_activity_feed_idx
  ON public.trip_activity (trip_id, created_at DESC);

-- RLS decides WHICH rows a role may touch; GRANT decides whether it may touch
-- the table at all. Omitting the GRANT is a silent trap: the policies look
-- correct and every request still fails with "permission denied for table".
-- SELECT + INSERT only — the feed is append-only, so nothing edits or deletes
-- history, and there are deliberately no UPDATE/DELETE policies below. Rows go
-- away only through the trip's ON DELETE CASCADE.
GRANT SELECT, INSERT ON public.trip_activity TO authenticated;
GRANT ALL            ON public.trip_activity TO service_role;

ALTER TABLE public.trip_activity ENABLE ROW LEVEL SECURITY;

-- Reuse is_trip_member() rather than re-deriving membership with a UNION over
-- trips + trip_collaborators. It is SECURITY DEFINER, so it runs outside RLS and
-- cannot recurse, and it never queries trip_activity — the same reason it is
-- safe for trip_items policies. A hand-rolled subquery against `trips` would be
-- evaluated under trips' own SELECT policy, which is exactly the shape that
-- produced two production bugs in the v0.4.0 migration (see context.md §3).
DROP POLICY IF EXISTS "trip_activity_select" ON public.trip_activity;
CREATE POLICY "trip_activity_select" ON public.trip_activity FOR SELECT
  USING (public.is_trip_member(trip_id, auth.uid()));

-- `actor_id = auth.uid()` is not optional. Without it any trip member could
-- insert entries attributed to a different collaborator, and a feed whose whole
-- purpose is "who did what" would be unable to vouch for the "who".
DROP POLICY IF EXISTS "trip_activity_insert" ON public.trip_activity;
CREATE POLICY "trip_activity_insert" ON public.trip_activity FOR INSERT
  WITH CHECK (
    public.is_trip_member(trip_id, auth.uid())
    AND actor_id = auth.uid()
  );

-- ============================================================
-- 3. Realtime on the feed itself
-- ============================================================

-- REPLICA IDENTITY stays DEFAULT here: the table is insert-only, and INSERT
-- payloads already carry the full new row, so FULL would be pure WAL overhead.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'trip_activity'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.trip_activity;
  END IF;
END $$;
