import { Check, Circle, Dot } from "lucide-react";
import { cn } from "@/lib/utils";

export type PipelineStepId =
  | "analyzed"
  | "fit_approved"
  | "variant_selected"
  | "market_research"
  | "drafts"
  | "qc_review"
  | "exported";

const STEPS: { id: PipelineStepId; label: string }[] = [
  { id: "analyzed", label: "Analyzed" },
  { id: "fit_approved", label: "Fit approved" },
  { id: "variant_selected", label: "Variant" },
  { id: "market_research", label: "Market research" },
  { id: "drafts", label: "Drafts" },
  { id: "qc_review", label: "QC review" },
  { id: "exported", label: "Exported" },
];

export function PipelineProgress({
  currentStep,
}: {
  currentStep: PipelineStepId;
}) {
  const idx = STEPS.findIndex((s) => s.id === currentStep);
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-2 rounded-md border bg-card px-4 py-3 text-xs">
      {STEPS.map((s, i) => {
        const state: "done" | "current" | "upcoming" =
          i < idx ? "done" : i === idx ? "current" : "upcoming";
        return (
          <li key={s.id} className="flex items-center gap-1">
            <span
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1",
                state === "done" && "bg-green-500/10 text-green-700 dark:text-green-300",
                state === "current" && "bg-primary/10 font-medium text-primary",
                state === "upcoming" && "text-muted-foreground",
              )}
            >
              {state === "done" ? (
                <Check className="size-3" />
              ) : state === "current" ? (
                <Dot className="size-3 animate-pulse" />
              ) : (
                <Circle className="size-3" />
              )}
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <span className="text-muted-foreground/40">›</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Compute current step from application row state. */
export function pipelineStepForApplication(app: {
  fitScore: number | null;
  fitApproved: string;
  variant: string | null;
  marketResearchApproved: string;
  finalVersionId: string | null;
  status: string;
}): PipelineStepId {
  if (app.finalVersionId) return "exported";
  if (app.fitApproved !== "true") return "analyzed";
  if (!app.variant) return "fit_approved";
  if (app.marketResearchApproved !== "true") return "variant_selected";
  return "market_research"; // downstream stages slot in as those build out
}
