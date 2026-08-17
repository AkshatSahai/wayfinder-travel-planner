-- Per-day start time for the itinerary timing fix (v0.6.0). Keyed by day
-- index ("0", "1", ...) -> "HH:MM". Feeds drive-time/route guidance for that
-- day only; never written onto individual trip_items rows.
ALTER TABLE public.trips ADD COLUMN day_start_times JSONB;
