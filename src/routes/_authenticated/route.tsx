import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user)
      throw redirect({
        to: "/auth",
        // Preserve the query string, not just the path — the join-trip flow
        // needs its `?token=...` to survive the bounce through sign-in.
        search: { redirect: window.location.pathname + window.location.search },
      });
    return { user: data.user };
  },
  component: () => <Outlet />,
});
