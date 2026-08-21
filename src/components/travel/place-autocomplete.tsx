import {
  Component,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { APIProvider, useMapsLibrary } from "@vis.gl/react-google-maps";
import { MapPin } from "lucide-react";

import { Input } from "@/components/ui/input";

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined;
const DEBOUNCE_MS = 250;

interface Props {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

// Minimal structural view of the Places (New) autocomplete API. Declared
// locally so the component doesn't break when @types/google.maps moves.
interface SuggestionShape {
  placePrediction?: {
    placeId?: string;
    text?: { text?: string };
  } | null;
}
interface AutocompleteSuggestionStatic {
  fetchAutocompleteSuggestions(request: {
    input: string;
    sessionToken?: unknown;
  }): Promise<{ suggestions: SuggestionShape[] }>;
}

type Suggestion = { id: string; text: string };

// A rejected key or a Google runtime error must never take the form down —
// contain it and fall back to a plain text input (same posture as the map's
// error boundary in destination-map.tsx).
class AutocompleteErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.error("[places-autocomplete] contained error:", err);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * Location input with Google Places autocomplete. Suggestions are a
 * convenience layer only — the typed text is always accepted, and coordinates
 * are resolved server-side at submit (`enrichItemLocation` in
 * `trips.functions.ts`'s `addTripItem`, not here), so a missing or rejected
 * Maps key degrades to a plain text field rather than blocking entry.
 */
export function PlaceAutocomplete(props: Props) {
  const [authFailed, setAuthFailed] = useState(false);

  useEffect(() => {
    if (!MAPS_KEY) return;
    const w = window as unknown as Record<string, unknown>;
    const previous = w.gm_authFailure;
    w.gm_authFailure = () => {
      setAuthFailed(true);
      if (typeof previous === "function") (previous as () => void)();
    };
  }, []);

  const plain = <PlainInput {...props} />;
  if (!MAPS_KEY || authFailed) return plain;

  return (
    <AutocompleteErrorBoundary fallback={plain}>
      <APIProvider apiKey={MAPS_KEY}>
        <AutocompleteInput {...props} />
      </APIProvider>
    </AutocompleteErrorBoundary>
  );
}

function PlainInput({ id, value, onChange, placeholder }: Props) {
  return (
    <Input
      id={id}
      value={value}
      placeholder={placeholder}
      autoComplete="off"
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function AutocompleteInput({ id, value, onChange, placeholder }: Props) {
  const placesLib = useMapsLibrary("places");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const listId = useId();

  // Set when the user picks a suggestion, so we don't immediately re-query for
  // the text we just wrote into the field.
  const justPicked = useRef(false);
  const sessionToken = useRef<unknown>(null);

  useEffect(() => {
    if (!placesLib) return;
    if (justPicked.current) {
      justPicked.current = false;
      return;
    }
    const query = value.trim();
    if (query.length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const lib = placesLib as unknown as {
          AutocompleteSuggestion?: AutocompleteSuggestionStatic;
          AutocompleteSessionToken?: new () => unknown;
        };
        if (!lib.AutocompleteSuggestion) return;
        if (!sessionToken.current && lib.AutocompleteSessionToken) {
          sessionToken.current = new lib.AutocompleteSessionToken();
        }

        const { suggestions: results } =
          await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
            input: query,
            sessionToken: sessionToken.current ?? undefined,
          });
        if (cancelled) return;

        const mapped = results
          .map((s, i) => ({
            id: s.placePrediction?.placeId ?? `s-${i}`,
            text: s.placePrediction?.text?.text ?? "",
          }))
          .filter((s) => s.text.length > 0)
          .slice(0, 5);
        setSuggestions(mapped);
        setHighlighted(0);
        setOpen(mapped.length > 0);
      } catch (err) {
        if (cancelled) return;
        console.error("[places-autocomplete] fetch failed:", err);
        setSuggestions([]);
        setOpen(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [placesLib, value]);

  const pick = (s: Suggestion) => {
    justPicked.current = true;
    // A completed selection ends the billing session.
    sessionToken.current = null;
    onChange(s.text);
    setSuggestions([]);
    setOpen(false);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => (h + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => (h - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(suggestions[highlighted]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        // Blur fires before the option's click, so defer closing.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onFocus={() => setOpen(suggestions.length > 0)}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 w-full overflow-hidden rounded-xl border border-border bg-card shadow-card"
        >
          {suggestions.map((s, i) => (
            <li key={s.id} role="option" aria-selected={i === highlighted}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(s)}
                onMouseEnter={() => setHighlighted(i)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                  i === highlighted ? "bg-muted" : ""
                }`}
              >
                <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{s.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
