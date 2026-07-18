import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  applicationVersions,
  applications,
  qcReviews,
  type ApplicationVersion,
} from "@/db/schema";
import {
  writeCoverLetter,
  type WriteCoverLetterOptions,
} from "@/lib/agents/cover-letter-writer";
import {
  writeResume,
  type ConsolidatedFeedbackItem,
  type WriteResumeOptions,
} from "@/lib/agents/resume-writer";
import {
  consolidateReviews,
  type Consolidation,
} from "@/lib/agents/qc-consolidator";
import {
  runQcReviewer,
  type QcReview,
} from "@/lib/agents/qc-reviewer";
import { runScreener, type ScreenerOutput } from "@/lib/agents/screener";
import type { JdAnalysis } from "@/lib/agents/jd-analyzer";
import {
  atsReportToFeedbackItems,
  combineAtsReports,
  roleTitleFeedbackItem,
} from "@/lib/agents/ats-simulator";
import {
  recruiterSimToFeedbackItems,
  runRecruiterSimulation,
} from "@/lib/agents/recruiter-simulator";
import {
  knockoutReportToFeedbackItems,
  runKnockoutScan,
  type KnockoutReport,
} from "@/lib/agents/knockout-detector";
import { getApplicationById } from "./create";
import { getMarketResearchById } from "./market-research";
import { getLatestVersion } from "./drafts";
import { insertIterationApplicationVersion } from "./versioning";
import { getWriterDirectives } from "@/lib/settings";
import { modelFor } from "@/lib/models/registry";

/**
 * Default cap on QC review cycles. The third iteration empirically hits a
 * quality ceiling without adding material improvement, so we stop at 2 by
 * default. The UI exposes a "Run another iteration" option that bumps the
 * cap by 1 for the rare cases where the user wants one more swing.
 */
export const DEFAULT_MAX_QC_ITERATIONS = 2;
export const APPROVAL_SCORE = 90;

/** Legacy alias for any external readers — same value as the default. */
export const MAX_QC_ITERATIONS = DEFAULT_MAX_QC_ITERATIONS;

export type QcLoopOutcome = {
  status: "approved" | "escalated" | "noop";
  iterationsRun: number;
  finalVersion: ApplicationVersion;
  costUsd: number;
  reason: string;
};

export type QcLoopOptions = {
  /**
   * Override the iteration cap. Default is DEFAULT_MAX_QC_ITERATIONS (2).
   * Used by the "Run another iteration" flow to allow one more cycle past
   * the default cap.
   */
  maxIterations?: number;
};

type QcStopFeedbackItem = Pick<ConsolidatedFeedbackItem, "priority">;

export function getQcStopBlockingItems(opts: {
  consolidatedItems: QcStopFeedbackItem[];
  deterministicItems?: QcStopFeedbackItem[];
}): QcStopFeedbackItem[] {
  return [
    ...opts.consolidatedItems,
    ...(opts.deterministicItems ?? []),
  ].filter((item) => item.priority === "high");
}

export function shouldApproveQcStop(opts: {
  reviewAOverall: number;
  reviewBOverall: number;
  consolidatedItems: QcStopFeedbackItem[];
  deterministicItems?: QcStopFeedbackItem[];
  approvalScore?: number;
}): boolean {
  const approvalScore = opts.approvalScore ?? APPROVAL_SCORE;
  const bothPassThreshold =
    opts.reviewAOverall >= approvalScore && opts.reviewBOverall >= approvalScore;
  return (
    bothPassThreshold &&
    getQcStopBlockingItems({
      consolidatedItems: opts.consolidatedItems,
      deterministicItems: opts.deterministicItems,
    }).length === 0
  );
}

/**
 * Run the QC loop on the latest application version.
 *
 * For each iteration up to the (overridable) cap:
 *   1. Score the current version: Screener (iter 0 only) + Reviewer A + Reviewer B (parallel)
 *   2. Persist scores to the version row + qc_reviews audit table
 *   3. Consolidate feedback into High/Medium/Low
 *   4. Stop if both reviewers >= APPROVAL_SCORE AND no high-priority items
 *   5. Otherwise, revise both docs in parallel and save as the next iteration
 *
 * Escalates after the cap without hitting the stop condition.
 */
