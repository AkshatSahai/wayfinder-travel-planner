import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Users2, Copy, X } from "lucide-react";
import {
  createInviteLink,
  revokeInviteLink,
  listCollaborators,
  removeCollaborator,
} from "@/lib/trip-collaborators.functions";

interface Props {
  tripId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShareTripDialog({ tripId, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [link, setLink] = useState<string | null>(null);

  const createFn = useServerFn(createInviteLink);
  const revokeFn = useServerFn(revokeInviteLink);
  const listFn = useServerFn(listCollaborators);
  const removeFn = useServerFn(removeCollaborator);

  const collabQuery = useQuery({
    queryKey: ["trip-collaborators", tripId],
    queryFn: () => listFn({ data: { trip_id: tripId } }),
    enabled: open,
  });

  const createMut = useMutation({
    mutationFn: () => createFn({ data: { trip_id: tripId } }),
    onSuccess: ({ token }) => {
      setLink(`${window.location.origin}/trips/${tripId}/join?token=${token}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const revokeMut = useMutation({
    mutationFn: () => revokeFn({ data: { trip_id: tripId } }),
    onSuccess: () => {
      setLink(null);
      toast.success("Invite link revoked — old links no longer work.");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => removeFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trip-collaborators", tripId] });
      toast.success("Removed from the trip.");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const copyLink = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    toast.success("Link copied.");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users2 className="h-5 w-5 text-primary" /> Share this trip
          </DialogTitle>
          <DialogDescription>
            Anyone with the link can join as a collaborator with full read/write access.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            {link ? (
              <>
                <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
                <Button variant="outline" onClick={copyLink}>
                  <Copy className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <Button onClick={() => createMut.mutate()} disabled={createMut.isPending}>
                {createMut.isPending ? "Generating…" : "Create invite link"}
              </Button>
            )}
          </div>
          {link && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => revokeMut.mutate()}
              disabled={revokeMut.isPending}
            >
              Revoke link
            </Button>
          )}

          <div>
            <h3 className="text-sm font-medium">People with access</h3>
            <ul className="mt-2 space-y-1.5">
              {collabQuery.data?.owner && (
                <li className="flex items-center justify-between text-sm">
                  <span>{collabQuery.data.owner.email ?? "Owner"}</span>
                  <span className="text-xs text-muted-foreground">Owner</span>
                </li>
              )}
              {collabQuery.data?.collaborators.map((c) => (
                <li key={c.id} className="flex items-center justify-between text-sm">
                  <span>{c.email ?? c.user_id}</span>
                  <button
                    title="Remove"
                    onClick={() => removeMut.mutate(c.id)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
              {collabQuery.data && collabQuery.data.collaborators.length === 0 && (
                <li className="text-sm text-muted-foreground">No collaborators yet.</li>
              )}
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
