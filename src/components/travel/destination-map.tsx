import { Component, useEffect, useState, type ReactNode } from "react";
import {
  APIProvider,
  Map as GoogleMap,
  AdvancedMarker,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import { Bed, MapPin, Plus } from "lucide-react";

/**
 * What a pin *is*, which decides how it draws. The map needs this because a
 * stay and an activity are not interchangeable: the stay anchors the trip and
 * must stay findable, and a stay under comparison must be tellable from the one
 * actually booked without a legend.
 */
export type MapPinKind = "activity" | "lodging-booked" | "lodging-candidate";

export interface MapCardPin {
  id: string;
  name: string;
  subtitle: string;
  photo_url?: string | null;
  lat: number;
  lng: number;
  kind?: MapPinKind;
  /**
   * Stop number for the day being viewed. Supplied by the caller rather than
   * derived from array position, because the number has to match the itinerary
   * rail — which counts stops the map can't plot.
   */
  label?: number | null;
  /** Rendered small and faded: still findable, but not the current focus. */
  dimmed?: boolean;
  /** Second line of the hover card, e.g. "2.7 mi · 7 min from stay". */
  detail?: string | null;
}

interface Props {
  pins: MapCardPin[];
  /** When set (with an origin), routes are drawn instead of fitting to pins. */
  routeDestination: string | null;
  origin: string | null;
  waypoints: string[];
  selectedPinId?: string | null;
  /**
   * Pre-computed geometry to draw instead of asking Google's Directions
   * service. The itinerary day map passes straight segments through the day's
   * stops in order — it shows *sequence*, not the road taken; the mileage on
   * the timeline rail is the only claim about actual driving.
   *
   * ⚠️ Memoize this at the call site. It's an effect dependency, so a fresh
   * array literal each render tears the polyline down and re-fits the viewport,
   * fighting the user's pan and zoom.
   */
  routePath?: { lat: number; lng: number }[] | null;
  /**
   * `card` (default) draws the always-visible label card — right when pins are
   * few and each carries a photo, as on Trip Details. `pin` draws a bare marker
   * that reveals its card on hover, for maps dense enough that the cards would
   * overlap each other into unreadability.
   */
  pinStyle?: "card" | "pin";
  onPinClick?: (pin: MapCardPin) => void;
  onAddStop?: (name: string) => void;
}

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined;

function MapFallback({ title, hint }: { title: string; hint: ReactNode }) {
  return (
    <div className="flex h-full min-h-[320px] items-center justify-center rounded-2xl border border-dashed border-border bg-muted/30 p-6 text-center">
      <div className="max-w-xs text-sm text-muted-foreground">
        <MapPin className="mx-auto mb-2 h-5 w-5" />
        <p className="font-medium text-foreground">{title}</p>
        <p className="mt-1 text-xs">{hint}</p>
      </div>
    </div>
  );
}

// A broken map (bad key, blocked referrer, Google runtime errors) must never
// take down the workspace — contain it and show a fallback card instead.
class MapErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.error("[map] contained error:", err);
  }
  render() {
    if (this.state.failed) {
      return (
        <MapFallback
          title="Map failed to load"
          hint="Usually a key restriction — make sure this site's domain (including localhost for dev) is in the Maps key's allowed referrers."
        />
      );
    }
    return this.props.children;
  }
}

export function DestinationMap(props: Props) {
  const [authFailed, setAuthFailed] = useState(false);
  useEffect(() => {
    // Google Maps reports invalid keys / blocked referrers via this global.
    (window as unknown as Record<string, unknown>).gm_authFailure = () => setAuthFailed(true);
  }, []);

  if (!MAPS_KEY) {
    return (
      <MapFallback
        title="Map isn't connected yet"
        hint={
          <>
            Set <code className="rounded bg-muted px-1">VITE_GOOGLE_MAPS_KEY</code> (a browser key
            with Maps JavaScript, Places, and Directions APIs enabled) and redeploy.
          </>
        }
      />
    );
  }
  if (authFailed) {
    return (
      <MapFallback
        title="Map key was rejected"
        hint="Google blocked this site for the configured Maps key. Add this domain (and localhost for dev) to the key's allowed referrers in Google Cloud Console."
      />
    );
  }
  return (
    <MapErrorBoundary>
      <APIProvider apiKey={MAPS_KEY}>
        <InnerMap {...props} />
      </APIProvider>
    </MapErrorBoundary>
  );
}

