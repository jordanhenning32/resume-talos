import { eq } from "drizzle-orm";
import { db } from "@/db";
import { applications, applicationVersions } from "@/db/schema";
import { verifyDrafts } from "@/lib/agents/verifier";
import { writeArtifacts } from "@/lib/export/file-output";
import {
  renderArtifacts,
  type PdfMetadataContext,
  type RenderedArtifacts,
} from "@/lib/export/render";
import {
  normalizeResumeHeaders,
  validatePdfParseability,
  type ParseabilityReport,
} from "@/lib/export/parseability";
import {
  summarizeResumeTrimChanges,
  trimResumeMarkdownOneStep,
  type ResumeTrimChange,
  type ResumeTrimContext,
  type ResumeTrimSummary,
} from "@/lib/export/resume-trim";
import {
  ensureMandatoryResumeCitedFactIds,
  ensureMandatoryResumeContent,
} from "@/lib/export/mandatory-resume-content";
import type { LayoutId } from "@/lib/export/layouts/types";
import type { JdAnalysis } from "@/lib/agents/jd-analyzer";
import { getApplicationById } from "./create";
import { getLatestVersion } from "./drafts";
import { getMarketResearchById } from "./market-research";
import { insertMajorApplicationVersion } from "./versioning";

export type VerifierOutcome = {
  passed: boolean;
  criticalCount: number;
  warningCount: number;
  costUsd: number;
  factsLoaded: number;
  summary: string;
};

export async function runVerifierForApplication(
  applicationId: string,
): Promise<VerifierOutcome> {
  const app = await getApplicationById(applicationId);
  if (!app) throw new Error(`Application ${applicationId} not found.`);
  if (!app.jdAnalysis) throw new Error("Missing JD analysis on application.");
  const version = await getLatestVersion(applicationId);
  if (!version) throw new Error("No drafts to verify.");

  const cited = (version.citedFactIds as string[] | null) ?? [];
  // Pull approved market research so the verifier can validate company-side
  // claims (recent news, products, internal projects) without false-flagging
  // them as KB hallucinations.
  const marketResearch = app.marketResearchId
    ? await getMarketResearchById(app.marketResearchId)
    : null;
  const result = await verifyDrafts({
    resumeMarkdown: version.resumeMarkdown ?? "",
    coverLetterMarkdown: version.coverLetterMarkdown ?? "",
    citedFactIds: cited,
    jdAnalysis: app.jdAnalysis as unknown as JdAnalysis,
    jdText: app.jdText,
    marketResearch,
    applicationId,
    applicationVersionId: version.id,
  });

  const critical = result.output.issuesFound.filter((i) => i.severity === "critical");
  const warning = result.output.issuesFound.filter((i) => i.severity === "warning");

  await db()
    .update(applicationVersions)
    .set({
      verifierPassed: result.output.passes ? "true" : "false",
      verifierIssues: result.output.issuesFound.map((i) => ({
        claim: i.quote,
        reason: i.reason,
        severity: i.severity,
      })),
    })
    .where(eq(applicationVersions.id, version.id));

  return {
    passed: result.output.passes,
    criticalCount: critical.length,
    warningCount: warning.length,
    costUsd: result.costUsd,
    factsLoaded: result.factsLoaded,
    summary: result.output.summary,
  };
}

export type ExportOutcome = {
  folder: string;
  resumePdfPath: string;
  resumeDocxPath: string;
  coverPdfPath: string;
  coverDocxPath: string;
  metadataPath: string;
  requestedLayout: LayoutId;
  layout: LayoutId;
  parseability: ParseabilityReport;
  parseabilityAutoFix: ParseabilityAutoFix;
};

export type ParseabilityAutoFix = {
  applied: boolean;
  requestedLayout: LayoutId;
  finalLayout: LayoutId;
  headerChanges: Array<{ from: string; to: string }>;
  trimChanges: ResumeTrimSummary | null;
  savedVersionId: string | null;
  savedVersionNumber: number | null;
  attempts: Array<{
    layout: LayoutId;
    source: ExportCandidateSource;
    verdict: ParseabilityReport["verdict"];
    contentCoverage: number;
    pageCount: number;
  }>;
  message: string | null;
};

