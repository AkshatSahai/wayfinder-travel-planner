-- Reverts 20260817010000_day_start_times.sql. The manual per-day start time
-- field was simplified away — the day map/route calculations never depended
-- on it (only AI guidance-note text did), and it added a manual-timing
-- control the itinerary is moving away from.
ALTER TABLE public.trips DROP COLUMN IF EXISTS day_start_times;
