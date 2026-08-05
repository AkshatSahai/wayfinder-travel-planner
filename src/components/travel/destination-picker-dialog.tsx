import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { suggestDestinations, chatDestinations } from "@/lib/trip-ai.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sparkles, Check, AlertCircle, SendHorizonal } from "lucide-react";

export type ParsedTrip = {
  destination: string | null;
  destination_is_specific?: boolean;
  region_hint: string | null;
  origin?: string | null;
  start_date: string | null;
  end_date: string | null;
  party_size: number | null;
  travel_mode: "car" | "flight" | "train" | "unknown" | null;
  interests: string[];
  budget_cents: number | null;
  currency: string | null;
  notes: string | null;
  missing_fields: string[];
};

type Candidate = {
  name: string;
  region: string;
  match_score: number;
  rationale: string;
  best_for: string[];
  hero_tagline: string;
  lat: number;
  lng: number;
  feature_claims: string[];
  verified_features: { feature: string; verified: boolean; example: string | null }[];
};

type ChatMessage = { role: "user" | "assistant"; content: string };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parsed: ParsedTrip;
  current: string;
  origin: string;
  onPick: (name: string) => void;
}

function normalizeParsed(parsed: ParsedTrip) {
  return {
    destination: parsed.destination ?? null,
    destination_is_specific: parsed.destination_is_specific ?? false,
    region_hint: parsed.region_hint ?? null,
    origin: parsed.origin ?? null,
    start_date: parsed.start_date ?? null,
    end_date: parsed.end_date ?? null,
    party_size: parsed.party_size ?? null,
    travel_mode: parsed.travel_mode ?? null,
    interests: parsed.interests ?? [],
    budget_cents: parsed.budget_cents ?? null,
    currency: parsed.currency ?? null,
    notes: parsed.notes ?? null,
    missing_fields: parsed.missing_fields ?? [],
  };
}

/**
 * AI destination curation — the ranked candidate grid plus refinement chat.
 * Previously the Destination tab; now a dialog opened from Trip Details, so
 * the workspace's first tab can be the dashboard while re-curation stays
 * reachable for the life of the trip.
 */
