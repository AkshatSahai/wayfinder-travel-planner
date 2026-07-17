import { useState } from "react";
import { Wallet, Sparkles, AlertTriangle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/workspace-store";
import type { Tables } from "@/integrations/supabase/types";

type Item = Tables<"trip_items">;

interface Tip {
  kind: string;
  message: string;
  severity: "info" | "warn";
}

interface Props {
  items: Item[];
  budgetCents: number | null;
  currency: string | null;
  onEditBudget: (cents: number) => void;
  tips: Tip[] | undefined;
  onRefreshTips: () => void;
  tipsLoading: boolean;
}

export function BudgetRail({
  items,
  budgetCents,
  currency,
  onEditBudget,
  tips,
  onRefreshTips,
  tipsLoading,
}: Props) {
  const total = items.reduce((s, i) => s + (i.cost_cents ?? 0), 0);
  const byKind = items.reduce(
    (m, i) => {
      const k = i.kind;
      m[k] = (m[k] ?? 0) + (i.cost_cents ?? 0);
      return m;
    },
    {} as Record<string, number>,
  );
  const overBudget = budgetCents ? total > budgetCents : false;
  const pct = budgetCents ? Math.min(100, Math.round((total / budgetCents) * 100)) : 0;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(budgetCents ? String(budgetCents / 100) : "");

  return (
    <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
      <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Wallet className="h-4 w-4 text-primary" /> Budget
        </div>
        <div className="mt-2 font-display text-3xl font-semibold">
          {formatMoney(total, currency ?? "USD")}
        </div>
        {budgetCents ? (
          <>
            <div className="mt-1 text-xs text-muted-foreground">
              of {formatMoney(budgetCents, currency ?? "USD")}
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full transition-all ${overBudget ? "bg-destructive" : "bg-primary"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            {overBudget ? (
              <p className="mt-2 flex items-center gap-1 text-xs text-destructive">
                <AlertTriangle className="h-3 w-3" />
                Over budget by {formatMoney(total - budgetCents)}
              </p>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                {formatMoney(budgetCents - total)} remaining
              </p>
            )}
          </>
        ) : (
          <div className="mt-2 rounded-lg bg-warning/10 p-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Note:</span> set a budget so you can track
            expenses and finances easily.
          </div>
        )}

        {!editing ? (
          <button
            onClick={() => setEditing(true)}
            className="mt-2 text-xs text-primary hover:underline"
          >
            Edit budget
          </button>
        ) : (
          <div className="mt-2 flex gap-2">
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

        <div className="mt-4 space-y-1 text-sm">
          {(["lodging", "transport", "activity", "block"] as const).map((k) => (
            <div key={k} className="flex justify-between capitalize">
              <span className="text-muted-foreground">{k}</span>
              <span>{formatMoney(byKind[k] ?? 0)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-accent-foreground" />
            AI tips
          </div>
          <Button size="sm" variant="ghost" onClick={onRefreshTips} disabled={tipsLoading}>
            {tipsLoading ? "…" : "Refresh"}
          </Button>
        </div>
        {!tips && !tipsLoading && (
          <p className="mt-2 text-xs text-muted-foreground">
            Refresh to get contextual advice on pacing, weather, and budget.
          </p>
        )}
        {tips && tips.length === 0 && (
          <p className="mt-2 text-xs text-muted-foreground">Looks solid so far.</p>
        )}
        <div className="mt-3 space-y-2">
          {tips?.map((t, i) => (
            <div
              key={i}
              className={`flex gap-2 rounded-lg p-2 text-xs ${t.severity === "warn" ? "bg-warning/10" : "bg-muted/40"}`}
            >
              {t.severity === "warn" ? (
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning-foreground" />
              ) : (
                <Info className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
              )}
              <p>{t.message}</p>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
