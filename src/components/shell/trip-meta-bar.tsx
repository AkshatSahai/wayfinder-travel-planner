import { MapPin, CalendarRange, Users, Wallet } from "lucide-react";
import { formatMoney } from "@/lib/workspace-store";
import type { Tables } from "@/integrations/supabase/types";

type Trip = Tables<"trips">;

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

export function TripMetaBar({ trip }: { trip: Trip }) {
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
      <Chip icon={Wallet} title="Budget">
        {trip.budget_cents ? formatMoney(trip.budget_cents, trip.currency ?? "USD") : "No budget"}
      </Chip>
    </div>
  );
}
