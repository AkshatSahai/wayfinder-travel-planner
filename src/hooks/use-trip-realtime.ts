import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * Live sync for one trip (v0.5.0 B1–B3).
 *
 * Subscribes to `postgres_changes` for the currently-open trip and nothing else,
 * so a workspace never receives another trip's traffic.
 *
 * Three things here are load-bearing and easy to get wrong:
 *
 * 1. `realtime.setAuth(token)` MUST be called before subscribing. The socket
 *    authenticates separately from PostgREST; without it, RLS-protected
 *    postgres_changes deliver nothing at all even when the tables are correctly
 *    published. The failure is silent — the channel still reports SUBSCRIBED.
 * 2. The token must be re-applied when Supabase rotates it, or a long-lived tab
 *    quietly stops receiving events partway through a session.
 * 3. The channel must be removed on unmount / trip change, or switching trips
 *    leaks subscriptions and every later change triggers N refetches.
 *
 * Row changes are debounced: one drag rewrites several rows and Postgres emits
 * an event per row, but the traveler performed one action and needs one refetch.
 * Activity events are NOT debounced — each is a distinct thing someone did.
 */
export interface TripActivityRow {
  id: string;
  trip_id: string;
  actor_id: string;
  action: string;
  item_type: string | null;
  item_name: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

interface Options {
  tripId: string;
  /** Any change to the trip or its items — already debounced. */
  onTripChanged: () => void;
  /** A new activity row, including ones this user caused; callers filter. */
  onActivity?: (row: TripActivityRow) => void;
  /** Test/diagnostic hook: fires for every raw event before debouncing. */
  onRawEvent?: (table: string, eventType: string) => void;
}

const CHANGE_DEBOUNCE_MS = 250;

export function useTripRealtime({ tripId, onTripChanged, onActivity, onRawEvent }: Options) {
  // Keep callbacks in refs so a re-render with new closures doesn't tear down
  // and rebuild the subscription — resubscribing on every render would drop
  // events in the gap.
  const changedRef = useRef(onTripChanged);
  const activityRef = useRef(onActivity);
  const rawRef = useRef(onRawEvent);
  changedRef.current = onTripChanged;
  activityRef.current = onActivity;
  rawRef.current = onRawEvent;

  useEffect(() => {
    if (!tripId) return;
    let channel: RealtimeChannel | null = null;
    let disposed = false;
    let debounce: ReturnType<typeof setTimeout> | null = null;

    const scheduleChanged = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => changedRef.current(), CHANGE_DEBOUNCE_MS);
    };

    const applyToken = async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) await supabase.realtime.setAuth(token);
    };

    (async () => {
      await applyToken();
      if (disposed) return;

      channel = supabase
        .channel(`trip:${tripId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "trip_items", filter: `trip_id=eq.${tripId}` },
          (payload) => {
            rawRef.current?.("trip_items", payload.eventType);
            scheduleChanged();
          },
        )
        .on(
          "postgres_changes",
          // The trip row itself carries budget, dates, destination and title.
          { event: "*", schema: "public", table: "trips", filter: `id=eq.${tripId}` },
          (payload) => {
            rawRef.current?.("trips", payload.eventType);
            scheduleChanged();
          },
        )
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "trip_activity",
            filter: `trip_id=eq.${tripId}`,
          },
          (payload) => {
            rawRef.current?.("trip_activity", payload.eventType);
            activityRef.current?.(payload.new as TripActivityRow);
          },
        )
        .subscribe();
    })();

    // Supabase rotates access tokens; the socket keeps whichever token it was
    // given, so without this a tab silently goes deaf after a refresh.
    const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === "TOKEN_REFRESHED" || event === "SIGNED_IN") && session?.access_token) {
        void supabase.realtime.setAuth(session.access_token);
      }
    });

    return () => {
      disposed = true;
      if (debounce) clearTimeout(debounce);
      authSub.subscription.unsubscribe();
      if (channel) void supabase.removeChannel(channel);
    };
  }, [tripId]);
}