export async function exportApplicationToDisk(opts: {
  applicationId: string;
  layout: LayoutId;
  allowWithWarnings?: boolean;
}): Promise<ExportOutcome> {
  const app = await getApplicationById(opts.applicationId);
  if (!app) throw new Error(`Application ${opts.applicationId} not found.`);
  const version = await getLatestVersion(opts.applicationId);
  if (!version) throw new Error("No drafts to export.");
  if (version.verifierPassed !== "true" && !opts.allowWithWarnings) {
    throw new Error(
      "Latest version has not passed the Groundedness Verifier. Run the verifier first, or pass allowWithWarnings=true to force export.",
    );
  }

  const originalResumeMarkdown = version.resumeMarkdown ?? "";
  const resumeMarkdown = ensureMandatoryResumeContent(originalResumeMarkdown);
  const citedFactIds = ensureMandatoryResumeCitedFactIds(version.citedFactIds ?? []);
  const jdAnalysisForMeta = app.jdAnalysis as JdAnalysis | null;
  const variant = app.variant === "short" ? ("short" as const) : ("long" as const);
  const renderContext = {
    coverLetterMarkdown: version.coverLetterMarkdown ?? "",
    pdfMetadata: {
      roleTitle: app.role,
      companyName: app.company,
      keywords: jdAnalysisForMeta?.mustHaveSkills ?? [],
    },
    variant,
  };

  // Re-extract text from the rendered resume PDF and verify it parses
  // cleanly. Catches layouts (especially the Modern two-column sidebar)
  // that an ATS parser would linearize incorrectly — sections out of
  // order, content lost, column-merge artifacts. We compute this BEFORE
  // writing to disk so the result can be surfaced to the user even if
  // they don't keep the export.
  const exportPlan = await buildParseabilitySafeExport({
    requestedLayout: opts.layout,
    resumeMarkdown,
    renderContext,
    trimContext: {
      variant,
      roleTitle: jdAnalysisForMeta?.roleTitle ?? app.role,
      keywords: [
        ...(jdAnalysisForMeta?.mustHaveSkills ?? []),
        ...(jdAnalysisForMeta?.niceToHaveSkills ?? []),
        ...(jdAnalysisForMeta?.keyLanguagePatterns ?? []),
        ...(jdAnalysisForMeta?.responsibilities ?? []),
      ],
    },
  });
  const { artifacts, parseability, layout } = exportPlan;
  let autoFix = exportPlan.autoFix;
  assertExportParseabilityAllowed(parseability, autoFix);

  let exportVersion = version;
  if (exportPlan.resumeMarkdown !== originalResumeMarkdown) {
    const inserted = await insertMajorApplicationVersion({
      applicationId: opts.applicationId,
      resumeMarkdown: exportPlan.resumeMarkdown,
      coverLetterMarkdown: version.coverLetterMarkdown,
      citedFactIds,
    });
    await db()
      .update(applicationVersions)
      .set({
        verifierPassed: version.verifierPassed,
        verifierIssues: version.verifierIssues,
      })
      .where(eq(applicationVersions.id, inserted.id));
    exportVersion = {
      ...inserted,
      verifierPassed: version.verifierPassed,
      verifierIssues: version.verifierIssues,
    };
    autoFix = {
      ...autoFix,
      savedVersionId: inserted.id,
      savedVersionNumber: inserted.versionNumber,
      message: autoFix.message
        ? `${autoFix.message} Saved the fixed resume as v${inserted.versionNumber}.0.`
        : `Saved the fixed resume as v${inserted.versionNumber}.0.`,
    };
  }
  const exportCitedFactIds = ensureMandatoryResumeCitedFactIds(
    exportVersion.citedFactIds ?? [],
  );

  const paths = await writeArtifacts({
    artifacts,
    companySlug: app.companySlug,
    roleSlug: app.roleSlug,
    versionNumber: exportVersion.versionNumber,
    iteration: exportVersion.iteration,
    metadata: {
      applicationId: opts.applicationId,
      versionId: exportVersion.id,
      versionNumber: exportVersion.versionNumber,
      iteration: exportVersion.iteration,
      company: app.company,
      role: app.role,
      layout,
      requestedLayout: opts.layout,
      parseabilityAutoFix: autoFix,
      citedFactIds: exportCitedFactIds,
      qcAScore: exportVersion.qcAScore,
      qcBScore: exportVersion.qcBScore,
      screenerScore: exportVersion.screenerScore,
      verifierPassed: exportVersion.verifierPassed,
      verifierIssues: exportVersion.verifierIssues,
    },
  });

  await db()
    .update(applicationVersions)
    .set({
      resumePdfPath: paths.resumePdf,
      resumeDocxPath: paths.resumeDocx,
      coverLetterPdfPath: paths.coverPdf,
      coverLetterDocxPath: paths.coverDocx,
      citedFactIds: exportCitedFactIds,
    })
    .where(eq(applicationVersions.id, exportVersion.id));

  await db()
    .update(applications)
    .set({
      finalVersionId: exportVersion.id,
      status: "ready",
      updatedAt: new Date(),
      statusUpdatedAt: new Date(),
    })
    .where(eq(applications.id, opts.applicationId));

  return {
    folder: paths.folder,
    resumePdfPath: paths.resumePdf,
    resumeDocxPath: paths.resumeDocx,
    coverPdfPath: paths.coverPdf,
    coverDocxPath: paths.coverDocx,
    metadataPath: paths.metadata,
    requestedLayout: opts.layout,
    layout,
    parseability,
    parseabilityAutoFix: autoFix,
  };
}

