"use client";

import { useTransition } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  Check,
  Loader2,
  RefreshCw,
  ThumbsDown,
  ThumbsUp,
  UserSearch,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { runRecruiterSimulationAction } from "@/app/applications/[id]/actions";
import type { RecruiterScreenerShape } from "@/db/schema";

export function RecruiterScreenerCard({
  applicationId,
  result,
  computedAt,
}: {
  applicationId: string;
  result: RecruiterScreenerShape | null;
  computedAt: Date | null;
}) {
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const r = await runRecruiterSimulationAction(applicationId);
      if (!r.ok) {
        toast.error(`Recruiter simulation failed: ${r.error}`);
        return;
      }
      const verb =
        r.recommendation === "advance"
          ? "would advance"
          : r.recommendation === "borderline"
            ? "is borderline"
            : "would pass";
      toast.success(
        `Simulated recruiter ${verb} (${r.advanceScore}/100) · $${r.costUsd.toFixed(3)}`,
      );
    });
  }

  // First-time state: no result yet.
  if (!result) {
    return (
      <Card className="border-blue-500/20 bg-blue-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserSearch className="size-4" /> Simulate LLM-assisted recruiter triage
          </CardTitle>
          <CardDescription>
            A growing share of resumes are screened by senior recruiters using LLM
            assistants (&ldquo;score this 0-100 for advance-to-phone-screen&rdquo;). These
            behave nothing like keyword ATS — they care about first-paragraph
            clarity, internal consistency, and story coherence. ~$0.02 per run.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={run}
            disabled={pending}
            size="sm"
            className="gap-1.5"
          >
            {pending ? (
              <>
                <Loader2 className="size-3.5 animate-spin" /> Triaging…
              </>
            ) : (
              <>
                <UserSearch className="size-3.5" /> Run recruiter simulation
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const score = result.advanceScore;
  const scoreColor =
    score >= 70
      ? "text-green-600 dark:text-green-400"
      : score >= 50
        ? "text-amber-600 dark:text-amber-400"
        : "text-destructive";
  const borderTone =
    score >= 70
      ? "border-green-500/30 bg-green-500/5"
      : score >= 50
        ? "border-amber-500/30 bg-amber-500/5"
        : "border-destructive/30 bg-destructive/5";

  const recBadge = {
    advance: {
      icon: ThumbsUp,
      color: "text-green-700 dark:text-green-300",
      bg: "bg-green-500/10 border-green-500/30",
      label: "Would advance",
    },
    borderline: {
      icon: AlertTriangle,
      color: "text-amber-700 dark:text-amber-300",
      bg: "bg-amber-500/10 border-amber-500/30",
      label: "Borderline",
    },
    pass: {
      icon: ThumbsDown,
      color: "text-destructive",
      bg: "bg-destructive/10 border-destructive/30",
      label: "Would pass",
    },
  }[result.recommendation];

  return (
    <Card className={cn(borderTone)}>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <UserSearch className="size-4" /> Simulated recruiter triage
          </CardTitle>
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium",
                recBadge.bg,
                recBadge.color,
              )}
            >
              <recBadge.icon className="size-3.5" /> {recBadge.label}
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Advance
              </div>
              <div className={cn("text-2xl font-semibold tabular-nums", scoreColor)}>
                {score}
                <span className="text-sm text-muted-foreground">/100</span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={run}
              disabled={pending}
              title="Re-run simulation"
            >
              {pending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
            </Button>
          </div>
        </div>
        <CardDescription>
          {result.twoSentenceRationale}
          {computedAt && (
            <span className="ml-1 text-muted-foreground/70">
              · {formatDistanceToNow(computedAt, { addSuffix: true })}
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <SectionGrid
          left={{
            title: "Strengths the recruiter notices",
            items: result.topStrengths,
            icon: Check,
            tone: "green",
          }}
          right={{
            title: "Concerns the recruiter flags",
            items: result.topConcerns,
            icon: X,
            tone: result.topConcerns.length > 0 ? "amber" : "neutral",
          }}
        />

        <DetailRow
          label="First 5 seconds (lede impression)"
          body={result.firstImpressionNotes}
        />
        {result.internalConsistencyNotes && result.internalConsistencyNotes.trim() && (
          <DetailRow
            label="Internal consistency"
            body={result.internalConsistencyNotes}
            tone={
              /none|no\b|no contradictions|no issues|all checks/i.test(
                result.internalConsistencyNotes,
              )
                ? "neutral"
                : "amber"
            }
          />
        )}
        <DetailRow label="Story coherence" body={result.storyCoherence} />
      </CardContent>
    </Card>
  );
}

function SectionGrid({
  left,
  right,
}: {
  left: { title: string; items: string[]; icon: typeof Check; tone: "green" };
  right: {
    title: string;
    items: string[];
    icon: typeof X;
    tone: "amber" | "neutral";
  };
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div
        className={cn(
          "rounded-md border p-3",
          "border-green-500/30 bg-green-500/5",
        )}
      >
        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-green-700 dark:text-green-300">
          <left.icon className="size-3.5" /> {left.title}
        </div>
        {left.items.length === 0 ? (
          <p className="text-xs text-muted-foreground">(none)</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {left.items.map((s, i) => (
              <li key={i}>· {s}</li>
            ))}
          </ul>
        )}
      </div>
      <div
        className={cn(
          "rounded-md border p-3",
          right.tone === "amber"
            ? "border-amber-500/30 bg-amber-500/5"
            : "border-border bg-muted/30",
        )}
      >
        <div
          className={cn(
            "mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide",
            right.tone === "amber"
              ? "text-amber-700 dark:text-amber-300"
              : "text-muted-foreground",
          )}
        >
          <right.icon className="size-3.5" /> {right.title}
        </div>
        {right.items.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No specific concerns flagged.
          </p>
        ) : (
          <ul className="space-y-1 text-xs">
            {right.items.map((s, i) => (
              <li key={i}>· {s}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function DetailRow({
  label,
  body,
  tone = "neutral",
}: {
  label: string;
  body: string;
  tone?: "neutral" | "amber";
}) {
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2 text-xs",
        tone === "amber" ? "border-amber-500/30 bg-amber-500/5" : "border-border bg-card/60",
      )}
    >
      <div className="mb-0.5 font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="leading-relaxed">{body}</div>
    </div>
  );
}
