"use client";

import { useTransition } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Loader2,
  RefreshCw,
  ShieldAlert,
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
import type { KnockoutReportShape } from "@/db/schema";
import { runKnockoutScanAction } from "@/app/applications/[id]/actions";

type Knockout = KnockoutReportShape["knockouts"][number];
type Verdict = Knockout["coverage"]["verdict"];

export function KnockoutCard({
  applicationId,
  report,
  computedAt,
}: {
  applicationId: string;
  report: KnockoutReportShape | null;
  computedAt: Date | null;
}) {
  const [pending, startTransition] = useTransition();

  function runScan() {
    startTransition(async () => {
      const r = await runKnockoutScanAction(applicationId);
      if (!r.ok) {
        toast.error(`Knockout scan failed: ${r.error}`);
        return;
      }
      const secs = (r.durationMs / 1000).toFixed(0);
      const cost = r.costUsd > 0 ? ` · $${r.costUsd.toFixed(4)}` : "";
      const issueCount = r.missingCount + r.partialCount + r.blockingCount;
      toast.success(
        issueCount === 0
          ? `Scan complete in ${secs}s — all ${r.knockoutCount} knockout${r.knockoutCount === 1 ? "" : "s"} verified${cost}.`
          : `Scan complete in ${secs}s — ${issueCount} of ${r.knockoutCount} knockout${r.knockoutCount === 1 ? "" : "s"} unaddressed${cost}.`,
      );
    });
  }

  if (!report) {
    return (
      <Card className="border-blue-500/20 bg-blue-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="size-4" /> Scan for knockout questions
          </CardTitle>
          <CardDescription>
            Detects hard JD requirements — citizenship, clearance, years floors,
            degree, named certifications — and checks whether the resume
            explicitly answers each. A knockout you didn&apos;t address is an
            instant-reject from many ATS regardless of keyword score. ~5s, &lt;$0.01.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={runScan} disabled={pending} size="sm" className="gap-1.5">
            {pending ? (
              <>
                <Loader2 className="size-3.5 animate-spin" /> Scanning…
              </>
            ) : (
              <>
                <Sparkles className="size-3.5" /> Run knockout scan
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (report.knockouts.length === 0) {
    return (
      <Card className="border-green-500/30 bg-green-500/5">
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="size-4 text-green-600" /> No knockout
              questions detected
            </CardTitle>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={runScan}
              disabled={pending}
              title="Re-scan"
            >
              {pending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
            </Button>
          </div>
          <CardDescription>
            The JD has no hard non-negotiable filter requirements (no
            citizenship / clearance / years-floor / specific-degree language).
            {computedAt && (
              <span className="ml-1 text-muted-foreground/70">
                · scanned {formatDistanceToNow(computedAt, { addSuffix: true })}
              </span>
            )}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const issueCount =
    report.missingCount + report.partialCount + report.blockingCount;
  const allVerified = issueCount === 0;
  const hasBlocking = report.blockingCount > 0;
  // Coverage may have been scored against the KB (when no resume exists)
  // rather than the resume itself. Detect from any row's source tag so the
  // header copy can frame correctly. Tolerate older cached reports where
  // source is undefined — those came from the resume.
  const kbBasedCount = report.knockouts.filter(
    (k) => k.coverage.source === "kb",
  ).length;
  const isKbMode = kbBasedCount > 0 && kbBasedCount === report.knockouts.length;

  return (
    <Card
      className={cn(
        allVerified && "border-green-500/30 bg-green-500/5",
        hasBlocking && "border-destructive/40 bg-destructive/5",
        !allVerified && !hasBlocking && "border-amber-500/30 bg-amber-500/5",
      )}
    >
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="size-4" /> Knockout questions
          </CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-sm font-normal tabular-nums text-muted-foreground">
              {report.verifiedCount} verified · {report.partialCount} partial ·{" "}
              {report.missingCount} missing
              {report.blockingCount > 0 && ` · ${report.blockingCount} blocking`}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={runScan}
              disabled={pending}
              title="Re-scan after editing the resume"
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
          {allVerified
            ? isKbMode
              ? "Your KB grounds every hard JD requirement. The writer will surface these in the draft on next generation."
              : "Every hard JD requirement is explicitly answered in the resume. No ATS filter-trip risk on these axes."
            : hasBlocking
              ? `${report.blockingCount} knockout${report.blockingCount === 1 ? " is" : "s are"} BLOCKING — the resume contradicts the requirement. Address before submitting.`
              : isKbMode
                ? `Scored against your KB (no drafts yet). ${report.verifiedCount + report.partialCount} of ${report.knockouts.length} have KB grounding; ${report.missingCount} need KB facts before generating drafts.`
                : `${issueCount} of ${report.knockouts.length} knockout${report.knockouts.length === 1 ? "" : "s"} ${issueCount === 1 ? "is" : "are"} unaddressed. These will feed the next QC iteration as HIGH priority.`}
          {computedAt && (
            <span className="ml-1 text-muted-foreground/70">
              · scanned {formatDistanceToNow(computedAt, { addSuffix: true })}
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {report.knockouts.map((k) => (
            <KnockoutRow key={k.id} knockout={k} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

const VERDICT_STYLE: Record<
  Verdict,
  { icon: typeof CheckCircle2; color: string; label: string }
> = {
  verified: {
    icon: CheckCircle2,
    color: "text-green-600 dark:text-green-400",
    label: "verified",
  },
  partial: {
    icon: AlertTriangle,
    color: "text-amber-600 dark:text-amber-400",
    label: "partial",
  },
  missing: {
    icon: XCircle,
    color: "text-destructive",
    label: "missing",
  },
  blocking: {
    icon: XCircle,
    color: "text-destructive",
    label: "blocking",
  },
  cannot_determine: {
    icon: HelpCircle,
    color: "text-muted-foreground",
    label: "manual review",
  },
};

const CATEGORY_LABEL: Record<Knockout["category"], string> = {
  citizenship: "Citizenship",
  clearance: "Clearance",
  experience_years: "Years of experience",
  degree: "Degree",
  certification: "Certification",
  work_authorization: "Work authorization",
  other: "Other",
};

function KnockoutRow({ knockout }: { knockout: Knockout }) {
  const { icon: Icon, color, label } = VERDICT_STYLE[knockout.coverage.verdict];
  return (
    <li className="space-y-1 rounded-md border bg-background/40 p-3 text-sm">
      <div className="flex items-start gap-2">
        <Icon className={cn("mt-0.5 size-4 shrink-0", color)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{knockout.requirement}</span>
            <span className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              {CATEGORY_LABEL[knockout.category]}
            </span>
            <span
              className={cn(
                "rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                color,
                "border-current/30",
              )}
            >
              {label}
            </span>
          </div>
          <p className="mt-1 text-xs italic text-muted-foreground">
            JD: &ldquo;{knockout.jdEvidenceQuote}&rdquo;
          </p>
          {knockout.coverage.resumeSnippet && (
            <p className="mt-1 text-xs text-muted-foreground">
              {knockout.coverage.source === "kb" ? "KB" : "Resume"}:{" "}
              <span className="text-foreground/80">
                {knockout.coverage.resumeSnippet}
              </span>
            </p>
          )}
          {knockout.coverage.notes && (
            <p className="mt-1 text-xs text-muted-foreground/90">
              {knockout.coverage.notes}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}