export function assertExportParseabilityAllowed(
  parseability: ParseabilityReport,
  autoFix: ParseabilityAutoFix,
): void {
  if (parseability.verdict !== "broken") return;
  const attempts = autoFix.attempts
    .map(
      (attempt) =>
        `${attempt.layout}/${attempt.source}: ${attempt.verdict}, coverage=${Math.round(
          attempt.contentCoverage * 100,
        )}%, pages=${attempt.pageCount}`,
    )
    .join("; ");
  throw new Error(
    `Export blocked because the rendered resume PDF is still broken after deterministic parseability repair attempts. ${attempts}`,
  );
}

type ExportRenderContext = {
  coverLetterMarkdown: string;
  pdfMetadata: PdfMetadataContext;
  variant: "short" | "long";
};

export type ExportCandidateSource =
  | "original"
  | "header-normalized"
  | "auto-trimmed"
  | "header-normalized-auto-trimmed";

type ExportCandidate = {
  layout: LayoutId;
  source: ExportCandidateSource;
  resumeMarkdown: string;
  headerChanges: Array<{ from: string; to: string }>;
  trimChanges: ResumeTrimChange[];
  artifacts: RenderedArtifacts;
  parseability: ParseabilityReport;
};

async function buildParseabilitySafeExport(opts: {
  requestedLayout: LayoutId;
  resumeMarkdown: string;
  renderContext: ExportRenderContext;
  trimContext: ResumeTrimContext;
}): Promise<{
  artifacts: RenderedArtifacts;
  parseability: ParseabilityReport;
  layout: LayoutId;
  resumeMarkdown: string;
  autoFix: ParseabilityAutoFix;
}> {
  const initial = await renderExportCandidate({
    layout: opts.requestedLayout,
    source: "original",
    resumeMarkdown: opts.resumeMarkdown,
    headerChanges: [],
    trimChanges: [],
    renderContext: opts.renderContext,
  });

  const attempts: ParseabilityAutoFix["attempts"] = [summarizeAttempt(initial)];
  let selected = initial;

  if (initial.parseability.verdict === "broken") {
    const normalized = normalizeResumeHeaders(opts.resumeMarkdown);
    const normalizedHeaderChanges = normalized.changes.map((change) => ({
      from: change.from,
      to: change.to,
    }));
    const seen = new Set<string>([
      repairAttemptKey(opts.requestedLayout, "original"),
    ]);
    const repairQueue: Array<{
      layout: LayoutId;
      source: "original" | "header-normalized";
      resumeMarkdown: string;
      headerChanges: Array<{ from: string; to: string }>;
    }> = [];

    const enqueue = (candidate: {
      layout: LayoutId;
      source: "original" | "header-normalized";
      resumeMarkdown: string;
      headerChanges: Array<{ from: string; to: string }>;
    }) => {
      const key = repairAttemptKey(candidate.layout, candidate.source);
      if (seen.has(key)) return;
      seen.add(key);
      repairQueue.push(candidate);
    };

    if (normalizedHeaderChanges.length > 0) {
      enqueue({
        layout: opts.requestedLayout,
        source: "header-normalized",
        resumeMarkdown: normalized.output,
        headerChanges: normalizedHeaderChanges,
      });
    }

    for (const layout of preferredRepairLayouts(opts.requestedLayout)) {
      enqueue({
        layout,
        source: "original",
        resumeMarkdown: opts.resumeMarkdown,
        headerChanges: [],
      });
      if (normalizedHeaderChanges.length > 0) {
        enqueue({
          layout,
          source: "header-normalized",
          resumeMarkdown: normalized.output,
          headerChanges: normalizedHeaderChanges,
        });
      }
    }

    let firstWarning: ExportCandidate | null = null;
    for (const repair of repairQueue) {
      const candidate = await renderExportCandidate({
        ...repair,
        trimChanges: [],
        renderContext: opts.renderContext,
      });
      attempts.push(summarizeAttempt(candidate));
      if (candidate.parseability.verdict === "clean") {
        selected = candidate;
        break;
      }
      if (candidate.parseability.verdict === "warning" && firstWarning === null) {
        firstWarning = candidate;
      }
    }

    if (selected === initial && firstWarning) {
      selected = firstWarning;
    }
  }

  if (hasPageOverflow(selected.parseability)) {
    selected = await repairPageOverflow({
      selected,
      attempts,
      renderContext: opts.renderContext,
      trimContext: opts.trimContext,
    });
  }

  return {
    artifacts: selected.artifacts,
    parseability: selected.parseability,
    layout: selected.layout,
    resumeMarkdown: selected.resumeMarkdown,
    autoFix: {
      applied: selected !== initial,
      requestedLayout: opts.requestedLayout,
      finalLayout: selected.layout,
      headerChanges: selected.headerChanges,
      trimChanges:
        selected.trimChanges.length > 0
          ? summarizeResumeTrimChanges(
              initial.resumeMarkdown,
              selected.resumeMarkdown,
              selected.trimChanges,
            )
          : null,
      savedVersionId: null,
      savedVersionNumber: null,
      attempts,
      message: autoFixMessage(initial, selected, opts.requestedLayout),
    },
  };
}

