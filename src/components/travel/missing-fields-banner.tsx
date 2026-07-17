import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

type Trip = Tables<"trips">;

type ParsedParams = { origin?: string | null; parse_failed?: boolean } & Record<string, unknown>;

export function MissingFieldsBanner({
  trip,
  onSave,
}: {
  trip: Trip;
  onSave: (patch: Partial<Trip>) => void;
}) {
  const parsed = (trip.parsed_params ?? {}) as ParsedParams;

  const [destination, setDestination] = useState(trip.destination ?? "");
  const [origin, setOrigin] = useState(parsed.origin ?? "");
  const [start, setStart] = useState(trip.start_date ?? "");
  const [end, setEnd] = useState(trip.end_date ?? "");
  const [budget, setBudget] = useState(trip.budget_cents ? String(trip.budget_cents / 100) : "");
  const [party, setParty] = useState(trip.party_size ? String(trip.party_size) : "2");

  const needsDestination = !trip.destination;
  const needsOrigin = !parsed.origin;
  const needsDates = !trip.start_date || !trip.end_date;
  const needsBudget = !trip.budget_cents;
  const parseFailed = parsed.parse_failed === true;

  if (!needsDestination && !needsOrigin && !needsDates && !needsBudget) return null;

  const save = () => {
    const patch: Partial<Trip> = {};
    if (needsDestination && destination.trim()) {
      patch.destination = destination.trim();
      patch.title = destination.trim();
    }
    if (needsDates && start && end) {
      patch.start_date = start;
      patch.end_date = end;
    }
    if (needsBudget && budget) patch.budget_cents = Math.round(Number(budget) * 100);
    const partyNum = Number(party);
    if (partyNum >= 1 && partyNum !== trip.party_size) patch.party_size = Math.round(partyNum);
    if (needsOrigin && origin.trim()) {
      patch.parsed_params = { ...parsed, origin: origin.trim(), parse_failed: false };
    } else if (parseFailed && Object.keys(patch).length > 0) {
      patch.parsed_params = { ...parsed, parse_failed: false };
    }
    onSave(patch);
  };

  return (
    <div className="mb-4 rounded-xl border border-warning/40 bg-warning/10 p-4">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 text-warning-foreground" />
        <div className="flex-1">
          <p className="font-medium">
            {parseFailed ? "We couldn't read your prompt" : "A few missing details"}
          </p>
          <p className="text-sm text-muted-foreground">
            {parseFailed
              ? "The AI parser hit an error, so nothing was extracted. Fill in your trip details below to get live prices."
              : "These unlock live flights, hotels, and events for your dates."}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {needsDestination && (
              <div>
                <Label htmlFor="dest">Destination</Label>
                <Input
                  id="dest"
                  placeholder="e.g. Traverse City, MI"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                />
              </div>
            )}
            {needsOrigin && (
              <div>
                <Label htmlFor="orig">Leaving from</Label>
                <Input
                  id="orig"
                  placeholder="e.g. Chicago, IL"
                  value={origin}
                  onChange={(e) => setOrigin(e.target.value)}
                />
              </div>
            )}
            {needsDates && (
              <>
                <div>
                  <Label htmlFor="s">Start</Label>
                  <Input
                    id="s"
                    type="date"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="e">End</Label>
                  <Input id="e" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
                </div>
              </>
            )}
            {needsBudget && (
              <div>
                <Label htmlFor="b">Budget (USD)</Label>
                <Input
                  id="b"
                  type="number"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  placeholder="3500"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Note: set a budget so you can track expenses easily.
                </p>
              </div>
            )}
            <div>
              <Label htmlFor="p">Travelers</Label>
              <Input
                id="p"
                type="number"
                min="1"
                value={party}
                onChange={(e) => setParty(e.target.value)}
              />
            </div>
          </div>
          <Button size="sm" className="mt-3" onClick={save}>
            Save details
          </Button>
        </div>
      </div>
    </div>
  );
}
