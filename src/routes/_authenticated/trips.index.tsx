import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Compass, LogOut, Plus, MapPin, Calendar, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { listTrips, deleteTrip } from "@/lib/trips.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/workspace-store";

export const Route = createFileRoute("/_authenticated/trips/")({
  head: () => ({
    meta: [{ title: "My trips — Wayfinder" }, { name: "robots", content: "noindex" }],
  }),
  component: TripsPage,
});

function TripsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const listFn = useServerFn(listTrips);
  const delFn = useServerFn(deleteTrip);

  const { data, isLoading } = useQuery({
    queryKey: ["trips"],
    queryFn: () => listFn(),
  });

  const del = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trips"] });
      toast.success("Trip deleted");
    },
  });

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/", replace: true });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2 font-display text-xl font-semibold">
            <Compass className="h-6 w-6 text-primary" /> Wayfinder
          </Link>
          <Button variant="ghost" size="sm" onClick={signOut}>
            <LogOut className="mr-1 h-4 w-4" /> Sign out
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="font-display text-3xl font-semibold">Your trips</h1>
          <Link to="/">
            <Button>
              <Plus className="mr-1 h-4 w-4" /> New trip
            </Button>
          </Link>
        </div>

        {isLoading && <p className="text-muted-foreground">Loading…</p>}

        {data && data.trips.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border p-12 text-center">
            <p className="text-muted-foreground">No trips yet.</p>
            <Link to="/">
              <Button className="mt-4">Plan your first trip</Button>
            </Link>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data?.trips.map((t) => (
            <div
              key={t.id}
              className="group relative rounded-2xl border border-border bg-card p-5 shadow-soft transition-shadow hover:shadow-glow"
            >
              <Link to="/trips/$tripId" params={{ tripId: t.id }} className="block">
                <h3 className="font-display text-lg font-semibold">{t.title || "Untitled"}</h3>
                {t.destination && (
                  <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                    <MapPin className="h-3 w-3" /> {t.destination}
                  </p>
                )}
                {t.start_date && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <Calendar className="h-3 w-3" /> {t.start_date} → {t.end_date}
                  </p>
                )}
                {t.budget_cents && (
                  <p className="mt-2 text-sm font-medium">
                    Budget {formatMoney(t.budget_cents, t.currency)}
                  </p>
                )}
              </Link>
              <button
                onClick={() => {
                  if (confirm("Delete this trip?")) del.mutate(t.id);
                }}
                className="absolute right-3 top-3 rounded-md p-2 text-muted-foreground opacity-0 hover:bg-muted hover:text-destructive group-hover:opacity-100"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