async function renderExportCandidate(opts: {
  layout: LayoutId;
  source: ExportCandidateSource;
  resumeMarkdown: string;
  headerChanges: Array<{ from: string; to: string }>;
  trimChanges: ResumeTrimChange[];
  renderContext: ExportRenderContext;
}): Promise<ExportCandidate> {
  const artifacts = await renderArtifacts({
    resumeMarkdown: opts.resumeMarkdown,
    coverLetterMarkdown: opts.renderContext.coverLetterMarkdown,
    layout: opts.layout,
    pdfMetadata: opts.renderContext.pdfMetadata,
  });

  const parseability = await validatePdfParseability({
    pdfBuffer: artifacts.resumePdf,
    sourceMarkdown: opts.resumeMarkdown,
    layoutId: opts.layout,
    variant: opts.renderContext.variant,
  });

  return {
    layout: opts.layout,
    source: opts.source,
    resumeMarkdown: opts.resumeMarkdown,
    headerChanges: opts.headerChanges,
    trimChanges: opts.trimChanges,
    artifacts,
    parseability,
  };
}

function summarizeAttempt(
  candidate: ExportCandidate,
): ParseabilityAutoFix["attempts"][number] {
  return {
    layout: candidate.layout,
    source: candidate.source,
    verdict: candidate.parseability.verdict,
    contentCoverage: candidate.parseability.contentCoverage,
    pageCount: candidate.parseability.pageCount,
  };
}