export async function runQcLoopForApplication(
  applicationId: string,
  options?: QcLoopOptions,
): Promise<QcLoopOutcome> {
  const maxIterations = options?.maxIterations ?? DEFAULT_MAX_QC_ITERATIONS;
  const app = await getApplicationById(applicationId);
  if (!app) throw new Error(`Application ${applicationId} not found.`);
  if (!app.jdAnalysis) throw new Error("Application is missing JD analysis.");

  const jdAnalysis = app.jdAnalysis as unknown as JdAnalysis;
  const directives = await getWriterDirectives();
  const research = app.marketResearchId
    ? await getMarketResearchById(app.marketResearchId)
    : null;

  const latest = await getLatestVersion(applicationId);
  if (!latest) throw new Error("No drafts to review — generate drafts first.");
  if (latest.isFinal === "true") {
    return {
      status: "noop",
      iterationsRun: 0,
      finalVersion: latest,
      costUsd: 0,
      reason: "Latest version is already marked final.",
    };
  }
  if (latest.iteration >= maxIterations) {
    return {
      status: "escalated",
      iterationsRun: 0,
      finalVersion: latest,
      costUsd: 0,
      reason: "Latest iteration already at maxIterations — escalated.",
    };
  }

  let working = latest;
  let totalCost = 0;
  let iterationsRun = 0;

  for (let iter = working.iteration; iter < maxIterations; iter++) {
    iterationsRun++;

    // 1. Parallel: screener (iter 0 only) + both reviewers + recruiter sim
    const isFirstIteration = iter === 0;
    const reviewOpts = {
      jdAnalysis,
      resumeMarkdown: working.resumeMarkdown ?? "",
      coverLetterMarkdown: working.coverLetterMarkdown ?? "",
      applicationId,
      applicationVersionId: working.id,
    };

    const [
      screenerResult,
      reviewAResult,
      reviewBResult,
      recruiterSimResult,
    ] = await Promise.all([
      isFirstIteration ? runScreener(reviewOpts) : Promise.resolve(null),
      runQcReviewer({ reviewerRole: "reviewer_a", ...reviewOpts }),
      runQcReviewerBWithFallback({ reviewerRole: "reviewer_b", ...reviewOpts }),
      // Recruiter sim runs on every iteration so feedback always reflects
      // the CURRENT draft. ~$0.02 per iter; small fraction of loop cost,
      // big lift in human-perspective signal.
      app.jdText
        ? runRecruiterSimulation({
            jdAnalysis,
            jdText: app.jdText,
            resumeMarkdown: working.resumeMarkdown ?? "",
            coverLetterMarkdown: working.coverLetterMarkdown ?? "",
            applicationId,
            applicationVersionId: working.id,
          })
        : Promise.resolve(null),
    ]);

    totalCost +=
      (screenerResult?.costUsd ?? 0) +
      reviewAResult.costUsd +
      reviewBResult.costUsd +
      (recruiterSimResult?.costUsd ?? 0);

    // Persist recruiter sim result to the application row so the standalone
    // card reflects the latest evaluation. Overwrites any prior manual run.
    if (recruiterSimResult) {
      await db()
        .update(applications)
        .set({
          recruiterScreenerResult: {
            ...recruiterSimResult.output,
            resumeVersionId: working.id,
          },
          recruiterScreenerAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(applications.id, applicationId));
    }

    // 2. Persist scores to the version row
    await db()
      .update(applicationVersions)
      .set({
        screenerScore: screenerResult
          ? {
              overall: screenerResult.output.overall,
              dimensions: Object.fromEntries(
                Object.entries(screenerResult.output.dimensions).map(([k, v]) => [
                  k,
                  v.score,
                ]),
              ),
              feedback: screenerResult.output.highImpactSuggestions,
              model: screenerResult.model,
              provider: screenerResult.provider,
            }
          : null,
        qcAScore: {
          overall: reviewAResult.output.overall,
          dimensions: Object.fromEntries(
            Object.entries(reviewAResult.output.dimensions).map(([k, v]) => [
              k,
              v.score,
            ]),
          ),
          model: reviewAResult.model,
          provider: reviewAResult.provider,
        },
        qcBScore: {
          overall: reviewBResult.output.overall,
          dimensions: Object.fromEntries(
            Object.entries(reviewBResult.output.dimensions).map(([k, v]) => [
              k,
              v.score,
            ]),
          ),
          model: reviewBResult.model,
          provider: reviewBResult.provider,
          fallbackFrom: reviewBResult.fallbackFrom ?? null,
        },
      })
      .where(eq(applicationVersions.id, working.id));

    // 2b. Persist qc_reviews audit rows (one per reviewer × document)
    await persistQcReviewRows({
      applicationVersionId: working.id,
      reviewA: reviewAResult.output,
      reviewB: reviewBResult.output,
      screener: screenerResult?.output ?? null,
    });

    // 3. Consolidate
    const consolidated = await consolidateReviews({
      reviewA: reviewAResult.output,
      reviewB: reviewBResult.output,
      screener: screenerResult?.output ?? null,
      applicationId,
      applicationVersionId: working.id,
    });
    totalCost += consolidated.costUsd;

    // 4. Deterministic gates + stop conditions. These checks feed both the
    // approval decision and the revision payload; an otherwise happy pair of
    // reviewers should not ship a draft that still misses hard ATS/knockout
    // requirements.
    let knockoutReport: KnockoutReport | null = null;
    if (app.jdText) {
      try {
        knockoutReport = await runKnockoutScan({
          jdText: app.jdText,
          jdAnalysis,
          resumeMarkdown: working.resumeMarkdown ?? "",
          resumeVersionId: working.id,
          applicationId,
        });
        totalCost += knockoutReport.costUsd;
        await db()
          .update(applications)
          .set({
            knockoutReport,
            knockoutReportAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(applications.id, applicationId));
      } catch (err) {
        // Don't fail the loop if the knockout scan trips - the rest of the
        // payload is still useful. Surface as a warning in logs only.
        console.warn(
          `[qc-loop] knockout scan failed for application ${applicationId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    const knockoutItems = knockoutReport
      ? knockoutReportToFeedbackItems(knockoutReport)
      : [];

    const atsCombined = combineAtsReports({
      resumeMarkdown: working.resumeMarkdown ?? "",
      coverLetterMarkdown: working.coverLetterMarkdown ?? "",
      mustHaveSkills: jdAnalysis.mustHaveSkills,
      niceToHaveSkills: jdAnalysis.niceToHaveSkills,
      keyLanguagePatterns: jdAnalysis.keyLanguagePatterns,
      jdRoleTitle: jdAnalysis.roleTitle,
    });
    const atsResumeItems = atsReportToFeedbackItems(
      atsCombined.resume,
      "resume",
      { combined: atsCombined.combined },
    );
    const atsCoverItems = atsReportToFeedbackItems(
      atsCombined.coverLetter,
      "cover_letter",
      { combined: atsCombined.combined },
    );
    const roleTitleItem = roleTitleFeedbackItem(atsCombined.roleTitleCoverage);
    const recruiterItems = recruiterSimResult
      ? recruiterSimToFeedbackItems(recruiterSimResult.output)
      : [];
    const deterministicFeedback = [
      ...knockoutItems,
      ...recruiterItems,
      ...(roleTitleItem ? [roleTitleItem] : []),
      ...atsResumeItems,
      ...atsCoverItems,
    ] satisfies ConsolidatedFeedbackItem[];
    const consolidatedFeedback = consolidated.output.items.map((i) => ({
      priority: i.priority,
      doc: i.doc,
      location: i.location ?? null,
      issue: i.issue,
      suggestion: i.suggestion,
    })) satisfies ConsolidatedFeedbackItem[];

    const highPriority = getQcStopBlockingItems({
      consolidatedItems: consolidatedFeedback,
      deterministicItems: deterministicFeedback,
    });
    const shouldStop = shouldApproveQcStop({
      reviewAOverall: reviewAResult.output.overall,
      reviewBOverall: reviewBResult.output.overall,
      consolidatedItems: consolidatedFeedback,
      deterministicItems: deterministicFeedback,
    });

    if (shouldStop) {
      await db()
        .update(applicationVersions)
        .set({ isFinal: "true" })
        .where(eq(applicationVersions.id, working.id));
      await db()
        .update(applications)
        .set({
          finalVersionId: working.id,
          status: "ready",
          updatedAt: new Date(),
          statusUpdatedAt: new Date(),
        })
        .where(eq(applications.id, applicationId));
      return {
        status: "approved",
        iterationsRun,
        finalVersion: working,
        costUsd: round6(totalCost),
        reason: `Both reviewers >= ${APPROVAL_SCORE} (A=${reviewAResult.output.overall}, B=${reviewBResult.output.overall}) with no high-priority items.`,
      };
    }

    // Last iteration without stop → escalate
    if (iter === maxIterations - 1) {
      return {
        status: "escalated",
        iterationsRun,
        finalVersion: working,
        costUsd: round6(totalCost),
        reason: `Reached maxIterations (${maxIterations}) without meeting the approval threshold. Latest scores A=${reviewAResult.output.overall}, B=${reviewBResult.output.overall}, ${highPriority.length} high-priority items remain.`,
      };
    }

    // 5. Revise — merge ATS gap items (for BOTH docs) with consolidated
    //    reviewer feedback. Single combined scan so per-doc items can be
    //    flagged "[MISSING FROM BOTH DOCS]" when both the resume and cover
    //    letter are missing the same keyword. ATS items are listed FIRST in
    //    the payload so they appear at the top of the writer's priority
    //    buckets — mechanical keyword fixes are the cheapest wins and the
    //    writer is told (via its system prompt) to address them deliberately.
    // Knockout scan runs on every revision pass against the CURRENT draft so
    // the writer is told which hard JD requirements (citizenship, clearance,
    // experience years, degree, certifications) the resume hasn't explicitly
    // answered. These are filter-level concerns — a missing knockout can
    // cause an instant-reject from ATS regardless of keyword score. We
    // surface them at the TOP of the revision payload.
    const revisionPayload = [
      // Knockout questions FIRST — these are filter-level concerns. A
      // missing knockout (no explicit citizenship/clearance/years/degree/
      // cert claim) can drop an application from many ATS regardless of
      // keyword score. The writer must address these before anything else.
      ...knockoutItems,
      // Recruiter judgment next within HIGH — highest-leverage human-side
      // signal about WHY a human would advance or pass on this candidate.
      ...recruiterItems,
      // Structure (role title in Summary) — high-impact mechanical fix.
      ...(roleTitleItem ? [roleTitleItem] : []),
      // Keyword coverage for both docs.
      ...atsResumeItems,
      ...atsCoverItems,
      // Human reviewer feedback last — most of these are bullet-level polish.
      ...consolidatedFeedback,
    ] satisfies ConsolidatedFeedbackItem[];

    const resumeOpts: WriteResumeOptions = {
      variant: (app.variant as "long" | "short") ?? "long",
      jdAnalysis,
      directives,
      applicationId,
      applicationVersionId: working.id,
      research,
      userEditsOnResearch: research?.userEdits ?? null,
      // Pass the latest knockout report so the cached prefix stays stable
      // across iter 0 (initial draft) and iter 1+ (revisions). Without
      // this the writer would see a different cached prefix per call and
      // miss prompt-cache hits. The revision feedback ALSO contains the
      // knockout items (at the top of HIGH), so this serves as redundant
      // context, not the primary signal during revisions.
      knockoutReport,
      revision: {
        priorMarkdown: working.resumeMarkdown ?? "",
        feedback: revisionPayload,
        iteration: iter + 1,
      },
    };
    const coverOpts: WriteCoverLetterOptions = {
      jdAnalysis,
      directives,
      research,
      userEditsOnResearch: research?.userEdits ?? null,
      applicationId,
      applicationVersionId: working.id,
      knockoutReport,
      revision: {
        priorMarkdown: working.coverLetterMarkdown ?? "",
        feedback: revisionPayload,
        iteration: iter + 1,
      },
    };

    const [resume, cover] = await Promise.all([
      writeResume(resumeOpts),
      writeCoverLetter(coverOpts),
    ]);
    totalCost += resume.totalCostUsd + cover.totalCostUsd;

    // 6. Save as next iteration row
    const next = await insertIterationApplicationVersion({
      applicationId,
      versionNumber: working.versionNumber,
      iteration: iter + 1,
      resumeMarkdown: resume.output.markdown,
      coverLetterMarkdown: cover.output.markdown,
      citedFactIds: Array.from(
        new Set([
          ...resume.output.citedFactIds,
          ...cover.output.citedFactIds,
        ]),
      ),
    });
    working = next;
  }

  return {
    status: "escalated",
    iterationsRun,
    finalVersion: working,
    costUsd: round6(totalCost),
    reason: "Loop exited unexpectedly.",
  };
}

async function persistQcReviewRows(opts: {
  applicationVersionId: string;
  reviewA: QcReview;
  reviewB: QcReview;
  screener: ScreenerOutput | null;
}) {
  type ReviewerKind = "qc_a" | "qc_b" | "screener";
  const rows: Array<{
    applicationVersionId: string;
    reviewer: ReviewerKind;
    documentKind: string;
    criticalIssues: string[];
    importantImprovements: string[];
    minorSuggestions: string[];
    overallScore: number | null;
    dimensionScores: Record<string, number>;
    rawResponse: string;
  }> = [];

  rows.push({
    applicationVersionId: opts.applicationVersionId,
    reviewer: "qc_a",
    documentKind: "combined",
    criticalIssues: opts.reviewA.criticalIssues.map(
      (i) => `[${i.doc}${i.location ? ` · ${i.location}` : ""}] ${i.issue} → ${i.suggestion}`,
    ),
    importantImprovements: opts.reviewA.importantImprovements.map(
      (i) => `[${i.doc}${i.location ? ` · ${i.location}` : ""}] ${i.issue} → ${i.suggestion}`,
    ),
    minorSuggestions: opts.reviewA.minorSuggestions.map(
      (i) => `[${i.doc}${i.location ? ` · ${i.location}` : ""}] ${i.issue} → ${i.suggestion}`,
    ),
    overallScore: opts.reviewA.overall,
    dimensionScores: Object.fromEntries(
      Object.entries(opts.reviewA.dimensions).map(([k, v]) => [k, v.score]),
    ),
    rawResponse: JSON.stringify(opts.reviewA),
  });

  rows.push({
    applicationVersionId: opts.applicationVersionId,
    reviewer: "qc_b",
    documentKind: "combined",
    criticalIssues: opts.reviewB.criticalIssues.map(
      (i) => `[${i.doc}${i.location ? ` · ${i.location}` : ""}] ${i.issue} → ${i.suggestion}`,
    ),
    importantImprovements: opts.reviewB.importantImprovements.map(
      (i) => `[${i.doc}${i.location ? ` · ${i.location}` : ""}] ${i.issue} → ${i.suggestion}`,
    ),
    minorSuggestions: opts.reviewB.minorSuggestions.map(
      (i) => `[${i.doc}${i.location ? ` · ${i.location}` : ""}] ${i.issue} → ${i.suggestion}`,
    ),
    overallScore: opts.reviewB.overall,
    dimensionScores: Object.fromEntries(
      Object.entries(opts.reviewB.dimensions).map(([k, v]) => [k, v.score]),
    ),
    rawResponse: JSON.stringify(opts.reviewB),
  });

  if (opts.screener) {
    rows.push({
      applicationVersionId: opts.applicationVersionId,
      reviewer: "screener",
      documentKind: "combined",
      criticalIssues: [],
      importantImprovements: opts.screener.highImpactSuggestions,
      minorSuggestions: [],
      overallScore: opts.screener.overall,
      dimensionScores: Object.fromEntries(
        Object.entries(opts.screener.dimensions).map(([k, v]) => [k, v.score]),
      ),
      rawResponse: JSON.stringify(opts.screener),
    });
  }

  await db().insert(qcReviews).values(rows);
}

type QcReviewerRun = Awaited<ReturnType<typeof runQcReviewer>> & {
  fallbackFrom?: {
    provider: string;
    model: string;
    reason: string;
  };
};

async function runQcReviewerBWithFallback(
  opts: Parameters<typeof runQcReviewer>[0],
): Promise<QcReviewerRun> {
  try {
    return await runQcReviewer(opts);
  } catch (err) {
    if (opts.reviewerRole !== "reviewer_b" || !isProviderAccessFailure(err)) {
      throw err;
    }

    const primary = modelFor("reviewer_b");
    const reason = getErrorMessage(err);
    console.warn(
      `[qc-loop] Reviewer B primary model ${primary.model} failed with access error; retrying with reviewer_a model. Reason: ${reason}`,
    );

    const fallback = await runQcReviewer({
      ...opts,
      modelRole: "reviewer_a",
      agentName: "qc_reviewer_b_fallback",
    });

    return {
      ...fallback,
      fallbackFrom: {
        provider: primary.provider,
        model: primary.model,
        reason,
      },
    };
  }
}

function isProviderAccessFailure(err: unknown): boolean {
  const maybeStatus = err as { status?: unknown; statusCode?: unknown };
  const status =
    typeof maybeStatus.status === "number"
      ? maybeStatus.status
      : typeof maybeStatus.statusCode === "number"
        ? maybeStatus.statusCode
        : null;
  if (status === 401 || status === 403) return true;

  return /forbidden|unauthori[sz]ed|permission|credit|spending limit|quota/i.test(
    getErrorMessage(err),
  );
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

export async function listVersionsForApplication(
  applicationId: string,
): Promise<ApplicationVersion[]> {
  // Chronological order: oldest first, newest last. Must order by
  // versionNumber primarily because multiple versionNumbers can each have
  // their own iteration 0..N — sorting only by iteration jumbles them.
  return db()
    .select()
    .from(applicationVersions)
    .where(eq(applicationVersions.applicationId, applicationId))
    .orderBy(asc(applicationVersions.versionNumber), asc(applicationVersions.iteration));
}

export async function getLatestConsolidation(
  applicationId: string,
): Promise<Consolidation | null> {
  // Latest version's score block already captures the scores; the
  // qc_reviews table is the audit. For now we don't store the consolidation
  // separately — UI reconstructs the "to be addressed" view from qcReviews +
  // versions. Returning null here is intentional; reserved for future use.
  void applicationId;
  return null;
}
