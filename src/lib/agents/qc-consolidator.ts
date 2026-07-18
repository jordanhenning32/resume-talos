import { z } from "zod";
import { callObject } from "@/lib/models/call";
import type { QcReview } from "./qc-reviewer";
import type { ScreenerOutput } from "./screener";

/**
 * QC Consolidator — takes Reviewer A's review, Reviewer B's review, and
 * (optionally) the Screener Intelligence output and produces a single
 * priority-bucketed list of fixes for the writer revision pass.
 *
 * Per the spec:
 *   - HIGH priority = flagged as Critical OR Important by BOTH reviewers
 *   - MEDIUM priority = flagged as Critical by only ONE reviewer
 *   - LOW priority = everything else worth surfacing
 *
 * Plus screener high-impact suggestions get folded into HIGH (iteration 0
 * only — screener runs once).
 */

const ConsolidatedItemSchema = z.object({
  priority: z.enum(["high", "medium", "low"]),
  doc: z.enum(["resume", "cover_letter", "both"]),
  location: z.string().nullish(),
  issue: z.string(),
  suggestion: z.string(),
  source: z
    .string()
    .describe("Where this came from — e.g. 'reviewer_a+b agreement', 'reviewer_a only', 'screener'."),
});

export const ConsolidationSchema = z.object({
  items: z
    .array(ConsolidatedItemSchema)
    .describe(
      "All consolidated feedback items, sorted by priority. High first, then Medium, then Low. Cap at 25.",
    ),
  recommendStop: z
    .boolean()
    .describe(
      "True if the drafts are already excellent enough to stop iterating: both reviewers > 90 AND no high-priority items. The orchestrator double-checks this with the raw scores; this is your independent judgment.",
    ),
  recommendStopReasoning: z.string(),
});

export type Consolidation = z.infer<typeof ConsolidationSchema>;

const SYSTEM_PROMPT = `You are the QC Consolidator for Resume Talos.

You are given two independent reviewer outputs (A and B) and optionally a Screener Intelligence output. Your job: merge them into a single priority-bucketed list of fixes the writer agents will apply.

Hard rules:
- HIGH = flagged as Critical OR Important by BOTH reviewers (substantively, not just by exact wording — match by intent). Screener high-impact suggestions also go HIGH.
- MEDIUM = Critical by only ONE reviewer.
- LOW = mentioned by one reviewer only as Important/Minor.
- Deduplicate intelligently. If both reviewers say "Quadratic bullet 3 lacks metric" with different wording, that's ONE high-priority item.
- DO NOT invent items neither reviewer raised.
- Preserve the specificity of the original feedback in your consolidated issue + suggestion.
- Cap at 25 items total. If there are more, drop the lowest-priority and clearly mention the truncation in items[].
- recommendStop is your independent call: are these drafts ready to ship? If yes, items can be empty or low-only.`;

export async function consolidateReviews(opts: {
  reviewA: QcReview;
  reviewB: QcReview;
  screener: ScreenerOutput | null;
  applicationId: string;
  applicationVersionId: string;
}): Promise<{ output: Consolidation; costUsd: number; runId: string }> {
  const screenerBlock = opts.screener
    ? `# Screener Intelligence

Overall: ${opts.screener.overall}/100

High-impact suggestions:
${opts.screener.highImpactSuggestions.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Dimension scores: semanticAlignment=${opts.screener.dimensions.semanticAlignment.score}/10, achievementStrength=${opts.screener.dimensions.achievementStrength.score}/10, experienceRelevance=${opts.screener.dimensions.experienceRelevance.score}/10, structuralParseability=${opts.screener.dimensions.structuralParseability.score}/10, progressionSignals=${opts.screener.dimensions.progressionSignals.score}/10, redFlagAvoidance=${opts.screener.dimensions.redFlagAvoidance.score}/10, overallScreenerFit=${opts.screener.dimensions.overallScreenerFit.score}/10
`
    : "";

  const prompt = `${screenerBlock}# Reviewer A

Overall: ${opts.reviewA.overall}/100
Summary: ${opts.reviewA.summary}

Critical issues:
${opts.reviewA.criticalIssues.map((i, n) => `${n + 1}. [${i.doc}${i.location ? ` · ${i.location}` : ""}] ${i.issue} → ${i.suggestion}`).join("\n") || "(none)"}

Important improvements:
${opts.reviewA.importantImprovements.map((i, n) => `${n + 1}. [${i.doc}${i.location ? ` · ${i.location}` : ""}] ${i.issue} → ${i.suggestion}`).join("\n") || "(none)"}

Minor suggestions:
${opts.reviewA.minorSuggestions.map((i, n) => `${n + 1}. [${i.doc}${i.location ? ` · ${i.location}` : ""}] ${i.issue} → ${i.suggestion}`).join("\n") || "(none)"}

# Reviewer B

Overall: ${opts.reviewB.overall}/100
Summary: ${opts.reviewB.summary}

Critical issues:
${opts.reviewB.criticalIssues.map((i, n) => `${n + 1}. [${i.doc}${i.location ? ` · ${i.location}` : ""}] ${i.issue} → ${i.suggestion}`).join("\n") || "(none)"}

Important improvements:
${opts.reviewB.importantImprovements.map((i, n) => `${n + 1}. [${i.doc}${i.location ? ` · ${i.location}` : ""}] ${i.issue} → ${i.suggestion}`).join("\n") || "(none)"}

Minor suggestions:
${opts.reviewB.minorSuggestions.map((i, n) => `${n + 1}. [${i.doc}${i.location ? ` · ${i.location}` : ""}] ${i.issue} → ${i.suggestion}`).join("\n") || "(none)"}

---

Consolidate per the schema. Match issues by intent, not exact wording.`;

  const result = await callObject<Consolidation>({
    role: "reviewer_a", // Sonnet for consolidation
    agentName: "qc_consolidator",
    applicationId: opts.applicationId,
    applicationVersionId: opts.applicationVersionId,
    system: SYSTEM_PROMPT,
    prompt,
    schema: ConsolidationSchema,
    maxOutputTokens: 8000,
  });

  return { output: result.object, costUsd: result.costUsd, runId: result.runId };
}
