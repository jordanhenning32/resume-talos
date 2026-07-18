"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  FileWarning,
  ScanLine,
  XCircle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type {
  AtsCoverageVerdict,
  CombinedAtsReport,
  CombinedPhraseCoverage,
} from "@/lib/agents/ats-simulator";
import type { ScreeningSimilarity } from "@/lib/agents/screening-similarity";

const VERDICT_STYLE: Record<
  AtsCoverageVerdict,
  { icon: typeof CheckCircle2; color: string; short: string }
> = {
  verbatim: {
    icon: CheckCircle2,
    color: "text-green-600 dark:text-green-400",
    short: "verbatim",
  },
  partial: {
    icon: AlertTriangle,
    color: "text-amber-600 dark:text-amber-400",
    short: "partial",
  },
  missing: {
    icon: XCircle,
    color: "text-destructive",
    short: "missing",
  },
};

/** Numeric "badness" of a row for sorting — worst on top. */
function rowBadness(c: CombinedPhraseCoverage): number {
  const weight = (v: AtsCoverageVerdict) =>
    v === "missing" ? 2 : v === "partial" ? 1 : 0;
  // Category multiplier: must-haves first
  const catMul =
    c.category === "must_have" ? 4 : c.category === "key_language" ? 2 : 1;
  return -(weight(c.resume) + weight(c.coverLetter)) * catMul;
}

