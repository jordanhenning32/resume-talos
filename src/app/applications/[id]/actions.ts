"use server";

import { eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import {
  applications,
  applicationStatusValues,
  applicationVersions,
  kbFacts,
  type ApplicationStatus,
  type FactType,
  type ResumeVariant,
} from "@/db/schema";
import {
  approveMarketResearch,
  getMarketResearchById,
  runMarketResearchForApplication,
  type MarketResearchOutcome,
} from "@/lib/applications/market-research";
import { generateDraftsForApplication, getLatestVersion } from "@/lib/applications/drafts";
import { runQcLoopForApplication } from "@/lib/applications/qc-loop";
import { detectKbGaps } from "@/lib/agents/kb-gap-detector";
import {
  runKnockoutScan,
  type KnockoutReport,
} from "@/lib/agents/knockout-detector";
import {
  runQuestionnaireHelper,
  type QuestionnaireResult,
} from "@/lib/agents/questionnaire-helper";
import {
  runVerifierFixSuggester,
  type VerifierFixResult,
} from "@/lib/agents/verifier-fix-suggester";
import { runRecruiterSimulation } from "@/lib/agents/recruiter-simulator";
import type { JdAnalysis } from "@/lib/agents/jd-analyzer";
import { getApplicationById } from "@/lib/applications/create";
import { ingestDocument, type IngestMode, type SkippedFact } from "@/lib/kb/ingest";
import { recoverCitedFactIds } from "@/lib/kb/claim-recovery";
import type { SectionContext } from "@/lib/kb/section-detect";
import {
  exportApplicationToDisk,
  runVerifierForApplication,
} from "@/lib/applications/export";
import { normalizeResumeHeaders } from "@/lib/export/parseability";
import type { LayoutId } from "@/lib/export/layouts/types";
import {
  insertMajorApplicationVersion,
  isVersionBoundReportFresh,
} from "@/lib/applications/versioning";

export async function approveFitAction(id: string) {
  await db()
    .update(applications)
    .set({
      fitApproved: "true",
      status: "in_progress",
      updatedAt: new Date(),
      statusUpdatedAt: new Date(),
    })
    .where(eq(applications.id, id));
  revalidatePath(`/applications/${id}`);
  revalidatePath("/applications");
}

export async function selectVariantAction(id: string, variant: ResumeVariant) {
  await db()
    .update(applications)
    .set({
      variant,
      updatedAt: new Date(),
    })
    .where(eq(applications.id, id));
  revalidatePath(`/applications/${id}`);
}

export async function runMarketResearchAction(
  id: string,
): Promise<{ ok: true; cacheHit: boolean; costUsd: number } | { ok: false; error: string }> {
  try {
    const outcome: MarketResearchOutcome = await runMarketResearchForApplication(id);
    revalidatePath(`/applications/${id}`);
    return { ok: true, cacheHit: outcome.cacheHit, costUsd: outcome.costUsd };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function approveMarketResearchAction(
  id: string,
  edits?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await approveMarketResearch(id, edits);
    revalidatePath(`/applications/${id}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function generateDraftsAction(
  id: string,
): Promise<
  | { ok: true; versionId: string; versionNumber: number; costUsd: number }
  | { ok: false; error: string }
> {
  try {
    const result = await generateDraftsForApplication(id);
    revalidatePath(`/applications/${id}`);
    return {
      ok: true,
      versionId: result.version.id,
      versionNumber: result.version.versionNumber,
      costUsd: result.costUsd,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runQcAction(
  id: string,
  opts?: { allowOneMore?: boolean },
): Promise<
  | {
      ok: true;
      status: "approved" | "escalated" | "noop";
      iterationsRun: number;
      costUsd: number;
      reason: string;
    }
  | { ok: false; error: string }
> {
  try {
    // "Run another iteration" bumps the cap by one cycle past wherever the
    // latest version sits. The loop's first pass will re-review the current
    // latest iter, then rewrite + re-review one more time before escalating.
    let maxIterations: number | undefined;
    if (opts?.allowOneMore) {
      const latest = await getLatestVersion(id);
      if (latest) {
        maxIterations = latest.iteration + 2;
      }
    }
    const result = await runQcLoopForApplication(
      id,
      maxIterations != null ? { maxIterations } : undefined,
    );
    revalidatePath(`/applications/${id}`);
    return {
      ok: true,
      status: result.status,
      iterationsRun: result.iterationsRun,
      costUsd: result.costUsd,
      reason: result.reason,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function runVerifierAction(
  id: string,
): Promise<
  | {
      ok: true;
      passed: boolean;
      criticalCount: number;
      warningCount: number;
      costUsd: number;
      summary: string;
    }
  | { ok: false; error: string }
> {
  try {
    const r = await runVerifierForApplication(id);
    revalidatePath(`/applications/${id}`);
    return {
      ok: true,
      passed: r.passed,
      criticalCount: r.criticalCount,
      warningCount: r.warningCount,
      costUsd: r.costUsd,
      summary: r.summary,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function exportApplicationAction(
  id: string,
  layout: LayoutId,
  allowWithWarnings: boolean = false,
): Promise<
  | {
      ok: true;
      folder: string;
      paths: {
        resumePdf: string;
        resumeDocx: string;
        coverPdf: string;
        coverDocx: string;
      };
      requestedLayout: LayoutId;
      layout: LayoutId;
      parseabilityAutoFix: import("@/lib/applications/export").ParseabilityAutoFix;
      parseability: import("@/lib/export/parseability").ParseabilityReport;
    }
  | { ok: false; error: string }
> {
  try {
    const r = await exportApplicationToDisk({
      applicationId: id,
      layout,
      allowWithWarnings,
    });
    revalidatePath(`/applications/${id}`);
    revalidatePath("/applications");
    return {
      ok: true,
      folder: r.folder,
      paths: {
        resumePdf: r.resumePdfPath,
        resumeDocx: r.resumeDocxPath,
        coverPdf: r.coverPdfPath,
        coverDocx: r.coverDocxPath,
      },
      requestedLayout: r.requestedLayout,
      layout: r.layout,
      parseabilityAutoFix: r.parseabilityAutoFix,
      parseability: r.parseability,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function updateApplicationStatusAction(
  id: string,
  status: ApplicationStatus,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(applicationStatusValues as readonly string[]).includes(status)) {
    return { ok: false, error: `Invalid status: ${status}` };
  }
  await db()
    .update(applications)
    .set({
      status,
      updatedAt: new Date(),
      statusUpdatedAt: new Date(),
    })
    .where(eq(applications.id, id));
  revalidatePath(`/applications/${id}`);
  revalidatePath("/applications");
  return { ok: true };
}

export async function runKbCoverageScanAction(
  id: string,
): Promise<
  | { ok: true; durationMs: number; costUsd: number; missingMustHaveCount: number }
  | { ok: false; error: string }
> {
  try {
    const app = await getApplicationById(id);
    if (!app) return { ok: false, error: `Application ${id} not found.` };
    if (!app.jdAnalysis) return { ok: false, error: "JD analysis missing — cannot scan." };
    const analysis = app.jdAnalysis as unknown as JdAnalysis;
    const t0 = Date.now();
    const report = await detectKbGaps({
      mustHaveSkills: analysis.mustHaveSkills,
      niceToHaveSkills: analysis.niceToHaveSkills,
      context: {
        roleTitle: analysis.roleTitle,
        companyName: analysis.companyName ?? undefined,
      },
      applicationId: id,
    });
    await db()
      .update(applications)
      .set({
        kbGapReport: report,
        kbGapReportAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(applications.id, id));
    revalidatePath(`/applications/${id}`);
    return {
      ok: true,
      durationMs: Date.now() - t0,
      costUsd: report.embedCostUsd,
      missingMustHaveCount: report.missingMustHaveCount,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function runKnockoutScanAction(
  id: string,
): Promise<
  | {
      ok: true;
      durationMs: number;
      costUsd: number;
      knockoutCount: number;
      missingCount: number;
      partialCount: number;
      blockingCount: number;
    }
  | { ok: false; error: string }
> {
  try {
    const app = await getApplicationById(id);
    if (!app) return { ok: false, error: `Application ${id} not found.` };
    if (!app.jdAnalysis) {
      return { ok: false, error: "JD analysis missing — cannot scan." };
    }
    if (!app.jdText) {
      return { ok: false, error: "JD text missing — cannot scan." };
    }
    const analysis = app.jdAnalysis as unknown as JdAnalysis;
    const latest = await getLatestVersion(id);
    // When no resume exists yet, fall back to scanning the KB for grounding
    // evidence — otherwise the knockout report flags everything "missing"
    // even when the candidate has solid KB facts for it. We pull the fact
    // types most likely to ground knockouts (education, certification, role,
    // context, achievement, skill, project, responsibility) and concatenate
    // their content into a single text blob the match functions can scan.
    let kbContext = "";
    if (!latest?.resumeMarkdown) {
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
      kbContext = facts.map((f) => f.content).join("\n\n");
    }
    const t0 = Date.now();
    const report = await runKnockoutScan({
      jdText: app.jdText,
      jdAnalysis: analysis,
      resumeMarkdown: latest?.resumeMarkdown ?? null,
      resumeVersionId: latest?.id ?? null,
      kbContext,
      applicationId: id,
    });
    await db()
      .update(applications)
      .set({
        knockoutReport: report,
        knockoutReportAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(applications.id, id));
    revalidatePath(`/applications/${id}`);
    return {
      ok: true,
      durationMs: Date.now() - t0,
      costUsd: report.costUsd,
      knockoutCount: report.knockouts.length,
      missingCount: report.missingCount,
      partialCount: report.partialCount,
      blockingCount: report.blockingCount,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function runRecruiterSimulationAction(
  id: string,
): Promise<
  | { ok: true; advanceScore: number; recommendation: "advance" | "borderline" | "pass"; costUsd: number }
  | { ok: false; error: string }
> {
  try {
    const app = await getApplicationById(id);
    if (!app) return { ok: false, error: `Application ${id} not found.` };
    if (!app.jdAnalysis) return { ok: false, error: "JD analysis missing — cannot simulate." };
    if (!app.jdText) return { ok: false, error: "JD text missing — cannot simulate." };
    const latest = await getLatestVersion(id);
    if (!latest?.resumeMarkdown) {
      return { ok: false, error: "No drafts yet — generate the resume + cover letter first." };
    }

    const { output, costUsd } = await runRecruiterSimulation({
      jdAnalysis: app.jdAnalysis as unknown as JdAnalysis,
      jdText: app.jdText,
      resumeMarkdown: latest.resumeMarkdown,
      coverLetterMarkdown: latest.coverLetterMarkdown ?? "",
      applicationId: id,
      applicationVersionId: latest.id,
    });

    await db()
      .update(applications)
      .set({
        recruiterScreenerResult: { ...output, resumeVersionId: latest.id },
        recruiterScreenerAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(applications.id, id));
    revalidatePath(`/applications/${id}`);
    return {
      ok: true,
      advanceScore: output.advanceScore,
      recommendation: output.recommendation,
      costUsd,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Take raw text typed by the user — either from the application-page
 * inline panel or from the standalone KB page — and route it through the
 * standard ingest pipeline as a small facts-kind text document.
 *
 * Facts are inserted into the global KB and available to every future
 * application; the optional `applicationId` is recorded only as a
 * provenance tag in `kbDocuments.metadata` so quick-add docs from a
 * given app session can be audited or selectively cleaned up later.
 *
 * Caller is expected to re-run the KB coverage scan if they want gap
 * rows refreshed in the application UI.
 */
export async function addQuickFactsAction(opts: {
  text: string;
  applicationId?: string;
  mode?: IngestMode;
  sectionContext?: Omit<SectionContext, "charStart" | "charEnd">;
}): Promise<
  | {
      ok: true;
      status: "ingested" | "duplicate_document";
      factCount: number;
      chunkCount: number;
      duplicateFactCount: number;
      costUsd: number;
      skippedFacts?: SkippedFact[];
    }
  | { ok: false; error: string }
> {
  const trimmed = opts.text.trim();
  if (trimmed.length < 20) {
    return { ok: false, error: "Need at least 20 characters of context to extract facts from." };
  }
  if (trimmed.length > 20_000) {
    return { ok: false, error: "Text too long — keep it under 20,000 characters per add." };
  }
  try {
    let provenance: Record<string, unknown> = { source: "manual_add" };
    let docNameSuffix = `manual-${Date.now()}`;

    if (opts.applicationId) {
      const app = await getApplicationById(opts.applicationId);
      if (!app) {
        return { ok: false, error: `Application ${opts.applicationId} not found.` };
      }
      const analysis = (app.jdAnalysis as JdAnalysis | null) ?? null;
      provenance = {
        source: "quick_add",
        applicationId: opts.applicationId,
        roleTitle: analysis?.roleTitle ?? null,
        companyName: analysis?.companyName ?? null,
      };
      docNameSuffix = `quick-${opts.applicationId}-${Date.now()}`;
    }

    const result = await ingestDocument({
      name: `${docNameSuffix}.txt`,
      fileType: "txt",
      buffer: Buffer.from(trimmed, "utf-8"),
      kind: "facts",
      userFacts: true,
      extraMetadata: provenance,
      mode: opts.mode,
      ...(opts.sectionContext
        ? {
            extraMetadata: {
              ...provenance,
              sectionContext: { ...opts.sectionContext, charStart: 0, charEnd: trimmed.length },
            },
          }
        : {}),
    });
    if (opts.applicationId) {
      revalidatePath(`/applications/${opts.applicationId}`);
    }
    revalidatePath("/knowledge-base");
    return {
      ok: true,
      status: result.status,
      factCount: result.factCount,
      chunkCount: result.chunkCount,
      duplicateFactCount: result.duplicateFactCount,
      costUsd: result.costUsd,
      skippedFacts: result.skippedFacts,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Hard delete an application. The schema cascades on:
 *   - applicationVersions (→ qcReviews)
 *   - agentRuns
 * Market research rows are NOT touched — they are keyed by company and
 * cached across applications.
 */
export async function deleteApplicationAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await db().delete(applications).where(eq(applications.id, id));
    revalidatePath("/applications");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Set or clear the JD URL on an existing application. Used by the
 * `AtsVendorCard` inline paste form when the original ingest was
 * paste-mode and didn't capture a URL — adding it later unlocks the
 * vendor-specific layout guidance.
 */
export async function updateApplicationJdUrlAction(
  id: string,
  jdUrl: string,
): Promise<{ ok: true; jdUrl: string | null } | { ok: false; error: string }> {
  const trimmed = jdUrl.trim();
  let normalized: string | null = null;
  if (trimmed.length > 0) {
    try {
      const parsed = new URL(trimmed);
      if (!/^https?:$/i.test(parsed.protocol)) {
        return { ok: false, error: "URL must use http:// or https://." };
      }
      normalized = parsed.toString();
    } catch {
      return { ok: false, error: "That doesn't look like a valid URL." };
    }
  }
  try {
    await db()
      .update(applications)
      .set({ jdUrl: normalized, updatedAt: new Date() })
      .where(eq(applications.id, id));
    revalidatePath(`/applications/${id}`);
    return { ok: true, jdUrl: normalized };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Run the Screening-Questionnaire Helper against pasted ATS post-upload
 * questions. Returns one structured answer per question with confidence +
 * grounding + warnings. No persistence — questions vary per submission
 * and the user copies answers back to the ATS form.
 */
export async function runQuestionnaireHelperAction(
  id: string,
  rawQuestions: string,
): Promise<
  | { ok: true; result: QuestionnaireResult }
  | { ok: false; error: string }
> {
  const trimmed = rawQuestions.trim();
  if (trimmed.length < 8) {
    return { ok: false, error: "Paste at least one full question." };
  }
  if (trimmed.length > 25_000) {
    return { ok: false, error: "Too much text — keep paste under 25,000 chars." };
  }
  try {
    const app = await getApplicationById(id);
    if (!app) return { ok: false, error: `Application ${id} not found.` };
    if (!app.jdAnalysis) {
      return { ok: false, error: "JD analysis missing — cannot ground answers." };
    }
    const analysis = app.jdAnalysis as unknown as JdAnalysis;
    const latest = await getLatestVersion(id);
    const rawKnockout = (app.knockoutReport as unknown as KnockoutReport | null) ?? null;
    const knockout = isVersionBoundReportFresh(rawKnockout, latest?.id ?? null)
      ? rawKnockout
      : null;

    let marketResearchSummary: string | null = null;
    if (app.marketResearchId) {
      try {
        const mr = await getMarketResearchById(app.marketResearchId);
        marketResearchSummary =
          mr?.findings && typeof mr.findings === "object"
            ? JSON.stringify(mr.findings).slice(0, 2000)
            : (mr?.rawMarkdown ?? null);
      } catch {
        // best-effort — don't fail the action over MR fetch
      }
    }

    const result = await runQuestionnaireHelper({
      rawQuestions: trimmed,
      jdAnalysis: analysis,
      marketResearchSummary,
      knockoutReport: knockout,
      applicationId: id,
    });
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Save a manually-edited resume + cover letter as a NEW application
 * version (bumps versionNumber, iteration=0). Used by the Edit tab when
 * the user has tweaked an export outside the system and wants Resume Talos
 * to score the edits. The new version becomes the latest so all downstream
 * cards (Screening, Submit) automatically use it. Prior versions stay
 * in the history untouched.
 */
export async function saveManualEditAction(
  applicationId: string,
  resumeMarkdown: string,
  coverLetterMarkdown: string,
): Promise<
  | { ok: true; versionId: string; versionNumber: number }
  | { ok: false; error: string }
> {
  const resume = resumeMarkdown.trim();
  const cover = coverLetterMarkdown.trim();
  if (resume.length < 40) {
    return {
      ok: false,
      error: "Resume content is too short — paste at least a basic header + one section.",
    };
  }
  if (resume.length > 60_000) {
    return { ok: false, error: "Resume content is too long (over 60 KB). Trim before saving." };
  }
  if (cover.length > 30_000) {
    return { ok: false, error: "Cover letter content is too long (over 30 KB). Trim before saving." };
  }
  try {
    const app = await getApplicationById(applicationId);
    if (!app) return { ok: false, error: `Application ${applicationId} not found.` };

    const latest = await getLatestVersion(applicationId);
    const baselineCitedFactIds = latest?.citedFactIds ?? [];
    const { recoveredFactIds } = await recoverCitedFactIds({
      resumeMarkdown: resume,
      coverLetterMarkdown: cover,
      inheritedFactIds: baselineCitedFactIds,
    });

    const inserted = await insertMajorApplicationVersion({
      applicationId,
      resumeMarkdown: resume,
      coverLetterMarkdown: cover || null,
      citedFactIds: recoveredFactIds,
    });

    // Clear caches that depend on the latest-version content so the
    // Screening + Submit tabs re-evaluate against the new manual edit.
    revalidatePath(`/applications/${applicationId}`);
    revalidatePath(`/applications/${applicationId}/screening`);
    revalidatePath(`/applications/${applicationId}/submit`);
    revalidatePath(`/applications/${applicationId}/draft`);
    revalidatePath(`/applications/${applicationId}/edit`);

    return {
      ok: true,
      versionId: inserted.id,
      versionNumber: inserted.versionNumber,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function rederiveCitedFactsAction(
  applicationVersionId: string,
): Promise<
  | { ok: true; recoveredCount: number; beforeCount: number }
  | { ok: false; error: string }
> {
  try {
    const [version] = await db()
      .select()
      .from(applicationVersions)
      .where(eq(applicationVersions.id, applicationVersionId))
      .limit(1);
    if (!version) {
      return { ok: false, error: `Version ${applicationVersionId} not found.` };
    }
    const before = version.citedFactIds ?? [];
    const { recoveredFactIds } = await recoverCitedFactIds({
      resumeMarkdown: version.resumeMarkdown ?? "",
      coverLetterMarkdown: version.coverLetterMarkdown ?? "",
      inheritedFactIds: before,
    });
    await db()
      .update(applicationVersions)
      .set({ citedFactIds: recoveredFactIds })
      .where(eq(applicationVersions.id, applicationVersionId));
    revalidatePath(`/applications/${version.applicationId}`);
    revalidatePath(`/applications/${version.applicationId}/submit`);
    revalidatePath(`/applications/${version.applicationId}/edit`);
    return {
      ok: true,
      recoveredCount: recoveredFactIds.length,
      beforeCount: before.length,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Auto-fix non-canonical section headers in the latest resume markdown
 * via deterministic rename (no LLM). Saves the result as a new version
 * (bumps versionNumber, iteration=0) so the prior version stays in
 * history. After this returns, the next export will use the canonical
 * header names so Workday/Taleo-style parsers can key on them.
 */
export async function fixSectionHeadersAction(
  applicationId: string,
): Promise<
  | {
      ok: true;
      changes: Array<{ from: string; to: string }>;
      versionId: string | null;
      versionNumber: number | null;
    }
  | { ok: false; error: string }
> {
  try {
    const app = await getApplicationById(applicationId);
    if (!app) return { ok: false, error: `Application ${applicationId} not found.` };
    const latest = await getLatestVersion(applicationId);
    if (!latest?.resumeMarkdown) {
      return {
        ok: false,
        error: "No resume to fix — generate or edit a draft first.",
      };
    }

    const { output, changes } = normalizeResumeHeaders(latest.resumeMarkdown);
    if (changes.length === 0) {
      return {
        ok: true,
        changes: [],
        versionId: null,
        versionNumber: null,
      };
    }

    const inserted = await insertMajorApplicationVersion({
      applicationId,
      resumeMarkdown: output,
      coverLetterMarkdown: latest.coverLetterMarkdown,
      citedFactIds: latest.citedFactIds ?? [],
    });

    revalidatePath(`/applications/${applicationId}`);
    revalidatePath(`/applications/${applicationId}/screening`);
    revalidatePath(`/applications/${applicationId}/submit`);
    revalidatePath(`/applications/${applicationId}/draft`);
    revalidatePath(`/applications/${applicationId}/edit`);

    return {
      ok: true,
      changes: changes.map((c) => ({ from: c.from, to: c.to })),
      versionId: inserted.id,
      versionNumber: inserted.versionNumber,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Ask the Verifier-Fix Suggester for actionable fixes to a flagged claim.
 * Returns 1-3 suggestions (soften / drop / add_kb_fact) with copyable
 * text the user can paste into the Edit tab or Quick Add.
 */
export async function suggestVerifierFixAction(
  applicationId: string,
  claim: string,
  reason: string,
): Promise<
  | { ok: true; result: VerifierFixResult }
  | { ok: false; error: string }
> {
  if (!claim.trim() || !reason.trim()) {
    return { ok: false, error: "Missing claim or reason." };
  }
  try {
    const app = await getApplicationById(applicationId);
    if (!app) return { ok: false, error: `Application ${applicationId} not found.` };
    if (!app.jdAnalysis) {
      return { ok: false, error: "JD analysis missing — cannot suggest fixes." };
    }
    const latest = await getLatestVersion(applicationId);
    if (!latest?.resumeMarkdown) {
      return {
        ok: false,
        error: "No resume markdown on the latest version — generate or edit drafts first.",
      };
    }
    const analysis = app.jdAnalysis as unknown as JdAnalysis;
    const result = await runVerifierFixSuggester({
      claim,
      reason,
      jdAnalysis: analysis,
      resumeMarkdown: latest.resumeMarkdown,
      applicationId,
    });
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function cancelApplicationAction(id: string) {
  await db()
    .update(applications)
    .set({
      status: "withdrawn",
      updatedAt: new Date(),
      statusUpdatedAt: new Date(),
    })
    .where(eq(applications.id, id));
  revalidatePath("/applications");
  redirect("/applications");
}