/**
 * Draws a pre-computed path. Kept separate from RoutesLayer, which asks
 * Google's Directions service to work a route out; here the geometry arrives
 * already decided.
 *
 * The itinerary day map passes straight segments between consecutive stops.
 * That is deliberate and not a placeholder for road geometry: the line's job is
 * to show what order you visit things in, and drawing a road would put a second
 * routing engine's opinion next to the OSRM mileage on the rail, free to
 * disagree with it. It would also have to be re-fetched on every drag-reorder,
 * which is exactly what `dayDistanceMatrix` exists to avoid — see
 * `osrm.server.ts` and context.md §3.
 */
function PathLayer({ path }: { path: { lat: number; lng: number }[] }) {
  const map = useMap();
  const mapsLib = useMapsLibrary("maps");
  useEffect(() => {
    if (!map || !mapsLib || path.length < 2) return;
    const line = new mapsLib.Polyline({
      path,
      strokeColor: "#1d5a41",
      strokeOpacity: 0.85,
      strokeWeight: 4,
    });
    line.setMap(map);
    const bounds = new google.maps.LatLngBounds();
    path.forEach((p) => bounds.extend(p));
    map.fitBounds(bounds, 48);
    return () => line.setMap(null);
  }, [map, mapsLib, path]);
  return null;
}

/**
 * Stacking order. The booked stay must never end up underneath something —
 * it's the one pin that's relevant on every day — and a dimmed pin should lose
 * to anything it overlaps. Whatever the pointer is on wins outright.
 */
function zIndexFor(p: MapCardPin, hovered: boolean): number {
  if (hovered) return 1000;
  if (p.dimmed) return 1;
  if (p.kind === "lodging-booked") return 100;
  if (p.label != null) return 50;
  return 10;
}

function BarePin({ pin, selected }: { pin: MapCardPin; selected: boolean }) {
  const base =
    "flex items-center justify-center rounded-full border-2 shadow-card transition-transform";

  if (pin.kind === "lodging-booked") {
    return (
      <div
        className={`${base} h-9 w-9 border-white bg-primary text-white ring-2 ring-primary/40 ${selected ? "ring-4" : ""}`}
        data-testid="pin-lodging-booked"
      >
        <Bed className="h-4 w-4" />
      </div>
    );
  }
  if (pin.kind === "lodging-candidate") {
    // Outlined, not filled: this is an option, not a decision.
    return (
      <div
        className={`${base} h-8 w-8 border-dashed border-primary/60 bg-white text-primary/70`}
        data-testid="pin-lodging-candidate"
      >
        <Bed className="h-4 w-4" />
      </div>
    );
  }
  if (pin.dimmed) {
    return (
      <div
        className={`${base} h-3.5 w-3.5 border-muted-foreground/45 bg-white opacity-60`}
        data-testid="pin-dimmed"
      />
    );
  }
  if (pin.label != null) {
    return (
      <div
        className={`${base} h-7 w-7 border-white bg-sidebar-active text-xs font-semibold text-white`}
        data-testid="pin-numbered"
      >
        {pin.label}
      </div>
    );
  }
  return (
    <div className={`${base} h-5 w-5 border-white bg-primary/85`} data-testid="pin-activity" />
  );
}

