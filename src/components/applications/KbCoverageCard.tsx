"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  CoverageVerdict,
  KbGapReport,
  SkillCoverage,
} from "@/lib/agents/kb-gap-detector";
import {
  addQuickFactsAction,
  runKbCoverageScanAction,
} from "@/app/applications/[id]/actions";

export function KbCoverageCard({
  applicationId,
  report,
  computedAt,
}: {
  applicationId: string;
  report: KbGapReport | null;
  computedAt: Date | null;
}) {
  const [showNiceToHave, setShowNiceToHave] = useState(false);
  const [showPreviews, setShowPreviews] = useState(false);
  const [pending, startTransition] = useTransition();

  function runScan() {
    startTransition(async () => {
      const r = await runKbCoverageScanAction(applicationId);
      if (!r.ok) {
        toast.error(`KB scan failed: ${r.error}`);
        return;
      }
      const secs = (r.durationMs / 1000).toFixed(0);
      const cost = r.costUsd > 0 ? ` · $${r.costUsd.toFixed(4)}` : "";
      toast.success(
        r.missingMustHaveCount === 0
          ? `Scan complete in ${secs}s — no missing must-haves${cost}.`
          : `Scan complete in ${secs}s — ${r.missingMustHaveCount} missing must-have${r.missingMustHaveCount === 1 ? "" : "s"}${cost}.`,
      );
    });
  }

  // First-time state: no report yet. Surface a CTA.
  if (!report) {
    return (
      <Card className="border-blue-500/20 bg-blue-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4" /> Scan KB coverage of must-have skills
          </CardTitle>
          <CardDescription>
            Embed each JD skill (plus AI-generated phrasing variants) and check
            how strongly your KB covers it. Surfaces gaps you can fill BEFORE
            generating, so the writer has more to draw from. ~20s, ~$0.005.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={runScan} disabled={pending} size="sm" className="gap-1.5">
            {pending ? (
              <>
                <Loader2 className="size-3.5 animate-spin" /> Scanning KB…
              </>
            ) : (
              <>
                <Sparkles className="size-3.5" /> Run KB coverage scan
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (report.mustHave.length === 0) return null;

  const missingCount = report.missingMustHaveCount;
  const thinCount = report.thinMustHaveCount;
  const wellCount = report.wellCoveredMustHaveCount;
  const totalGaps = missingCount + thinCount;

  const isStrong = totalGaps === 0;
  const hasMissing = missingCount > 0;

  return (
    <Card
      className={cn(
        isStrong && "border-green-500/30 bg-green-500/5",
        hasMissing && "border-amber-500/30 bg-amber-500/5",
        !isStrong && !hasMissing && "border-blue-500/20 bg-blue-500/5",
      )}
    >
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="text-base">KB coverage of JD must-haves</CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-sm font-normal tabular-nums text-muted-foreground">
              {wellCount} solid · {thinCount} thin · {missingCount} missing
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={runScan}
              disabled={pending}
              title="Re-scan after adding new KB facts"
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
          {isStrong
            ? "Every must-have skill has strong KB grounding. The writer has plenty to work with."
            : hasMissing
              ? `${missingCount} must-have skill${missingCount === 1 ? "" : "s"} ha${missingCount === 1 ? "s" : "ve"} no KB grounding. Resume bullets for ${missingCount === 1 ? "it" : "them"} will be thin or absent — adding facts before generating raises the ceiling on what's possible.`
              : "Some must-haves have limited KB coverage. The resume will be functional, but extra facts would let the writer be more concrete."}
          {computedAt && (
            <span className="ml-1 text-muted-foreground/70">
              · scanned {formatDistanceToNow(computedAt, { addSuffix: true })}
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-1.5">
          {report.mustHave.map((c) => (
            <SkillRow
              key={c.skill}
              coverage={c}
              showPreview={showPreviews}
            />
          ))}
        </ul>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
          <button
            type="button"
            onClick={() => setShowPreviews((v) => !v)}
            className="text-muted-foreground hover:text-foreground"
          >
            {showPreviews ? "Hide" : "Show"} matched-fact previews
          </button>
          {report.niceToHave.length > 0 && (
            <button
              type="button"
              onClick={() => setShowNiceToHave((v) => !v)}
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <ChevronDown
                className={cn(
                  "size-3 transition-transform",
                  showNiceToHave && "rotate-180",
                )}
              />
              Nice-to-have coverage ({report.niceToHave.length})
            </button>
          )}
        </div>

        {showNiceToHave && report.niceToHave.length > 0 && (
          <ul className="space-y-1.5 border-t pt-3">
            {report.niceToHave.map((c) => (
              <SkillRow
                key={c.skill}
                coverage={c}
                showPreview={showPreviews}
                muted
              />
            ))}
          </ul>
        )}

        <QuickAddFacts applicationId={applicationId} />
      </CardContent>
    </Card>
  );
}

function QuickAddFacts({ applicationId }: { applicationId: string }) {
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  const [lastResult, setLastResult] = useState<
    | null
    | {
        kind: "ok";
        factCount: number;
        chunkCount: number;
        duplicateFactCount: number;
        costUsd: number;
        status: "ingested" | "duplicate_document";
      }
    | { kind: "err"; message: string }
  >(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const minOK = text.trim().length >= 20;

  function submit() {
    if (!minOK || pending) return;
    const snapshot = text;
    startTransition(async () => {
      const r = await addQuickFactsAction({ text: snapshot, applicationId });
      if (!r.ok) {
        setLastResult({ kind: "err", message: r.error });
        toast.error(`Add failed: ${r.error}`);
        return;
      }
      setLastResult({
        kind: "ok",
        factCount: r.factCount,
        chunkCount: r.chunkCount,
        duplicateFactCount: r.duplicateFactCount,
        costUsd: r.costUsd,
        status: r.status,
      });
      setText("");
      const cost = r.costUsd > 0 ? ` · $${r.costUsd.toFixed(4)}` : "";
      if (r.status === "duplicate_document") {
        toast.message(`Already in KB — exact same text was ingested previously${cost}.`);
      } else if (r.factCount === 0) {
        toast.message(
          r.duplicateFactCount > 0
            ? `${r.duplicateFactCount} duplicate fact${r.duplicateFactCount === 1 ? "" : "s"} skipped — nothing new added${cost}.`
            : `No new facts extracted from that text${cost}.`,
        );
      } else {
        toast.success(
          `Added ${r.factCount} new fact${r.factCount === 1 ? "" : "s"}${
            r.duplicateFactCount > 0
              ? ` (${r.duplicateFactCount} skipped as duplicates)`
              : ""
          }${cost}. Re-scan the KB to refresh gap rows.`,
        );
      }
    });
  }

  const [scanPending, startScan] = useTransition();
  function rescan() {
    startScan(async () => {
      const r = await runKbCoverageScanAction(applicationId);
      if (!r.ok) {
        toast.error(`Re-scan failed: ${r.error}`);
        return;
      }
      toast.success(
        r.missingMustHaveCount === 0
          ? `Re-scan done — no missing must-haves.`
          : `Re-scan done — ${r.missingMustHaveCount} missing must-have${r.missingMustHaveCount === 1 ? "" : "s"} left.`,
      );
    });
  }

  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium">Quick add facts to your KB</h4>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          global · all future apps
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Paste a paragraph about your relevant experience. It&apos;s chunked,
        embedded, and fact-extracted into the same global KB the rest of the
        system reads from — these facts will be available to every future
        application, not just this one. Usually 5–15s. After adding, hit
        re-scan to see gaps close here.
      </p>
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. Owned full SDLC artifact suite at SSA: business cases, project charters, RTMs, user stories with acceptance criteria, OKRs, release notes, RCA reports, sunset plans — authored across the $200M Agile IT portfolio."
        rows={4}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-60"
        disabled={pending}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={submit}
          disabled={!minOK || pending}
          className="gap-1.5"
        >
          {pending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" /> Adding…
            </>
          ) : (
            <>
              <Plus className="size-3.5" /> Add to KB
            </>
          )}
        </Button>
        <span className="text-xs text-muted-foreground">
          {text.trim().length} chars{!minOK && text.length > 0 && " (need 20+)"}
        </span>
        {lastResult?.kind === "ok" && lastResult.factCount > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={rescan}
            disabled={scanPending}
            className="ml-auto gap-1.5"
          >
            {scanPending ? (
              <>
                <Loader2 className="size-3.5 animate-spin" /> Re-scanning…
              </>
            ) : (
              <>
                <RefreshCw className="size-3.5" /> Re-scan KB now
              </>
            )}
          </Button>
        )}
      </div>
      {lastResult && (
        <ResultBanner result={lastResult} />
      )}
    </div>
  );
}

function ResultBanner({
  result,
}: {
  result:
    | {
        kind: "ok";
        factCount: number;
        chunkCount: number;
        duplicateFactCount: number;
        costUsd: number;
        status: "ingested" | "duplicate_document";
      }
    | { kind: "err"; message: string };
}) {
  if (result.kind === "err") {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        {result.message}
      </div>
    );
  }
  if (result.status === "duplicate_document") {
    return (
      <div className="rounded-md border border-blue-500/30 bg-blue-500/5 px-3 py-2 text-xs text-blue-700 dark:text-blue-300">
        Identical text was already in the KB — nothing new added.
      </div>
    );
  }
  const cost = result.costUsd > 0 ? ` · $${result.costUsd.toFixed(4)}` : "";
  if (result.factCount === 0) {
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
        {result.duplicateFactCount > 0
          ? `All ${result.duplicateFactCount} extracted fact${result.duplicateFactCount === 1 ? "" : "s"} were duplicates of existing KB facts${cost}.`
          : `No facts extracted from that text${cost}.`}
      </div>
    );
  }
  return (
    <div className="rounded-md border border-green-500/30 bg-green-500/5 px-3 py-2 text-xs text-green-700 dark:text-green-400">
      Added {result.factCount} new fact{result.factCount === 1 ? "" : "s"} from {result.chunkCount} chunk{result.chunkCount === 1 ? "" : "s"}
      {result.duplicateFactCount > 0
        ? ` · ${result.duplicateFactCount} duplicate${result.duplicateFactCount === 1 ? "" : "s"} skipped`
        : ""}
      {cost}.
    </div>
  );
}

const VERDICT_STYLE: Record<
  CoverageVerdict,
  { icon: typeof CheckCircle2; color: string }
> = {
  well_covered: {
    icon: CheckCircle2,
    color: "text-green-600 dark:text-green-400",
  },
  thin: {
    icon: AlertTriangle,
    color: "text-amber-600 dark:text-amber-400",
  },
  missing: {
    icon: XCircle,
    color: "text-destructive",
  },
};

function SkillRow({
  coverage,
  showPreview,
  muted = false,
}: {
  coverage: SkillCoverage;
  showPreview: boolean;
  muted?: boolean;
}) {
  const { icon: Icon, color } = VERDICT_STYLE[coverage.verdict];
  const label =
    coverage.verdict === "missing"
      ? "no matches"
      : `${coverage.strongMatches} fact${coverage.strongMatches === 1 ? "" : "s"}`;

  return (
    <li className={cn("space-y-1 text-sm", muted && "opacity-80")}>
      <div className="flex items-center gap-2">
        <Icon className={cn("size-4 shrink-0", color)} />
        <span className="min-w-0 flex-1 truncate font-medium">
          {coverage.skill}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {label}
        </span>
        {coverage.verdict !== "well_covered" && (
          <Link
            href={`/knowledge-base?focus=${encodeURIComponent(coverage.skill)}`}
            className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-blue-500/30 bg-blue-500/5 px-1.5 py-0.5 text-[10px] font-medium uppercase text-blue-700 hover:bg-blue-500/10 dark:text-blue-300"
          >
            <Plus className="size-2.5" /> Add facts
          </Link>
        )}
      </div>
      {showPreview && coverage.topFactSnippets.length > 0 && (
        <ul className="ml-6 space-y-0.5 text-xs text-muted-foreground">
          {coverage.topFactSnippets.map((s, i) => (
            <li key={i} className="truncate">
              · {s}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
