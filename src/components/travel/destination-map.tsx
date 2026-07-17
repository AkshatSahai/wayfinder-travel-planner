import { useEffect, useState } from "react";
import {
  APIProvider,
  Map as GoogleMap,
  AdvancedMarker,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import { MapPin, Plus } from "lucide-react";

export interface MapCardPin {
  id: string;
  name: string;
  subtitle: string;
  photo_url?: string | null;
  lat: number;
  lng: number;
}

interface Props {
  pins: MapCardPin[];
  /** When set (with an origin), routes are drawn instead of fitting to pins. */
  routeDestination: string | null;
  origin: string | null;
  waypoints: string[];
  selectedPinId?: string | null;
  onPinClick?: (pin: MapCardPin) => void;
  onAddStop?: (name: string) => void;
}

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined;

export function DestinationMap(props: Props) {
  if (!MAPS_KEY) {
    return (
      <div className="flex h-full min-h-[320px] items-center justify-center rounded-2xl border border-dashed border-border bg-muted/30 p-6 text-center">
        <div className="max-w-xs text-sm text-muted-foreground">
          <MapPin className="mx-auto mb-2 h-5 w-5" />
          <p className="font-medium text-foreground">Map isn't connected yet</p>
          <p className="mt-1 text-xs">
            Set <code className="rounded bg-muted px-1">VITE_GOOGLE_MAPS_KEY</code> (a browser key
            with Maps JavaScript, Places, and Directions APIs enabled) and redeploy.
          </p>
        </div>
      </div>
    );
  }
  return (
    <APIProvider apiKey={MAPS_KEY}>
      <InnerMap {...props} />
    </APIProvider>
  );
}

function InnerMap({
  pins,
  routeDestination,
  origin,
  waypoints,
  selectedPinId,
  onPinClick,
  onAddStop,
}: Props) {
  const showRoutes = Boolean(routeDestination && origin);
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
        <FitToPins pins={pins} enabled={!showRoutes} />
        {showRoutes && (
          <RoutesLayer origin={origin!} destination={routeDestination!} waypoints={waypoints} />
        )}
        {pins.map((p) => (
          <AdvancedMarker
            key={p.id}
            position={{ lat: p.lat, lng: p.lng }}
            onClick={() => onPinClick?.(p)}
          >
            <div
              className={`flex w-44 items-center gap-2 rounded-xl bg-white p-2 text-left shadow-card transition-transform hover:scale-105 ${selectedPinId === p.id ? "ring-2 ring-primary" : ""}`}
            >
              {p.photo_url ? (
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
