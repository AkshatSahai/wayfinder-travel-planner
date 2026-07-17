import { KeyRound, ExternalLink } from "lucide-react";

const KEY_INFO: Record<string, { provider: string; signupUrl: string; signupLabel: string }> = {
  DUFFEL_API_KEY: {
    provider: "Duffel (live flight offers)",
    signupUrl: "https://duffel.com",
    signupLabel: "duffel.com — free test key",
  },
  GOOGLE_API_KEY: {
    provider: "Google Places (restaurants, attractions, photos)",
    signupUrl: "https://console.cloud.google.com/apis/library/places.googleapis.com",
    signupLabel: "Google Cloud Console — enable Places API (New) + Geocoding",
  },
  TICKETMASTER_API_KEY: {
    provider: "Ticketmaster Discovery (live events during your dates)",
    signupUrl: "https://developer.ticketmaster.com",
    signupLabel: "developer.ticketmaster.com — free key",
  },
  TRAVELPAYOUTS_API_KEY: {
    provider: "TravelPayouts (live hotel search)",
    signupUrl: "https://www.travelpayouts.com",
    signupLabel: "travelpayouts.com — free partner token",
  },
  EIA_API_KEY: {
    provider: "EIA (live regional gas prices)",
    signupUrl: "https://www.eia.gov/opendata/",
    signupLabel: "eia.gov/opendata — free key",
  },
  VITE_GOOGLE_MAPS_KEY: {
    provider: "Google Maps (map panel, routes, waypoints)",
    signupUrl: "https://console.cloud.google.com/google/maps-apis",
    signupLabel: "Google Cloud — browser key with Maps JS + Places + Directions",
  },
};

export function ProviderSetupCard({ missingKey }: { missingKey: string }) {
  const info = KEY_INFO[missingKey];
  return (
    <div className="rounded-xl border border-warning/40 bg-warning/10 p-4">
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" />
        <div className="text-sm">
          <p className="font-medium">{info ? info.provider : missingKey} isn't connected yet</p>
          <p className="mt-1 text-muted-foreground">
            Set <code className="rounded bg-muted px-1 py-0.5 text-xs">{missingKey}</code> as a
            server secret — in Lovable: Project → Settings → Secrets; locally: add it to{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">.env</code> — then reload.
          </p>
          {info && (
            <a
              href={info.signupUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              {info.signupLabel} <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
