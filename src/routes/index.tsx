import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Compass, Sparkles, MapPin, Wallet, CalendarRange, LogIn, LogOut } from "lucide-react";

import { parseTripPrompt } from "@/lib/trip-ai.functions";
import { resolvePlaces } from "@/lib/places.functions";
import { createTrip } from "@/lib/trips.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CurationOverlay } from "@/components/shell/curation-overlay";
import { PlaceAutocomplete } from "@/components/travel/place-autocomplete";

const EXAMPLES = [
  "5-6 days in Michigan near a resort or beach house. Love food, hiking, spas, driving. Aug 12-17, budget $3500 for two.",
  "Long weekend in Charleston for our anniversary. Great food, walkable, boutique hotel. Sept 20-22.",
  "Family of 4, 10 days in Costa Rica in December. Kids love wildlife and beaches. Budget $8000.",
];

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Wayfinder — Plan your trip with one prompt" },
      {
        name: "description",
        content:
          "Describe your trip in plain English. Wayfinder curates destinations, lodging, transport, and activities into a live budgeted itinerary.",
      },
      { property: "og:title", content: "Wayfinder" },
      { property: "og:description", content: "One prompt to a fully planned trip." },
    ],
  }),
  component: Landing,
});

type EntryMode = "ai" | "manual";

type ManualForm = { origin: string; destination: string; start: string; end: string };

const EMPTY_MANUAL: ManualForm = { origin: "", destination: "", start: "", end: "" };