export function DestinationPickerDialog({
  open,
  onOpenChange,
  parsed,
  current,
  origin,
  onPick,
}: Props) {
  const suggestFn = useServerFn(suggestDestinations);
  const chatFn = useServerFn(chatDestinations);
  const normalized = normalizeParsed(parsed);

  const candidatesQ = useQuery({
    queryKey: [
      "destinations",
      normalized.destination,
      normalized.region_hint,
      normalized.interests.join(","),
    ],
    queryFn: () => suggestFn({ data: { parsed: normalized } }),
    // Nothing is fetched — and no AI call fires — until the dialog is opened.
    enabled: open,
    staleTime: Infinity,
    retry: false,
  });

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatResults, setChatResults] = useState<{
    why_top: string;
    destinations: Candidate[];
  } | null>(null);

  const chatMut = useMutation({
    mutationFn: (allMessages: ChatMessage[]) =>
      chatFn({
        data: {
          messages: allMessages,
          parsed: normalized,
          current_destinations: (
            chatResults?.destinations ??
            candidatesQ.data?.destinations ??
            []
          ).map((d) => d.name),
        },
      }),
    onSuccess: (res) => {
      setMessages((m) => [...m, { role: "assistant", content: res.reply }]);
      if (res.destinations.length > 0)
        setChatResults({ why_top: res.why_top, destinations: res.destinations });
    },
    onError: (err: Error) => {
      setMessages((m) => [...m, { role: "assistant", content: err.message }]);
    },
  });

  const sendChat = () => {
    const text = chatInput.trim();
    if (!text || chatMut.isPending) return;
    const next: ChatMessage[] = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setChatInput("");
    chatMut.mutate(next);
  };

  const candidates = chatResults?.destinations ?? candidatesQ.data?.destinations ?? [];
  const whyTop = chatResults?.why_top ?? candidatesQ.data?.why_top ?? "";
  const [topPick, ...alternatives] = candidates;

  const pick = (name: string) => {
    onPick(name);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Pick your area</DialogTitle>
          <DialogDescription>Chat to refine, or tap a suggestion to lock it in.</DialogDescription>
        </DialogHeader>

        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setChatResults(null);
              candidatesQ.refetch();
            }}
            disabled={candidatesQ.isFetching}
          >
            <Sparkles className="mr-1 h-4 w-4" /> {candidatesQ.isFetching ? "…" : "Re-curate"}
          </Button>
        </div>

        {/* Chat refinement */}
        <div
          className="rounded-2xl border border-border bg-card p-4 shadow-soft"
          data-testid="destination-chat"
        >
          <div className="max-h-48 space-y-2 overflow-y-auto">
            {messages.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Tell me what matters — "more secluded", "closer to {origin || "home"}", "better food
                scene" — and I'll re-rank the list.
              </p>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                  m.role === "user"
                    ? "ml-auto bg-sidebar-active text-white"
                    : "bg-muted text-foreground"
                }`}
              >
                {m.content}
              </div>
            ))}
            {chatMut.isPending && (
              <div className="w-16 rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
                …
              </div>
            )}
          </div>
          <div className="mt-3 flex gap-2">
            <Input
              placeholder="Refine your destination…"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") sendChat();
              }}
            />
            <Button
              size="icon"
              onClick={sendChat}
              disabled={!chatInput.trim() || chatMut.isPending}
            >
              <SendHorizonal className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {(candidatesQ.isLoading || candidatesQ.isFetching) && <SkeletonList />}

        {(candidatesQ.isError ||
          (!candidatesQ.isLoading && !candidatesQ.isFetching && candidates.length === 0)) && (
          <div className="rounded-2xl border border-warning/40 bg-warning/10 p-6 text-center">
            <AlertCircle className="mx-auto h-5 w-5 text-warning-foreground" />
            <p className="mt-2 text-sm font-medium">
              {candidatesQ.isError ? "Destination suggestions failed" : "No suggestions came back"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {candidatesQ.isError && candidatesQ.error instanceof Error
                ? candidatesQ.error.message
                : "Try again, or type your destination below."}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() => candidatesQ.refetch()}
            >
              Retry
            </Button>
          </div>
        )}

        {topPick && (
          <button
            data-testid="top-pick"
            onClick={() => pick(topPick.name)}
            className="w-full rounded-2xl border-2 border-primary bg-primary/5 p-5 text-left shadow-card transition-all hover:shadow-glow"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground">
                  Top pick
                </span>
                <h3 className="mt-2 font-display text-2xl font-semibold">{topPick.name}</h3>
                <p className="text-xs text-muted-foreground">{topPick.region}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  {topPick.match_score}
                </span>
                {current === topPick.name && <Check className="h-4 w-4 text-primary" />}
              </div>
            </div>
            <p className="mt-2 text-sm italic text-muted-foreground">"{topPick.hero_tagline}"</p>
            <p className="mt-2 text-sm font-medium">{whyTop || topPick.rationale}</p>
            <VerifiedChips candidate={topPick} />
          </button>
        )}

        {alternatives.length > 0 && (
          <p className="pt-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Also worth considering
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2" data-testid="candidate-grid">
          {alternatives.map((d) => {
            const isCurrent = current === d.name;
            return (
              <button
                key={d.name}
                onClick={() => pick(d.name)}
                className={`group rounded-2xl border p-4 text-left shadow-soft transition-all hover:shadow-card ${
                  isCurrent ? "border-primary bg-primary/5" : "border-border bg-card"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-display text-lg font-semibold">{d.name}</h3>
                    <p className="text-xs text-muted-foreground">{d.region}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      {d.match_score}
                    </span>
                    {isCurrent && <Check className="h-4 w-4 text-primary" />}
                  </div>
                </div>
                <p className="mt-2 line-clamp-2 text-sm">{d.rationale}</p>
                <VerifiedChips candidate={d} />
              </button>
            );
          })}
        </div>

        <div className="rounded-2xl border border-dashed border-border p-4">
          <p className="mb-2 text-sm font-medium">Or type your destination</p>
          <ManualDestination onPick={pick} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Grounding badges: which of the AI's claims Google Places actually confirmed.
function VerifiedChips({ candidate }: { candidate: Candidate }) {
  const features = candidate.verified_features ?? [];
  if (features.length === 0) {
    return (
      <div className="mt-3 flex flex-wrap gap-1">
        {(candidate.best_for ?? []).map((b) => (
          <span key={b} className="rounded-full bg-muted px-2 py-0.5 text-xs">
            {b}
          </span>
        ))}
      </div>
    );
  }
  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-1.5">
        {features.map((f) => (
          <span
            key={f.feature}
            title={
              f.verified ? `Confirmed: ${f.example ?? f.feature}` : "Not confirmed by Google Places"
            }
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
              f.verified
                ? "bg-success/10 font-medium text-success"
                : "bg-muted text-muted-foreground line-through decoration-muted-foreground/40"
            }`}
          >
            {f.verified ? <Check className="h-3 w-3" /> : null}
            {f.feature}
          </span>
        ))}
      </div>
      {features.some((f) => f.verified) && (
        <p className="mt-1 text-[10px] text-muted-foreground">✓ verified via Google Places</p>
      )}
    </div>
  );
}

function ManualDestination({ onPick }: { onPick: (name: string) => void }) {
  const [manual, setManual] = useState("");
  return (
    <div className="flex gap-2">
      <Input
        placeholder="e.g. Traverse City, MI"
        value={manual}
        onChange={(e) => setManual(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && manual.trim()) onPick(manual.trim());
        }}
      />
      <Button disabled={!manual.trim()} onClick={() => onPick(manual.trim())}>
        Use it
      </Button>
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="grid gap-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-28 animate-pulse rounded-2xl border border-border bg-muted/40" />
      ))}
    </div>
  );
}
