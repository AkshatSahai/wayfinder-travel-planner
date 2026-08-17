import type { TripActivityRow } from "@/hooks/use-trip-realtime";

/**
 * Plain-English phrasing for one activity row. Shared by the toast (B2) and the
 * feed panel (B3) so the same event never gets described two different ways.
 */

/** The actor's label, denormalised into `details` at write time. */
export function actorLabel(row: TripActivityRow): string {
  const email = row.details?.actor_email;
  if (typeof email !== "string" || !email) return "A collaborator";
  // Emails are what we have; the local part reads better than the full address
  // in a toast, and collaborators already see each other's addresses in Share.
  const local = email.split("@")[0];
  return local.length > 0 ? local : email;
}

const VERB: Record<string, string> = {
  added: "added",
  removed: "removed",
  moved: "moved",
  updated: "updated",
};

export function describeActivity(row: TripActivityRow): string {
  const who = actorLabel(row);
  const verb = VERB[row.action] ?? row.action;
  const what = row.item_name?.trim();
  const where = row.item_type?.trim();

  if (!what) return `${who} ${verb} something on this trip`;
  return where ? `${who} ${verb} ${what} (${where})` : `${who} ${verb} ${what}`;
}

/** Compact relative time for feed rows — "just now", "4m ago", "2h ago". */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
