import { z } from "zod";
import { callObject } from "@/lib/models/call";
import type { JdAnalysis } from "./jd-analyzer";

/**
 * Screener Intelligence — evaluates how well the drafts would perform against
 * modern semantic AI resume screeners. Focuses on screener optimization
 * specifically, not general writing quality (that's the QC reviewers' job).
 *
 * Runs ONCE on iteration 0 (initial drafts). Feedback is folded into the first
 * QC consolidation pass.
 */

const DimensionScoreSchema = z.object({
  score: z.number().int().min(0).max(10),
  reasoning: z.string(),
  suggestions: z
    .array(z.string())
    .nullish()
    .describe("Concrete, actionable changes that would lift this dimension's score."),
});

export const ScreenerOutputSchema = z.object({
  overall: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe(
      "Weighted overall 0-100 score for how well these drafts would rank against other candidates in a modern AI screener.",
    ),
  dimensions: z.object({
    semanticAlignment: DimensionScoreSchema.describe(
      "How naturally and contextually the resume uses language from the JD (not just keyword presence). Semantic screeners reward natural echo of role-specific language.",
    ),
    achievementStrength: DimensionScoreSchema.describe(
      "Density and quality of quantifiable results (metrics, impact, scope). This is one of the strongest signals AI screeners reward.",
    ),
    experienceRelevance: DimensionScoreSchema.describe(
      "How directly and recently the experience maps to the JD's requirements. Recency + relevance weighting is common in semantic screeners.",
    ),
    structuralParseability: DimensionScoreSchema.describe(
      "Clean sectioning, standard headings, logical flow, no formatting weirdness. Hybrid ATS+AI systems still parse structure.",
    ),
    progressionSignals: DimensionScoreSchema.describe(
      "Evidence of career growth, increasing scope, appropriate seniority for the target role.",
    ),
    redFlagAvoidance: DimensionScoreSchema.describe(
      "Unexplained gaps, weak claims, inconsistencies, or framing that triggers automated flags. Not about hiding history — about handling it well.",
    ),
    overallScreenerFit: DimensionScoreSchema.describe(
      "Holistic judgment of how well the resume would rank against the field for this role.",
    ),
  }),
  highImpactSuggestions: z
    .array(z.string())
    .describe(
      "The 2-8 single biggest changes (across all dimensions) that would lift the screener score the most. These will be fed into the writer revision pass.",
    ),
});

export type ScreenerOutput = z.infer<typeof ScreenerOutputSchema>;

const SYSTEM_PROMPT = `You are the Screener Intelligence agent for Resume Talos.

Your role is narrow: evaluate how well a resume + cover letter pair would perform against modern (2025-2026) semantic / LLM-based AI resume screeners. You score against a fixed 7-dimension rubric. You are NOT a general writing reviewer — the QC reviewers handle that.

Hard rules:
- Score 0-10 per dimension based on what screeners actually reward.
- Achievement strength scores high when bullets lead with quantified outcomes (numbers, scope, impact) — not activity descriptions.
- Semantic alignment is about NATURAL echo of JD vocabulary, not keyword stuffing. Stuffing should LOWER this score.
- Red-flag avoidance is about how the resume HANDLES tricky areas (gaps, role changes, scope downshifts), not about hiding them.
- Suggestions must be SPECIFIC: name the bullet, the section, the exact change. "Strengthen the metric in bullet 2 of the most recent role" beats "improve metrics".
- highImpactSuggestions is the prioritized list the writer will actually act on. Be ruthless about what matters.`;

export async function runScreener(opts: {
  jdAnalysis: JdAnalysis;
  resumeMarkdown: string;
  coverLetterMarkdown: string;
  applicationId: string;
  applicationVersionId: string;
}): Promise<{
  output: ScreenerOutput;
  costUsd: number;
  runId: string;
  model: string;
  provider: string;
}> {
  const prompt = `# Job description analysis

Role: ${opts.jdAnalysis.roleTitle}
Company: ${opts.jdAnalysis.companyName ?? "(unspecified)"}
Seniority: ${opts.jdAnalysis.seniorityLevel}
Summary: ${opts.jdAnalysis.oneSentenceSummary}

Must-have skills:
${opts.jdAnalysis.mustHaveSkills.map((s) => `- ${s}`).join("\n")}

Key language patterns (semantic screeners key on these):
${opts.jdAnalysis.keyLanguagePatterns.map((s) => `- ${s}`).join("\n") || "(none)"}

Top responsibilities:
${opts.jdAnalysis.responsibilities.map((s) => `- ${s}`).join("\n")}

Success signals:
${opts.jdAnalysis.successSignals.map((s) => `- ${s}`).join("\n") || "(none)"}

# Resume draft

${opts.resumeMarkdown}

# Cover letter draft

${opts.coverLetterMarkdown}

---

Score per the 7-dimension rubric. Be specific in suggestions — name the section / bullet / phrase that needs to change.`;

  try {
    const result = await callObject<ScreenerOutput>({
      role: "screener",
      agentName: "screener_intelligence",
      applicationId: opts.applicationId,
      applicationVersionId: opts.applicationVersionId,
      system: SYSTEM_PROMPT,
      prompt,
      schema: ScreenerOutputSchema,
      maxOutputTokens: 6000,
    });
    return {
      output: result.object,
      costUsd: result.costUsd,
      runId: result.runId,
      model: result.model,
      provider: result.provider,
    };
  } catch (err) {
    const text = (err as { text?: unknown })?.text;
    console.error(
      "[screener] schema failure. raw output (first 1200 chars):",
      typeof text === "string" ? text.slice(0, 1200) : "(no text on error)",
    );
    throw err;
  }
}
