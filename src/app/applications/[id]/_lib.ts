import { cache } from "react";
import { getApplicationById } from "@/lib/applications/create";
import { getMarketResearchById } from "@/lib/applications/market-research";
import { getLatestVersion } from "@/lib/applications/drafts";
import { listVersionsForApplication } from "@/lib/applications/qc-loop";
import type { FitScore } from "@/lib/agents/fit-scorer";
import type { JdAnalysis, SeniorityLevel } from "@/lib/agents/jd-analyzer";
import type { ResumeVariant } from "@/db/schema";

/**
 * React `cache()` dedupes within a single request. Each page (Overview,
 * Draft, Screening, Submit) plus the shared layout calls these without
 * re-hitting the DB.
 */
export const loadApp = cache(async (id: string) => {
  return getApplicationById(id);
});

export const loadLatestVersion = cache(async (id: string) => {
  return getLatestVersion(id);
});

export const loadAllVersions = cache(async (id: string) => {
  return listVersionsForApplication(id);
});

export const loadMarketResearch = cache(async (researchId: string | null) => {
  if (!researchId) return null;
  return getMarketResearchById(researchId);
});

export type LoadedApp = NonNullable<Awaited<ReturnType<typeof loadApp>>>;

/**
 * Recover a typed `FitScore` from either the newer `fitScoreDetail` column
 * or the legacy split fields. Returns null when no scoring has happened.
 */
export function parseFitScore(
  app: Awaited<ReturnType<typeof loadApp>>,
): FitScore | null {
  if (!app) return null;
  if (app.fitScoreDetail) return app.fitScoreDetail as FitScore;
  if (app.fitScore === null || app.fitScore === undefined) return null;
  // Legacy fallback (applications scored before fitScoreDetail column existed).
  return {
    overall: Math.round(app.fitScore),
    dimensions: [],
    topStrengths: [],
    topGaps: [],
    reasoning: app.fitScoreReasoning ?? "",
    recommendation:
      app.fitScore >= 85
        ? "strong_proceed"
        : app.fitScore >= 70
          ? "proceed"
          : app.fitScore >= 55
            ? "borderline"
            : "pass",
  };
}

/**
 * Recommend long-vs-short resume variant from seniority signal in JD.
 */
export function recommendVariant(seniority: SeniorityLevel): {
  variant: ResumeVariant;
  why: string;
} {
  const longSeniorities: SeniorityLevel[] = [
    "senior_manager",
    "director",
    "vp",
    "c_level",
  ];
  if (longSeniorities.includes(seniority)) {
    return {
      variant: "long",
      why: "The role is senior — a two-page resume gives breadth + depth of evidence without forcing brutal cuts to your federal track record.",
    };
  }
  return {
    variant: "short",
    why: "A one-page resume keeps focus tight; expand to long only if the JD context (federal-exec, deep technical) rewards breadth.",
  };
}

/**
 * Whether to render the KB-coverage / knockout / vendor cards. We hide
 * them once an application has moved past the active pipeline so the page
 * isn't cluttered with no-longer-actionable data.
 */
const POST_PIPELINE_STATUSES = new Set([
  "applied",
  "phone_screen",
  "interview",
  "offer",
  "rejected",
  "ghosted",
  "withdrawn",
]);

export function showCoverageFor(app: LoadedApp, analysis: JdAnalysis | null): boolean {
  return analysis !== null && !POST_PIPELINE_STATUSES.has(app.status);
}

export const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  in_progress: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  ready: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  applied: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  phone_screen: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  interview: "bg-purple-500/10 text-purple-700 dark:text-purple-300",
  offer: "bg-green-500/10 text-green-700 dark:text-green-300",
  rejected: "bg-destructive/10 text-destructive",
  ghosted: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  withdrawn: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
};
