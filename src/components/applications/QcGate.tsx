"use client";

import { useState, useTransition } from "react";
import {
  Check,
  ChevronDown,
  Gauge,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { runQcAction } from "@/app/applications/[id]/actions";
import type { ApplicationVersion } from "@/db/schema";

type ScoreShape = {
  overall: number;
  dimensions?: Record<string, number>;
  feedback?: string[];
  model?: string;
  provider?: string;
  fallbackFrom?: {
    model?: string;
    provider?: string;
    reason?: string;
  } | null;
};

export function QcGate({
  applicationId,
  versions,
}: {
  applicationId: string;
  versions: ApplicationVersion[];
}) {
  const [pending, startTransition] = useTransition();
  const [showHistory, setShowHistory] = useState(true);
  const [showRaw, setShowRaw] = useState(false);

  const latest = versions[versions.length - 1] ?? null;
  if (!latest) return null;

  const hasAnyScore =
    versions.some((v) => v.qcAScore || v.qcBScore || v.screenerScore) ||
    latest.isFinal === "true";

  function run(allowOneMore = false) {
    startTransition(async () => {
      const r = await runQcAction(
        applicationId,
        allowOneMore ? { allowOneMore: true } : undefined,
      );
      if (!r.ok) {
        toast.error(`QC failed: ${r.error}`);
        return;
      }
      if (r.status === "approved") {
        toast.success(
          `Approved after ${r.iterationsRun} iteration${r.iterationsRun === 1 ? "" : "s"} · $${r.costUsd.toFixed(3)}`,
        );
      } else if (r.status === "escalated") {
        toast.warning(
          `Escalated after ${r.iterationsRun} iteration${r.iterationsRun === 1 ? "" : "s"} · $${r.costUsd.toFixed(3)}`,
        );
      } else {
        toast.info(r.reason);
      }
    });
  }

  // Not yet reviewed → kickoff card
  if (!hasAnyScore) {
    return (
      <Card className="border-primary/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5" /> Run QC review
          </CardTitle>
          <CardDescription>
            Screener Intelligence (Sonnet) scores against a 7-dimension AI-screener rubric.
            QC Reviewer A (Sonnet) + QC Reviewer B (configured secondary reviewer,
            with Sonnet fallback) review in parallel.
            A consolidator merges feedback into High / Medium / Low priorities,
            and the writers revise. Loops up to 2× until both reviewers ≥ 90 AND no
            high-priority items remain — or escalates. If escalated, you can spend
            another round manually.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => run()} disabled={pending} className="gap-1.5" size="default">
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Running QC loop (60-180s)…
              </>
            ) : (
              <>
                <Sparkles className="size-4" /> Run QC review
              </>
            )}
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            Typical cost: $0.30-$1.30 depending on iterations needed.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Has scores → show iteration history + status. Escalation is now signaled
  // by the latest version having scores but not being final — independent of
  // the iteration number, since the user can opt into extra cycles.
  const isFinal = latest.isFinal === "true";
  const latestHasScores = (latest.qcAScore as ScoreShape | null)?.overall != null;
  const escalated = !isFinal && latestHasScores;
  const inProgress = !isFinal && !escalated;

  return (
    <div className="space-y-4">
      <Card
        className={cn(
          isFinal && "border-green-500/30 bg-green-500/5",
          escalated && "border-amber-500/30 bg-amber-500/5",
          inProgress && "border-blue-500/30 bg-blue-500/5",
        )}
      >
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              {isFinal && (
                <>
                  <Check className="size-5 text-green-600 dark:text-green-400" />
                  QC approved — final draft locked
                </>
              )}
              {escalated && (
                <>
                  <X className="size-5 text-amber-600 dark:text-amber-400" />
                  QC escalated — manual review needed
                </>
              )}
              {inProgress && (
                <>
                  <Gauge className="size-5 text-blue-600 dark:text-blue-400" />
                  QC in progress
                </>
              )}
            </CardTitle>
            <CardDescription>
              {versions.length} iteration{versions.length === 1 ? "" : "s"} ·{" "}
              latest scores A=
              <ScoreInline score={(latest.qcAScore as ScoreShape | null)?.overall} />
              {" "}/ B=
              <ScoreInline score={(latest.qcBScore as ScoreShape | null)?.overall} />
              {(latest.screenerScore as ScoreShape | null)?.overall != null && (
                <>
                  {" "}/ Screener=
                  <ScoreInline score={(latest.screenerScore as ScoreShape | null)?.overall} />
                </>
              )}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant={escalated ? "default" : "outline"}
              size="sm"
              onClick={() => run(escalated)}
              disabled={pending}
              className="gap-1.5"
              title={
                escalated
                  ? "Spend another round: re-reviews the latest, rewrites once more, then re-reviews. ~$0.70-$1.00."
                  : undefined
              }
            >
              {pending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              {isFinal
                ? "Re-run review"
                : escalated
                  ? "Run another iteration"
                  : "Continue loop"}
            </Button>
          </div>
        </CardHeader>
        {escalated && (
          <CardContent className="pt-0 text-xs text-muted-foreground">
            QC stopped at iteration {latest.iteration} without hitting the approval
            threshold. Most apps don&apos;t improve from one more round, but you can
            spend ~$0.70-$1.00 to try if you think the feedback is actionable.
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <button
            className="flex w-full items-center justify-between text-left text-base"
            onClick={() => setShowHistory(!showHistory)}
          >
            <CardTitle className="text-base">Iteration history</CardTitle>
            <ChevronDown
              className={cn("size-4 transition-transform", showHistory && "rotate-180")}
            />
          </button>
        </CardHeader>
        {showHistory && (
          <CardContent>
            <ol className="space-y-3">
              {versions.map((v) => (
                <IterationRow key={v.id} version={v} isFinal={v.isFinal === "true"} />
              ))}
            </ol>
          </CardContent>
        )}
      </Card>

      {(latest.screenerScore || latest.qcAScore || latest.qcBScore) && (
        <Card>
          <CardHeader>
            <button
              className="flex w-full items-center justify-between text-left text-sm"
              onClick={() => setShowRaw(!showRaw)}
            >
              <span className="font-semibold">Dimension scores (latest iteration)</span>
              <ChevronDown
                className={cn("size-4 transition-transform", showRaw && "rotate-180")}
              />
            </button>
          </CardHeader>
          {showRaw && (
            <CardContent className="space-y-4 text-sm">
              {latest.screenerScore && (
                <DimensionBlock
                  label={agentLabel(
                    "Screener Intelligence",
                    latest.screenerScore as ScoreShape,
                  )}
                  score={latest.screenerScore as ScoreShape}
                />
              )}
              {latest.qcAScore && (
                <DimensionBlock
                  label={agentLabel("QC Reviewer A", latest.qcAScore as ScoreShape)}
                  score={latest.qcAScore as ScoreShape}
                />
              )}
              {latest.qcBScore && (
                <DimensionBlock
                  label={agentLabel("QC Reviewer B", latest.qcBScore as ScoreShape)}
                  score={latest.qcBScore as ScoreShape}
                />
              )}
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}

function IterationRow({
  version,
  isFinal,
}: {
  version: ApplicationVersion;
  isFinal: boolean;
}) {
  const a = (version.qcAScore as ScoreShape | null)?.overall;
  const b = (version.qcBScore as ScoreShape | null)?.overall;
  const s = (version.screenerScore as ScoreShape | null)?.overall;
  const scored = a != null || b != null || s != null;
  return (
    <li className="flex items-start gap-3 rounded-md border bg-card px-3 py-2.5">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-xs">
        {version.iteration}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">
            v{version.versionNumber}.{version.iteration}
          </span>
          {isFinal && (
            <Badge variant="outline" className="border-green-500/30 bg-green-500/5 text-[10px] text-green-700 dark:text-green-300">
              <Check className="mr-0.5 size-3" /> Final
            </Badge>
          )}
          {!scored && !isFinal && (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              not yet reviewed
            </Badge>
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-3 text-xs">
          {a != null && <ScorePill label="QC A" score={a} />}
          {b != null && <ScorePill label="QC B" score={b} />}
          {s != null && <ScorePill label="Screener" score={s} />}
          <span className="text-muted-foreground">
            created {new Date(version.createdAt).toLocaleString()}
          </span>
        </div>
      </div>
    </li>
  );
}

function ScorePill({ label, score }: { label: string; score: number }) {
  const tone =
    score >= 90
      ? "bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/30"
      : score >= 75
        ? "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30"
        : score >= 60
          ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30"
          : "bg-destructive/10 text-destructive border-destructive/30";
  return (
    <span className={cn("rounded-md border px-2 py-0.5 font-mono", tone)}>
      {label}: {score}
    </span>
  );
}

function ScoreInline({ score }: { score: number | null | undefined }) {
  if (score == null) return <span className="text-muted-foreground">—</span>;
  return <span className="font-semibold tabular-nums">{score}</span>;
}

function DimensionBlock({ label, score }: { label: string; score: ScoreShape }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <ScorePill label="overall" score={score.overall} />
      </div>
      {score.dimensions && (
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {Object.entries(score.dimensions).map(([k, v]) => (
            <div
              key={k}
              className="flex items-center justify-between rounded-md border bg-muted/30 px-2 py-1 text-xs"
            >
              <span>{prettifyDimensionKey(k)}</span>
              <span className="font-mono tabular-nums">{v}</span>
            </div>
          ))}
        </div>
      )}
      {score.feedback && score.feedback.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
          {score.feedback.slice(0, 6).map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function prettifyDimensionKey(k: string): string {
  return k
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function agentLabel(base: string, score: ScoreShape): string {
  const model = modelLabel(score);
  return model ? `${base} (${model})` : base;
}

function modelLabel(score: ScoreShape): string | null {
  if (!score.model) return null;

  const model = score.model.toLowerCase();
  const label = model.includes("sonnet")
    ? "Sonnet"
    : model.includes("haiku")
      ? "Haiku"
      : model.includes("opus")
        ? "Opus"
        : model.includes("grok")
          ? "Grok"
          : model.includes("gemini")
            ? "Gemini"
            : score.model;

  return score.fallbackFrom ? `${label} fallback` : label;
}