async function repairPageOverflow(opts: {
  selected: ExportCandidate;
  attempts: ParseabilityAutoFix["attempts"];
  renderContext: ExportRenderContext;
  trimContext: ResumeTrimContext;
}): Promise<ExportCandidate> {
  const maxPages = opts.renderContext.variant === "short" ? 1 : 2;
  const maxTrimPasses = opts.renderContext.variant === "short" ? 28 : 40;
  let best = opts.selected;
  let markdown = opts.selected.resumeMarkdown;
  const trimChanges: ResumeTrimChange[] = [...opts.selected.trimChanges];

  for (let pass = 0; pass < maxTrimPasses; pass++) {
    const step = trimResumeMarkdownOneStep(markdown, opts.trimContext);
    if (!step) break;

    markdown = step.output;
    trimChanges.push(step.change);

    const candidate = await renderExportCandidate({
      layout: opts.selected.layout,
      source: sourceWithTrim(opts.selected.source),
      resumeMarkdown: markdown,
      headerChanges: opts.selected.headerChanges,
      trimChanges: [...trimChanges],
      renderContext: opts.renderContext,
    });
    opts.attempts.push(summarizeAttempt(candidate));

    if (
      candidate.parseability.verdict !== "broken" &&
      candidate.parseability.pageCount < best.parseability.pageCount
    ) {
      best = candidate;
    }

    if (
      candidate.parseability.verdict !== "broken" &&
      candidate.parseability.pageCount <= maxPages &&
      !hasPageOverflow(candidate.parseability)
    ) {
      return candidate;
    }
  }

  return best;
}

function hasPageOverflow(report: ParseabilityReport): boolean {
  return report.artifacts.some((artifact) => artifact.kind === "page_overflow");
}

function sourceWithTrim(source: ExportCandidateSource): ExportCandidateSource {
  if (source === "header-normalized" || source === "header-normalized-auto-trimmed") {
    return "header-normalized-auto-trimmed";
  }
  return "auto-trimmed";
}

function preferredRepairLayouts(requestedLayout: LayoutId): LayoutId[] {
  if (requestedLayout === "classic") {
    // Classic is the ATS-safe/federal-safe layout. If it has a parseability
    // issue, changing to a more visual template is not a safe repair; the user
    // should see the real issue and keep control of the layout choice.
    return [];
  }
  if (requestedLayout === "executive") {
    return ["classic"];
  }
  return ["classic", "executive"];
}

function repairAttemptKey(
  layout: LayoutId,
  source: ExportCandidateSource,
): string {
  return `${layout}:${source}`;
}

function autoFixMessage(
  initial: ExportCandidate,
  selected: ExportCandidate,
  requestedLayout: LayoutId,
): string | null {
  const initialOverflow = hasPageOverflow(initial.parseability);
  if (initial.parseability.verdict !== "broken" && !initialOverflow) return null;
  if (selected === initial) {
    return initialOverflow
      ? "No deterministic length repair could get the resume under the page target; exported the requested layout."
      : "No deterministic parseability repair produced a non-broken PDF; exported the requested layout.";
  }

  const fixes: string[] = [];
  if (selected.headerChanges.length > 0) {
    fixes.push(
      `normalized ${selected.headerChanges.length} section header${
        selected.headerChanges.length === 1 ? "" : "s"
      }`,
    );
  }
  if (selected.layout !== requestedLayout) {
    fixes.push(`switched layout from ${requestedLayout} to ${selected.layout}`);
  }
  if (selected.trimChanges.length > 0) {
    const trimSummary = summarizeResumeTrimChanges(
      initial.resumeMarkdown,
      selected.resumeMarkdown,
      selected.trimChanges,
    );
    fixes.push(
      `trimmed ${selected.trimChanges.length} low-priority item${
        selected.trimChanges.length === 1 ? "" : "s"
      } (${trimSummary.wordCountBefore} -> ${trimSummary.wordCountAfter} words)`,
    );
  }

  if (hasPageOverflow(selected.parseability)) {
    return `Attempted automatic resume length repair by ${fixes.join(
      " and ",
    )}, but the PDF is still ${selected.parseability.pageCount} pages.`;
  }

  return initialOverflow
    ? `Resume exceeded the page target; auto-fixed by ${fixes.join(" and ")}.`
    : `Initial PDF parse was broken; auto-fixed by ${fixes.join(" and ")}.`;
}
