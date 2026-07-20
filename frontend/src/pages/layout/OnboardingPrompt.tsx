import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { seedExampleGarden } from "@/api/client";

interface OnboardingPromptProps {
  /** Layout.tsx computes this as "mine mode, beds have loaded, and there
   * are zero of them" - kept as a plain boolean prop (rather than this
   * component doing its own beds query) so the empty-garden condition lives
   * in one place alongside the other mode-gated queries. */
  open: boolean;
  onDismiss: () => void;
  /** Called once the seed request succeeds - Layout.tsx invalidates the
   * beds/garden/plantings/bed-equipment queries so the canvas reflects the
   * newly-seeded layout. */
  onSeeded: () => void;
}

/** First-run prompt shown once "My beds" mode has loaded with zero beds -
 * offers to seed the real database from the same fixture the read-only
 * "Example Garden" view already previews (see the "Onboarding UI" backlog
 * item, split from #25 into this frontend half and #108's backend
 * POST /api/example-garden/seed route). Rejecting just dismisses for the
 * rest of this page load, leaving the database empty - no persisted
 * "don't ask again" flag, since an empty database is still worth prompting
 * about again on the next real reload.
 *
 * The confirm action is a plain Button (not AlertDialogAction, which closes
 * unconditionally as soon as it's clicked - see alert-dialog.tsx's own
 * doc) so a slow or failed seed request can keep the dialog open with an
 * inline error instead of closing before the result is known. */
export function OnboardingPrompt({ open, onDismiss, onSeeded }: OnboardingPromptProps) {
  const [error, setError] = useState<string | null>(null);

  const seedMutation = useMutation({
    mutationFn: seedExampleGarden,
    onSuccess: () => {
      setError(null);
      onSeeded();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load the example garden.");
    },
  });

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
    >
      <AlertDialogPopup>
        <AlertDialogTitle>Start with the example garden?</AlertDialogTitle>
        <AlertDialogDescription>
          Your garden is empty. Load the same demo layout shown in the "Example Garden" view above into your own
          beds as a starting point, or start from scratch and add your own beds.
        </AlertDialogDescription>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>Start from scratch</AlertDialogCancel>
          <Button size="sm" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
            {seedMutation.isPending ? "Loading…" : "Load example garden"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
