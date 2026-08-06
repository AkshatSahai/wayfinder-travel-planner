import { useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { z } from "zod";
import { Compass, Loader2 } from "lucide-react";
import { redeemInvite } from "@/lib/trip-collaborators.functions";

export const Route = createFileRoute("/_authenticated/join/$tripId")({
  validateSearch: (s) => z.object({ token: z.string().min(10) }).parse(s),
  head: () => ({ meta: [{ title: "Join trip — Wayfinder" }] }),
  component: JoinTripPage,
});

function JoinTripPage() {
  const { tripId } = Route.useParams();
  const { token } = Route.useSearch();
  const navigate = Route.useNavigate();
  const redeemFn = useServerFn(redeemInvite);

  const mut = useMutation({
    mutationFn: () => redeemFn({ data: { trip_id: tripId, token } }),
    onSuccess: () => {
      toast.success("You're in — welcome to the trip.");
      navigate({ to: "/trips/$tripId", params: { tripId } });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  useEffect(() => {
    mut.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <Compass className="h-8 w-8 text-primary" />
      {mut.isError ? (
        <>
          <h1 className="font-display text-xl font-semibold">Couldn't join this trip</h1>
          <p className="max-w-sm text-sm text-muted-foreground">{mut.error?.message}</p>
          <Link to="/trips" className="text-sm text-primary hover:underline">
            Back to your trips
          </Link>
        </>
      ) : (
        <>
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Joining trip…</p>
        </>
      )}
    </div>
  );
}
