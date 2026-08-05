import { useState } from "react";
import { MapPin, CalendarRange, Users, Wallet, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatMoney, committedItems } from "@/lib/workspace-store";
import type { Tables } from "@/integrations/supabase/types";

type Trip = Tables<"trips">;
type Item = Tables<"trip_items">;

function Chip({
  icon: Icon,
  children,
  title,
}: {
  icon: typeof MapPin;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium shadow-soft"
    >
      <Icon className="h-3.5 w-3.5 text-primary" />
      {children}
    </span>
  );
}

export function TripMetaBar({
  trip,
  items,
  onEditBudget,
}: {
  trip: Trip;
  items: Item[];
  onEditBudget: (cents: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="trip-meta-bar">
      <Chip icon={MapPin} title="Destination">
        {trip.destination ?? "No destination yet"}
      </Chip>
      <Chip icon={CalendarRange} title="Dates">
        {trip.start_date && trip.end_date ? `${trip.start_date} → ${trip.end_date}` : "Dates TBD"}
      </Chip>
      <Chip icon={Users} title="Travelers">
        {trip.party_size ?? 1} traveler{(trip.party_size ?? 1) === 1 ? "" : "s"}
      </Chip>
      <BudgetChip trip={trip} items={items} onEditBudget={onEditBudget} />
    </div>
  );
}

/**
 * Live spend/total chip. Replaces the old right-rail budget card — it sits in
 * the meta bar so it stays visible on every tab. The category breakdown and
 * the edit field live in its popover rather than a permanent panel.
 */
function BudgetChip({
  trip,
  items,
  onEditBudget,
}: {
  trip: Trip;
  items: Item[];
  onEditBudget: (cents: number) => void;
}) {
  const currency = trip.currency ?? "USD";
  const budgetCents = trip.budget_cents;

  // Lodging still in comparison isn't committed spend, so it stays out.
  const counted = committedItems(items);
  const total = counted.reduce((s, i) => s + (i.cost_cents ?? 0), 0);
  const byKind = counted.reduce(
    (m, i) => {
      m[i.kind] = (m[i.kind] ?? 0) + (i.cost_cents ?? 0);
      return m;
    },
    {} as Record<string, number>,
  );

  const overBudget = budgetCents ? total > budgetCents : false;
  const pct = budgetCents ? Math.min(100, Math.round((total / budgetCents) * 100)) : 0;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(budgetCents ? String(budgetCents / 100) : "");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          data-testid="budget-chip"
          title="Budget"
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium shadow-soft transition-colors ${
            overBudget
              ? "border-destructive/50 bg-destructive/10 text-destructive"
              : "border-border bg-card hover:border-primary"
          }`}
        >
          {overBudget ? (
            <AlertTriangle className="h-3.5 w-3.5" />
          ) : (
            <Wallet className="h-3.5 w-3.5 text-primary" />
          )}
          {formatMoney(total, currency)}
          <span className="text-muted-foreground">
            {budgetCents ? ` / ${formatMoney(budgetCents, currency)}` : " · no budget"}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Wallet className="h-4 w-4 text-primary" /> Budget
        </div>

        {budgetCents ? (
          <>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full transition-all ${overBudget ? "bg-destructive" : "bg-primary"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p
              className={`mt-2 text-xs ${overBudget ? "text-destructive" : "text-muted-foreground"}`}
            >
              {overBudget
                ? `Over budget by ${formatMoney(total - budgetCents, currency)}`
                : `${formatMoney(budgetCents - total, currency)} remaining`}
            </p>
          </>
        ) : (
          <p className="mt-2 rounded-lg bg-warning/10 p-2 text-xs text-muted-foreground">
            Set a budget to track spend against a target.
          </p>
        )}

        <div className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
          {(["lodging", "transport", "activity", "block"] as const).map((k) => (
            <div key={k} className="flex justify-between capitalize">
              <span className="text-muted-foreground">{k}</span>
              <span>{formatMoney(byKind[k] ?? 0, currency)}</span>
            </div>
          ))}
        </div>

        {!editing ? (
          <button
            onClick={() => setEditing(true)}
            className="mt-3 text-xs text-primary hover:underline"
          >
            Edit budget
          </button>
        ) : (
          <div className="mt-3 flex gap-2">
            <Input
              type="number"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="3500"
            />
            <Button
              size="sm"
              onClick={() => {
                if (draft) {
                  onEditBudget(Math.round(Number(draft) * 100));
                  setEditing(false);
                }
              }}
            >
              Save
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
