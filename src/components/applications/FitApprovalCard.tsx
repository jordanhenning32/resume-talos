"use client";

import { useTransition } from "react";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  approveFitAction,
  cancelApplicationAction,
} from "@/app/applications/[id]/actions";

export function FitApprovalCard({
  applicationId,
  overallScore,
  alreadyApproved,
  recommendation,
}: {
  applicationId: string;
  overallScore: number;
  alreadyApproved: boolean;
  recommendation: "strong_proceed" | "proceed" | "borderline" | "pass" | "unknown";
}) {
  const [pending, startTransition] = useTransition();

  if (alreadyApproved) {
    return (
      <Card className="border-green-500/30 bg-green-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-green-700 dark:text-green-300">
            <Check className="size-5" /> Fit approved
          </CardTitle>
          <CardDescription>
            Fit gate cleared — see the next checkpoint below.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const recoCopy = {
    strong_proceed: "Strong fit. Recommend proceeding.",
    proceed: "Solid fit. Worth pursuing.",
    borderline: "Borderline — proceed only if the role is otherwise attractive; cover letter has to do work.",
    pass: "Material misalignment with your background. Consider passing.",
    unknown: "",
  }[recommendation];

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle>Approve to continue</CardTitle>
        <CardDescription>
          Fit score: <span className="font-semibold">{overallScore}/100</span>
          {recoCopy ? ` — ${recoCopy}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          Approving locks the JD analysis and unlocks the rest of the pipeline
          (long/short variant choice, market research, resume + cover letter
          drafts, QC review). Each of those steps spends money — only approve
          if you actually want to apply.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                try {
                  await approveFitAction(applicationId);
                  toast.success("Approved. Application unlocked.");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : String(err));
                }
              })
            }
            className="gap-1.5"
          >
            <Check className="size-4" />
            Approve and continue
          </Button>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                try {
                  await cancelApplicationAction(applicationId);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : String(err));
                }
              })
            }
            className="gap-1.5"
          >
            <X className="size-4" /> Cancel this application
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