export function AtsCoverageCard({
  report,
  similarity,
}: {
  report: CombinedAtsReport;
  similarity?: ScreeningSimilarity | null;
}) {
  const [showVerbatim, setShowVerbatim] = useState(false);
  const [showKeyLanguage, setShowKeyLanguage] = useState(false);
  const [showNiceToHave, setShowNiceToHave] = useState(false);

  if (report.combined.length === 0) return null;

  const blended = report.blendedScore;
  const borderTone =
    blended >= 85
      ? "border-green-500/30 bg-green-500/5"
      : blended >= 65
        ? "border-blue-500/20 bg-blue-500/5"
        : blended >= 45
          ? "border-amber-500/30 bg-amber-500/5"
          : "border-destructive/30 bg-destructive/5";

  // Filter sets by category for the three lists.
  const mustHaveRows = report.combined
    .filter((c) => c.category === "must_have")
    .sort((a, b) => rowBadness(a) - rowBadness(b));
  const keyLangRows = report.combined
    .filter((c) => c.category === "key_language")
    .sort((a, b) => rowBadness(a) - rowBadness(b));
  const niceRows = report.combined
    .filter((c) => c.category === "nice_to_have")
    .sort((a, b) => rowBadness(a) - rowBadness(b));

  // Hide verbatim-on-both rows from the must-have list by default
  const mustHaveVisible = showVerbatim
    ? mustHaveRows
    : mustHaveRows.filter(
        (c) => !(c.resume === "verbatim" && c.coverLetter === "verbatim"),
      );

  const verbatimBothCount = mustHaveRows.filter(
    (c) => c.resume === "verbatim" && c.coverLetter === "verbatim",
  ).length;

  return (
    <Card className={cn(borderTone)}>
      <CardHeader>
        <div className="space-y-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ScanLine className="size-4" /> AI screening coverage
          </CardTitle>

          {/* Row 1 — keyword coverage (literal substring matching ATS) */}
          <div className="flex flex-wrap items-center gap-3 rounded-md border bg-card/40 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Keyword
              <div className="text-[9px] font-normal opacity-70">substring match</div>
            </div>
            <div className="ml-auto flex items-center gap-4">
              <ScoreBlock
                label="Resume"
                score={report.resumeScore}
                note={`${report.resume.verbatimCount}v · ${report.resume.partialCount}p · ${report.resume.missingCount}m`}
              />
              <ScoreBlock
                label="Cover"
                score={report.coverLetterScore}
                note={`${report.coverLetter.verbatimCount}v · ${report.coverLetter.partialCount}p · ${report.coverLetter.missingCount}m`}
              />
              <ScoreBlock label="Blended" score={blended} highlight />
            </div>
          </div>

          {/* Row 2 — semantic similarity (embedding-based AI ATS) */}
          {similarity && (
            <div className="flex flex-wrap items-center gap-3 rounded-md border bg-card/40 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Semantic
                <div className="text-[9px] font-normal opacity-70">embedding similarity</div>
              </div>
              <div className="ml-auto flex items-center gap-4">
                <ScoreBlock
                  label="Resume"
                  score={similarity.resumeScore}
                  note={`sim ${similarity.resumeSim.toFixed(2)}`}
                />
                {similarity.coverLetterScore != null && (
                  <ScoreBlock
                    label="Cover"
                    score={similarity.coverLetterScore}
                    note={`sim ${(similarity.coverLetterSim ?? 0).toFixed(2)}`}
                  />
                )}
                {similarity.blendedScore != null && (
                  <ScoreBlock label="Blended" score={similarity.blendedScore} highlight />
                )}
              </div>
            </div>
          )}
        </div>
        <CardDescription className="mt-3">
          Two layers of modern AI screening: literal-keyword ATS (Workday,
          Greenhouse, Taleo) and embedding-similarity ATS (Eightfold,
          ModernHire, HireVue Assessments). Keyword score weights resume 70% /
          cover 30%; semantic similarity is calibrated cosine sim (1.0 ≈
          rewritten from JD; 0.3 ≈ unrelated).
          {report.missingFromBothCount > 0 && (
            <span className="ml-1 font-medium text-destructive">
              {`${report.missingFromBothCount} must-have${report.missingFromBothCount === 1 ? "" : "s"} missing from BOTH docs — top revision targets.`}
            </span>
          )}
        </CardDescription>
        <RoleTitleStatusRow coverage={report.roleTitleCoverage} />
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          <span className="flex-1">Must-have keyphrase</span>
          <span className="w-16 text-center">Resume</span>
          <span className="w-16 text-center">Cover</span>
        </div>
        <ul className="space-y-1">
          {mustHaveVisible.map((c) => (
            <PhraseRow key={c.phrase} coverage={c} />
          ))}
        </ul>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
          <button
            type="button"
            onClick={() => setShowVerbatim((v) => !v)}
            className="text-muted-foreground hover:text-foreground"
          >
            {showVerbatim
              ? `Hide verbatim-on-both (${verbatimBothCount})`
              : `Show all must-haves (${mustHaveRows.length})`}
          </button>
          <div className="flex items-center gap-3">
            {keyLangRows.length > 0 && (
              <button
                type="button"
                onClick={() => setShowKeyLanguage((v) => !v)}
                className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
              >
                <ChevronDown
                  className={cn(
                    "size-3 transition-transform",
                    showKeyLanguage && "rotate-180",
                  )}
                />
                JD key language ({keyLangRows.length})
              </button>
            )}
            {niceRows.length > 0 && (
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
                Nice-to-have ({niceRows.length})
              </button>
            )}
          </div>
        </div>

        {showKeyLanguage && keyLangRows.length > 0 && (
          <ul className="space-y-1 border-t pt-3">
            {keyLangRows.map((c) => (
              <PhraseRow key={c.phrase} coverage={c} muted />
            ))}
          </ul>
        )}
        {showNiceToHave && niceRows.length > 0 && (
          <ul className="space-y-1 border-t pt-3">
            {niceRows.map((c) => (
              <PhraseRow key={c.phrase} coverage={c} muted />
            ))}
          </ul>
        )}

        {report.missingFromBothCount > 0 && (
          <div className="mt-1 rounded-md border bg-card/60 p-3 text-xs">
            <p className="font-semibold uppercase tracking-wide text-muted-foreground">
              How to act on gaps
            </p>
            <p className="mt-1 leading-relaxed text-muted-foreground">
              Re-run the QC loop. The consolidator now receives ATS items for
              BOTH docs — the resume writer addresses resume gaps, the cover
              letter writer addresses cover-letter gaps. Per-doc suggestions
              point at the right place (bullets/skills for the resume; prose
              integration for the cover letter). Phrases with no KB grounding
              stay flagged — the guardrail prevents fabrication.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RoleTitleStatusRow({
  coverage,
}: {
  coverage: CombinedAtsReport["roleTitleCoverage"];
}) {
  if (!coverage.jdTitle) return null;

  const styleByVerdict: Record<
    typeof coverage.verdict,
    {
      icon: typeof CheckCircle2;
      iconColor: string;
      label: string;
      borderColor: string;
      bgColor: string;
    }
  > = {
    verbatim: {
      icon: CheckCircle2,
      iconColor: "text-green-600 dark:text-green-400",
      label: "Role title present in Summary",
      borderColor: "border-green-500/30",
      bgColor: "bg-green-500/5",
    },
    partial: {
      icon: AlertTriangle,
      iconColor: "text-amber-600 dark:text-amber-400",
      label: `Role title partially in Summary (${coverage.matchedContentWords}/${coverage.totalContentWords} words)`,
      borderColor: "border-amber-500/30",
      bgColor: "bg-amber-500/5",
    },
    missing: {
      icon: XCircle,
      iconColor: "text-destructive",
      label: "JD role title missing from Summary",
      borderColor: "border-destructive/30",
      bgColor: "bg-destructive/5",
    },
    no_summary: {
      icon: FileWarning,
      iconColor: "text-destructive",
      label: "Resume has no Summary section",
      borderColor: "border-destructive/30",
      bgColor: "bg-destructive/5",
    },
  };
  const s = styleByVerdict[coverage.verdict];
  return (
    <div
      className={cn(
        "mt-3 flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs",
        s.borderColor,
        s.bgColor,
      )}
    >
      <s.icon className={cn("size-3.5 shrink-0", s.iconColor)} />
      <span className="font-medium">{s.label}</span>
      <span className="ml-auto truncate font-mono text-muted-foreground">
        JD: &ldquo;{coverage.jdTitle}&rdquo;
      </span>
    </div>
  );
}

function ScoreBlock({
  label,
  score,
  note,
  highlight = false,
}: {
  label: string;
  score: number;
  note?: string;
  highlight?: boolean;
}) {
  const color =
    score >= 85
      ? "text-green-600 dark:text-green-400"
      : score >= 65
        ? "text-blue-600 dark:text-blue-400"
        : score >= 45
          ? "text-amber-600 dark:text-amber-400"
          : "text-destructive";
  return (
    <div className="text-right">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          highlight ? "text-2xl" : "text-lg",
          "font-semibold tabular-nums",
          color,
        )}
      >
        {score}
        <span className="text-xs text-muted-foreground">/100</span>
      </div>
      {note && (
        <div className="font-mono text-[10px] text-muted-foreground">{note}</div>
      )}
    </div>
  );
}

function PhraseRow({
  coverage,
  muted = false,
}: {
  coverage: CombinedPhraseCoverage;
  muted?: boolean;
}) {
  const resume = VERDICT_STYLE[coverage.resume];
  const cover = VERDICT_STYLE[coverage.coverLetter];
  const isBothMissing =
    coverage.resume === "missing" && coverage.coverLetter === "missing";
  return (
    <li
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1 text-sm",
        isBothMissing && "bg-destructive/5",
        muted && "opacity-80",
      )}
    >
      <span className="min-w-0 flex-1 truncate font-medium">
        {coverage.phrase}
      </span>
      <span
        className="flex w-16 items-center justify-center gap-1 text-xs"
        title={`Resume: ${resume.short}`}
      >
        <resume.icon className={cn("size-4", resume.color)} />
      </span>
      <span
        className="flex w-16 items-center justify-center gap-1 text-xs"
        title={`Cover letter: ${cover.short}`}
      >
        <cover.icon className={cn("size-4", cover.color)} />
      </span>
    </li>
  );
}