function Landing() {
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<EntryMode>("ai");
  const [manual, setManual] = useState<ManualForm>(EMPTY_MANUAL);
  const [signedIn, setSignedIn] = useState(false);
  const navigate = useNavigate();
  const parseFn = useServerFn(parseTripPrompt);
  const resolveFn = useServerFn(resolvePlaces);
  const createFn = useServerFn(createTrip);

  const setManualField = (field: keyof ManualForm, value: string) =>
    setManual((m) => ({ ...m, [field]: value }));

  const manualReady =
    manual.origin.trim().length > 1 &&
    manual.destination.trim().length > 1 &&
    Boolean(manual.start) &&
    Boolean(manual.end) &&
    manual.end >= manual.start;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(!!session);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const mutation = useMutation({
    mutationFn: async (raw: string) => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        sessionStorage.setItem("pendingPrompt", raw);
        throw new Error("__auth__");
      }
      const parsed = await parseFn({ data: { prompt: raw } });
      const { trip } = await createFn({
        data: {
          raw_prompt: raw,
          parsed_params: parsed,
          title: parsed.destination ?? "New trip",
          // A broad region ("Michigan") isn't a destination — leave it unset so
          // the workspace opens in curation mode with ranked candidates.
          destination: parsed.destination_is_specific ? parsed.destination : null,
          start_date: parsed.start_date,
          end_date: parsed.end_date,
          party_size: parsed.party_size ?? 2,
          budget_cents: parsed.budget_cents,
          currency: parsed.currency ?? "USD",
        },
      });
      return trip;
    },
    onSuccess: (trip) => {
      if (trip) navigate({ to: "/trips/$tripId", params: { tripId: trip.id } });
    },
    onError: (err: Error) => {
      if (err.message === "__auth__") {
        navigate({ to: "/auth", search: { redirect: "/" } });
      } else {
        toast.error(err.message);
      }
    },
  });

  // Manual entry: no AI call at all. Setting `destination` up front is what
  // makes the workspace open with the destination already confirmed, skipping
  // the candidate/chat curation step.
  const manualMutation = useMutation({
    mutationFn: async (form: ManualForm) => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        sessionStorage.setItem("pendingManualTrip", JSON.stringify(form));
        throw new Error("__auth__");
      }
      const origin = form.origin.trim();
      const destination = form.destination.trim();
      // Best-effort — trip creation proceeds without coordinates if it fails.
      const coords = await resolveFn({ data: { origin, destination } });
      const { trip } = await createFn({
        data: {
          title: destination,
          destination,
          start_date: form.start,
          end_date: form.end,
          party_size: 2,
          budget_cents: null,
          currency: "USD",
          parsed_params: {
            destination,
            destination_is_specific: true,
            region_hint: null,
            origin,
            start_date: form.start,
            end_date: form.end,
            party_size: 2,
            travel_mode: null,
            interests: [],
            budget_cents: null,
            currency: "USD",
            notes: null,
            missing_fields: ["budget_cents"],
            parse_failed: false,
            entry_mode: "manual",
            origin_coords: coords.origin,
            destination_coords: coords.destination,
            waypoints: [],
          },
        },
      });
      return trip;
    },
    onSuccess: (trip) => {
      if (trip) navigate({ to: "/trips/$tripId", params: { tripId: trip.id } });
    },
    onError: (err: Error) => {
      if (err.message === "__auth__") {
        navigate({ to: "/auth", search: { redirect: "/" } });
      } else {
        toast.error(err.message);
      }
    },
  });

  // Replay a prompt that was interrupted by the sign-in redirect.
  const { mutate } = mutation;
  useEffect(() => {
    const pending = sessionStorage.getItem("pendingPrompt");
    if (!pending) return;
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled || !data.user) return;
      sessionStorage.removeItem("pendingPrompt");
      setPrompt(pending);
      toast.info("Picking up where you left off…");
      mutate(pending);
    });
    return () => {
      cancelled = true;
    };
  }, [mutate]);

  // Same replay, for a manual form interrupted by the sign-in redirect.
  const { mutate: mutateManual } = manualMutation;
  useEffect(() => {
    const pending = sessionStorage.getItem("pendingManualTrip");
    if (!pending) return;
    let form: ManualForm;
    try {
      form = JSON.parse(pending) as ManualForm;
    } catch {
      sessionStorage.removeItem("pendingManualTrip");
      return;
    }
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled || !data.user) return;
      sessionStorage.removeItem("pendingManualTrip");
      setMode("manual");
      setManual(form);
      toast.info("Picking up where you left off…");
      mutateManual(form);
    });
    return () => {
      cancelled = true;
    };
  }, [mutateManual]);

  return (
    <div className="min-h-screen bg-background">
      <CurationOverlay open={mutation.isPending} />
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link to="/" className="flex items-center gap-2 font-display text-xl font-semibold">
          <Compass className="h-6 w-6 text-primary" />
          Wayfinder
        </Link>
        <nav className="flex items-center gap-2">
          <Link to="/trips" className="text-sm text-muted-foreground hover:text-foreground">
            My trips
          </Link>
          {signedIn ? (
            <Button variant="ghost" size="sm" onClick={() => supabase.auth.signOut()}>
              <LogOut className="mr-1 h-4 w-4" />
              Sign out
            </Button>
          ) : (
            <Link to="/auth" search={{ redirect: "/" }}>
              <Button variant="ghost" size="sm">
                <LogIn className="mr-1 h-4 w-4" />
                Sign in
              </Button>
            </Link>
          )}
        </nav>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-hero opacity-90" />
        <div className="relative mx-auto max-w-4xl px-6 pb-28 pt-16 text-center text-white md:pb-32 md:pt-20">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs backdrop-blur">
            <Sparkles className="h-3 w-3" /> AI-powered end-to-end trip planning
          </div>
          <h1 className="font-display text-4xl font-semibold leading-tight md:text-6xl">
            {mode === "ai" ? (
              <>
                Describe your trip.
                <br />
                Get the whole plan.
              </>
            ) : (
              <>
                Know where you're going?
                <br />
                Start planning.
              </>
            )}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm text-white/85 md:text-base">
            {mode === "ai"
              ? "Destinations, lodging, transport, food, activities, day-by-day itinerary, and live budget — all from one prompt."
              : "Enter your route and dates, and jump straight into the workspace — lodging, transport, activities, and a live budget, laid out your way."}
          </p>
        </div>
      </section>

      <section className="relative z-10 mx-auto -mt-20 max-w-3xl px-6">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-glow">
          <div className="mb-5 flex gap-1 rounded-xl bg-muted p-1">
            {(
              [
                ["ai", "Plan with AI"],
                ["manual", "Plan it myself"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setMode(value)}
                aria-pressed={mode === value}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  mode === value
                    ? "bg-card text-foreground shadow-soft"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === "ai" ? (
            <>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. My girlfriend and I want a 5-6 day getaway in Michigan near a resort or beach house. We love food, hiking, spas. Driving. Aug 12-17. Budget around $3500."
                rows={5}
                className="resize-none border-0 bg-transparent p-0 text-base shadow-none focus-visible:ring-0"
                maxLength={4000}
              />
              <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
                <span className="text-xs text-muted-foreground">{prompt.length}/4000</span>
                <Button
                  size="lg"
                  onClick={() => mutation.mutate(prompt)}
                  disabled={prompt.trim().length < 10 || mutation.isPending}
                >
                  {mutation.isPending ? "Curating…" : "Plan my trip"}
                  <Sparkles className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="manual-origin">Starting location</Label>
                  <PlaceAutocomplete
                    id="manual-origin"
                    value={manual.origin}
                    onChange={(v) => setManualField("origin", v)}
                    placeholder="e.g. Chicago, IL"
                  />
                </div>
                <div>
                  <Label htmlFor="manual-destination">Destination</Label>
                  <PlaceAutocomplete
                    id="manual-destination"
                    value={manual.destination}
                    onChange={(v) => setManualField("destination", v)}
                    placeholder="e.g. Traverse City, MI"
                  />
                </div>
                <div>
                  <Label htmlFor="manual-start">Start date</Label>
                  <Input
                    id="manual-start"
                    type="date"
                    value={manual.start}
                    onChange={(e) => setManualField("start", e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="manual-end">End date</Label>
                  <Input
                    id="manual-end"
                    type="date"
                    min={manual.start || undefined}
                    value={manual.end}
                    onChange={(e) => setManualField("end", e.target.value)}
                  />
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4">
                <span className="text-xs text-muted-foreground">
                  Budget, travelers, and interests are all editable inside the workspace.
                </span>
                <Button
                  size="lg"
                  onClick={() => manualMutation.mutate(manual)}
                  disabled={!manualReady || manualMutation.isPending}
                >
                  {manualMutation.isPending ? "Starting…" : "Start Planning!"}
                  <MapPin className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </>
          )}
        </div>
        {mode === "ai" && (
          <div className="mt-6 space-y-2">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Try one of these
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => setPrompt(ex)}
                  className="rounded-lg border border-border bg-card p-3 text-left text-xs text-muted-foreground shadow-soft transition-colors hover:border-primary hover:text-foreground"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="mx-auto max-w-5xl px-6 py-24">
        <div className="grid gap-6 md:grid-cols-3">
          {[
            {
              icon: MapPin,
              title: "Destination curation",
              body: "A ranked shortlist of towns, resorts, and areas that match your interests, party, and dates.",
            },
            {
              icon: CalendarRange,
              title: "Live itinerary",
              body: "Add lodging, transport, food, and free-form blocks. Day-by-day, drag to reorder.",
            },
            {
              icon: Wallet,
              title: "Budget rail",
              body: "Every selection updates your running total by category. Warns before you overspend.",
            },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-2xl border border-border bg-card p-6 shadow-soft">
              <Icon className="h-6 w-6 text-primary" />
              <h3 className="mt-3 font-display text-lg font-semibold">{title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        Wayfinder · AI-generated recommendations. Verify prices and availability before booking.
      </footer>
    </div>
  );
}