function InnerMap({
  pins,
  routeDestination,
  origin,
  waypoints,
  selectedPinId,
  routePath,
  pinStyle = "card",
  onPinClick,
  onAddStop,
}: Props) {
  const showRoutes = Boolean(routeDestination && origin);
  const hasPath = Boolean(routePath && routePath.length > 1);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  return (
    <div
      className="h-full min-h-[320px] overflow-hidden rounded-2xl shadow-card"
      data-testid="destination-map"
    >
      <GoogleMap
        mapId="DEMO_MAP_ID"
        defaultCenter={{ lat: pins[0]?.lat ?? 39.5, lng: pins[0]?.lng ?? -89 }}
        defaultZoom={7}
        gestureHandling="greedy"
        disableDefaultUI={false}
        className="h-full w-full"
      >
        {/*
          Both fitters call `map.fitBounds`, so letting them run together makes
          the viewport depend on which effect resolved last.
        */}
        <FitToPins pins={pins} enabled={!showRoutes && !hasPath} />
        {showRoutes && (
          <RoutesLayer origin={origin!} destination={routeDestination!} waypoints={waypoints} />
        )}
        {hasPath && <PathLayer path={routePath!} />}
        {pins.map((p) => (
          <AdvancedMarker
            key={p.id}
            position={{ lat: p.lat, lng: p.lng }}
            zIndex={zIndexFor(p, hoveredId === p.id)}
            onClick={() => onPinClick?.(p)}
          >
            {pinStyle === "pin" ? (
              <div
                className="relative flex flex-col items-center"
                onMouseEnter={() => setHoveredId(p.id)}
                onMouseLeave={() => setHoveredId((cur) => (cur === p.id ? null : cur))}
                data-testid={`map-pin-${p.id}`}
              >
                {hoveredId === p.id && (
                  <div
                    className="absolute bottom-full mb-1.5 w-max max-w-[13rem] rounded-lg bg-white px-2.5 py-1.5 text-left shadow-card"
                    data-testid="map-pin-hovercard"
                  >
                    <p className="truncate text-xs font-semibold text-gray-900">{p.name}</p>
                    {/* Only when there's something true to say — an absent
                        distance means no booked stay, not a zero. */}
                    {p.detail && <p className="truncate text-[10px] text-gray-500">{p.detail}</p>}
                  </div>
                )}
                <BarePin pin={p} selected={selectedPinId === p.id} />
              </div>
            ) : (
              <div
                className={`flex w-44 items-center gap-2 rounded-xl bg-white p-2 text-left shadow-card transition-transform hover:scale-105 ${selectedPinId === p.id ? "ring-2 ring-primary" : ""}`}
              >
                {p.label != null ? (
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-active text-sm font-semibold text-white">
                    {p.label}
                  </div>
                ) : p.photo_url ? (
                  <img
                    src={p.photo_url}
                    alt=""
                    className="h-9 w-9 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-active/15">
                    <MapPin className="h-4 w-4 text-primary" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-gray-900">{p.name}</p>
                  <p className="truncate text-[10px] text-gray-500">{p.subtitle}</p>
                </div>
                {onAddStop && (
                  <button
                    title="Add as stop on the route"
                    className="shrink-0 rounded-full bg-sidebar-active p-1 text-white hover:opacity-90"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddStop(p.name);
                    }}
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}
          </AdvancedMarker>
        ))}
      </GoogleMap>
    </div>
  );
}

function FitToPins({ pins, enabled }: { pins: MapCardPin[]; enabled: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (!map || !enabled || pins.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    for (const p of pins) bounds.extend({ lat: p.lat, lng: p.lng });
    map.fitBounds(bounds, 64);
  }, [map, pins, enabled]);
  return null;
}

// Primary route + up to 3 alternates. Google only returns alternatives for
// waypoint-free requests, so with stops we render the single combined route.
function RoutesLayer({
  origin,
  destination,
  waypoints,
}: {
  origin: string;
  destination: string;
  waypoints: string[];
}) {
  const map = useMap();
  const routesLib = useMapsLibrary("routes");
  const [renderers, setRenderers] = useState<google.maps.DirectionsRenderer[]>([]);
  const waypointsKey = waypoints.join("|");

  useEffect(() => {
    if (!map || !routesLib) return;
    let cancelled = false;
    const stops = waypointsKey ? waypointsKey.split("|") : [];
    const service = new routesLib.DirectionsService();
    service
      .route({
        origin,
        destination,
        waypoints: stops.map((w) => ({ location: w, stopover: true })),
        travelMode: google.maps.TravelMode.DRIVING,
        provideRouteAlternatives: stops.length === 0,
      })
      .then((result) => {
        if (cancelled) return;
        const count = Math.min(result.routes.length, 4);
        const created: google.maps.DirectionsRenderer[] = [];
        for (let i = 0; i < count; i++) {
          created.push(
            new routesLib.DirectionsRenderer({
              map,
              directions: result,
              routeIndex: i,
              suppressMarkers: i > 0,
              polylineOptions: {
                strokeColor: i === 0 ? "#1d5a41" : "#a9c4b7",
                strokeOpacity: i === 0 ? 0.95 : 0.6,
                strokeWeight: i === 0 ? 5 : 3,
                zIndex: i === 0 ? 10 : 1,
              },
            }),
          );
        }
        setRenderers((prev) => {
          prev.forEach((r) => r.setMap(null));
          return created;
        });
      })
      .catch((err) => console.error("[map] directions failed:", err));
    return () => {
      cancelled = true;
    };
  }, [map, routesLib, origin, destination, waypointsKey]);

  useEffect(() => () => renderers.forEach((r) => r.setMap(null)), [renderers]);
  return null;
}
