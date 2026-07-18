import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  applicationVersions,
  applications,
  type ApplicationVersion,
} from "@/db/schema";
import { writeCoverLetter } from "@/lib/agents/cover-letter-writer";
import { writeResume } from "@/lib/agents/resume-writer";
import type { JdAnalysis } from "@/lib/agents/jd-analyzer";
import {
  runKnockoutScan,
  type KnockoutReport,
} from "@/lib/agents/knockout-detector";
import { kbFacts } from "@/db/schema";
import { getApplicationById } from "./create";
import { getMarketResearchById } from "./market-research";
import { getWriterDirectives } from "@/lib/settings";
import type { FactType, KnockoutReportShape } from "@/db/schema";
import {
  insertMajorApplicationVersion,
  isVersionBoundReportFresh,
} from "./versioning";

export type GenerateDraftsResult = {
  version: ApplicationVersion;
  costUsd: number;
  factsUsedResume: number;
  factsUsedCoverLetter: number;
};

export async function generateDraftsForApplication(
  applicationId: string,
): Promise<GenerateDraftsResult> {
  const app = await getApplicationById(applicationId);
  if (!app) throw new Error(`Application ${applicationId} not found.`);
  if (app.fitApproved !== "true") {
    throw new Error("Fit must be approved before drafts can be generated.");
  }
  if (!app.variant) {
    throw new Error("Resume variant must be selected before drafts can be generated.");
  }
  if (app.marketResearchApproved !== "true") {
    throw new Error("Market research must be approved before drafts can be generated.");
  }
  if (!app.jdAnalysis) {
    throw new Error("JD analysis missing — cannot draft.");
  }

  const jdAnalysis = app.jdAnalysis as unknown as JdAnalysis;
  const directives = await getWriterDirectives();
  const research = app.marketResearchId
    ? await getMarketResearchById(app.marketResearchId)
    : null;

  // Knockout context for the writers — they need to see the JD's hard
  // requirements + KB coverage status on the INITIAL draft, not just on
  // QC revisions. Prefer the cached report (just-ran KB-fallback scan
  // already accounts for the no-resume state). Fall back to a fresh scan
  // if none cached, so writers always have it. ~$0.003 + KB query.
  const knockoutReport = await loadKnockoutReportForWriters(app, jdAnalysis);

  // Run writers in parallel.
  const [resume, coverLetter] = await Promise.all([
    writeResume({
      variant: app.variant,
      jdAnalysis,
      directives,
      applicationId,
      research,
      userEditsOnResearch: research?.userEdits ?? null,
      knockoutReport,
    }),
    writeCoverLetter({
      jdAnalysis,
      directives,
      research,
      userEditsOnResearch: research?.userEdits ?? null,
      applicationId,
      knockoutReport,
    }),
  ]);

  const citedFactIds = Array.from(
    new Set([...resume.output.citedFactIds, ...coverLetter.output.citedFactIds]),
  );

  const inserted = await insertMajorApplicationVersion({
    applicationId,
    resumeMarkdown: resume.output.markdown,
    coverLetterMarkdown: coverLetter.output.markdown,
    citedFactIds,
  });

  const totalCost =
    Math.round((resume.totalCostUsd + coverLetter.totalCostUsd) * 1_000_000) /
    1_000_000;

  return {
    version: inserted,
    costUsd: totalCost,
    factsUsedResume: resume.factsUsedCount,
    factsUsedCoverLetter: coverLetter.factsUsedCount,
  };
}

export async function listVersionsForApplication(
  applicationId: string,
): Promise<ApplicationVersion[]> {
  return db()
    .select()
    .from(applicationVersions)
    .where(eq(applicationVersions.applicationId, applicationId))
    .orderBy(desc(applicationVersions.versionNumber), desc(applicationVersions.iteration));
}

export async function getLatestVersion(
  applicationId: string,
): Promise<ApplicationVersion | null> {
  const [row] = await db()
    .select()
    .from(applicationVersions)
    .where(eq(applicationVersions.applicationId, applicationId))
    .orderBy(desc(applicationVersions.versionNumber), desc(applicationVersions.iteration))
    .limit(1);
  return row ?? null;
}

/**
 * Get a usable KnockoutReport for the writers on the INITIAL draft pass.
 * Prefer the cached report on the application row (which the user usually
 * runs via the KnockoutCard before generating). If nothing is cached yet,
 * run a fresh scan with KB-fallback so the writer is never blind to the
 * hard requirements. Returns null if JD analysis is somehow missing — the
 * writers tolerate that gracefully.
 */
async function loadKnockoutReportForWriters(
  app: NonNullable<Awaited<ReturnType<typeof getApplicationById>>>,
  jdAnalysis: JdAnalysis,
): Promise<KnockoutReport | null> {
  const latest = await getLatestVersion(app.id);
  const cached = app.knockoutReport as unknown as KnockoutReportShape | null;
  if (
    cached &&
    cached.knockouts &&
    cached.knockouts.length > 0 &&
    !latest &&
    isVersionBoundReportFresh(cached, null)
  ) {
    // Cached report's shape is structurally compatible with KnockoutReport.
    return cached as unknown as KnockoutReport;
  }
  if (!app.jdText) return null;

  // No cached scan — run one. We load the same KB-fact slice the action
  // uses so the fresh scan can ground knockouts against the candidate's
  // KB even though no drafts exist yet.
  const knockoutRelevantTypes: FactType[] = [
    "education",
    "certification",
    "role",
    "context",
    "achievement",
    "skill",
    "project",
    "responsibility",
  ];
  const facts = await db()
    .select({ content: kbFacts.content })
    .from(kbFacts)
    .where(inArray(kbFacts.factType, knockoutRelevantTypes));
  const kbContext = facts.map((f) => f.content).join("\n\n");

  try {
    const report = await runKnockoutScan({
      jdText: app.jdText,
      jdAnalysis,
      resumeMarkdown: null,
      resumeVersionId: null,
      kbContext,
      applicationId: app.id,
    });
    // Cache it on the application row so subsequent reads (and the UI card)
    // benefit. Best-effort — don't fail the draft generation if write trips.
    await db()
      .update(applications)
      .set({
        knockoutReport: report,
        knockoutReportAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(applications.id, app.id))
      .catch(() => {});
    return report;
  } catch (err) {
    console.warn(
      `[drafts] knockout pre-scan failed for ${app.id}; writers will proceed without it:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
