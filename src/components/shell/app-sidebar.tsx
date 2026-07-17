import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Compass, MapPin, Bed, Car, Sparkles, CalendarRange, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { WhatsNewDialog } from "./whats-new-dialog";

export type WorkspaceTab = "destination" | "lodging" | "transport" | "activities" | "itinerary";

const NAV: { value: WorkspaceTab; label: string; icon: typeof MapPin }[] = [
  { value: "destination", label: "Destination", icon: MapPin },
  { value: "lodging", label: "Lodging", icon: Bed },
  { value: "transport", label: "Transport", icon: Car },
  { value: "activities", label: "Activities", icon: Sparkles },
  { value: "itinerary", label: "Itinerary", icon: CalendarRange },
];

export function AppSidebar({
  tab,
  onNavigate,
}: {
  tab: WorkspaceTab;
  onNavigate: (t: WorkspaceTab) => void;
}) {
  const navigate = useNavigate();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  return (
    <aside className="flex h-screen w-[190px] shrink-0 flex-col bg-sidebar text-sidebar-foreground max-lg:h-auto max-lg:w-full max-lg:flex-row max-lg:items-center max-lg:justify-between max-lg:px-3 max-lg:py-2 lg:sticky lg:top-0">
      <Link
        to="/"
        className="flex items-center gap-2 px-4 py-5 font-display text-lg font-semibold max-lg:p-0"
      >
        <Compass className="h-5 w-5" />
        Wayfinder
      </Link>

      <nav
        className="flex flex-1 flex-col gap-1 px-3 max-lg:flex-row max-lg:px-0"
        data-testid="sidebar-nav"
      >
        {NAV.map(({ value, label, icon: Icon }) => {
          const active = tab === value;
          return (
            <button
              key={value}
              onClick={() => onNavigate(value)}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors max-lg:px-2 ${
                active
                  ? "bg-sidebar-active font-medium text-sidebar-foreground"
                  : "text-sidebar-muted hover:bg-sidebar-active/50 hover:text-sidebar-foreground"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="max-lg:hidden">{label}</span>
            </button>
          );
        })}
      </nav>

      <div className="space-y-1 px-3 pb-4 max-lg:hidden">
        <WhatsNewDialog />
        <div className="flex items-center gap-2 rounded-lg px-3 py-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sidebar-active text-xs font-semibold uppercase">
            {email?.[0] ?? "?"}
          </div>
          <span className="min-w-0 flex-1 truncate text-xs text-sidebar-muted">{email ?? "…"}</span>
          <button
            title="Sign out"
            className="text-sidebar-muted transition-colors hover:text-sidebar-foreground"
            onClick={async () => {
              await supabase.auth.signOut();
              navigate({ to: "/" });
            }}
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
