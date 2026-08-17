import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { listTripActivity } from "@/lib/trips.functions";
import { describeActivity, relativeTime } from "@/lib/activity-format";
import type { TripActivityRow } from "@/hooks/use-trip-realtime";

interface Props {
  tripId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Recent changes to this trip (B3). Deliberately a short scrollback of the last
 * 50 entries, not an audit system — its job is "what did I miss while I was
 * away", for anyone who wasn't looking when the toast appeared.
 *
 * Stays live without polling: the trip's realtime subscription invalidates
 * `["trip-activity", tripId]` whenever a new row arrives.
 */
export function ActivityFeedDialog({ tripId, open, onOpenChange }: Props) {
  const listFn = useServerFn(listTripActivity);
  const q = useQuery({
    queryKey: ["trip-activity", tripId],
    queryFn: () => listFn({ data: { trip_id: tripId } }),
    enabled: open,
  });

  const rows = (q.data?.activity ?? []) as unknown as TripActivityRow[];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" /> Recent changes
          </DialogTitle>
          <DialogDescription>What's happened on this trip lately, newest first.</DialogDescription>
        </DialogHeader>

        {q.isLoading && <div className="h-24 animate-pulse rounded-xl bg-muted/40" />}

        {!q.isLoading && rows.length === 0 && (
          <p
            className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground"
            data-testid="activity-feed-empty"
          >
            No changes recorded yet. Edits you and your collaborators make will show up here.
          </p>
        )}

        <ul className="space-y-2" data-testid="activity-feed-list">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card p-3"
              data-testid="activity-feed-row"
            >
              <span className="text-sm">{describeActivity(row)}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {relativeTime(row.created_at)}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

export function ActivityFeedButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick} data-testid="activity-feed-btn">
      <History className="mr-1 h-4 w-4" /> Activity
    </Button>
  );
}
