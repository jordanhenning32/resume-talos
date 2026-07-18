import { z } from "zod";
import { callObject } from "@/lib/models/call";
import type { JdAnalysis } from "./jd-analyzer";
import type { AgentRole } from "@/lib/models/registry";
import { isLikelyUnsupportedTargetPlatform } from "./ats-simulator";

/**
 * QC Reviewer agent. Two instances run in parallel per iteration:
 *   - Reviewer A (role=reviewer_a → Claude Sonnet 4.6)
 *   - Reviewer B (role=reviewer_b)
 *
 * Each produces structured feedback on the resume + cover letter together,
 * plus an overall score and dimension scores. Cross-document consistency is
 * part of what they check, so they see both docs in one call.
 */

const DimensionScoreSchema = z.object({
  score: z.number().int().min(0).max(100),
  reasoning: z.string(),
});

const FeedbackItemSchema = z.object({
  doc: z.enum(["resume", "cover_letter", "both"]).describe(
    "Which document the feedback applies to.",
  ),
  location: z.string().nullish().describe(
    "A specific anchor in the doc (e.g. 'Summary section', 'Quadratic bullet 3', 'Cover letter paragraph 2'). Null if it's a holistic comment.",
  ),
  issue: z.string().describe(
    "What's wrong. Be specific — quote a phrase or describe a concrete problem, not a vague concern.",
  ),
  suggestion: z.string().describe(
    "Concrete change to make. The writer agent will literally try to apply this.",
  ),
});

export const QcReviewSchema = z.object({
  overall: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe(
      "Overall quality score across both documents. 90+ = ready to send. 75-89 = solid but improvable. 60-74 = significant work needed. Below 60 = restart.",
    ),
  dimensions: z.object({
    grounding: DimensionScoreSchema.describe(
      "Every factual claim ties to something in the candidate's actual KB / known background. Hallucinations crater this score.",
    ),
    relevance: DimensionScoreSchema.describe(
      "How tightly the resume + cover letter focus on what the JD asked for.",
    ),
    impact: DimensionScoreSchema.describe(
      "Quality and density of quantified outcomes. Bullets that lead with verbs and numbers; not activity descriptions.",
    ),
    voiceAndTone: DimensionScoreSchema.describe(
      "Voice matches the candidate's directives (no leading 'I', appropriate seniority register, tone profile honored in cover letter).",
    ),
    coherenceCrossDoc: DimensionScoreSchema.describe(
      "Resume and cover letter tell the same story without contradiction. Cover letter doesn't re-summarize resume bullets.",
    ),
    humanReadability: DimensionScoreSchema.describe(
      "A senior reader would find it clear, paced well, and pleasant to read. No keyword stuffing or robotic phrasing.",
    ),
  }),
  criticalIssues: z
    .array(FeedbackItemSchema)
    .describe(
      "MUST-FIX items. Anything factually wrong, contradictory, unsupported, or that would actively damage the candidate's case. Empty if none. Cap at 8.",
    ),
  importantImprovements: z
    .array(FeedbackItemSchema)
    .describe("Should-fix items that meaningfully lift quality. Cap at 10."),
  minorSuggestions: z
    .array(FeedbackItemSchema)
    .describe("Polish-level suggestions. Cap at 10."),
  summary: z
    .string()
    .describe("2-4 sentences synthesizing the review. Reference the strongest specific evidence and the biggest specific gap."),
});

export type QcReview = z.infer<typeof QcReviewSchema>;
type ReviewerRole = Extract<AgentRole, "reviewer_a" | "reviewer_b">;

const SYSTEM_PROMPT_BASE = `You are a QC Reviewer for Resume Talos.

Your job: evaluate a resume + cover letter pair against a specific job description and produce structured feedback the writer agents will act on.

Hard rules:
- Be specific. "Quadratic bullet 3 says 20x — should anchor to RFP Factory" beats "improve metrics".
- Treat the resume and cover letter as a pair. They must tell the same story without contradiction. Flag cross-doc issues.
- Critical = factually wrong, contradictory, OR a must-have JD keyword/keyphrase that doesn't appear (verbatim or near-verbatim) in the resume text when the candidate's background plausibly supports the underlying claim. Modern ATS will reject for missing supported keywords, so treat supported keyword absence as critical, not stylistic.
- Important = should-fix-to-lift-quality. Most issues live here.
- Minor = polish. Don't pad. Empty array is OK.
- Score each dimension 0-100. Overall is a holistic synthesis, not an arithmetic mean.
- If the drafts are already excellent (90+), say so and keep feedback short.
- You are independent. Don't try to anticipate or match the other reviewer.

SUMMARY ROLE-TITLE CHECK (always run this):
- The resume's Summary section is the most heavily-weighted region for nearly every ATS layer.
- Verify that the JD's literal role title (or a very close variant — ≥85% content-word overlap) appears in the Summary section.
- If the JD's title is missing entirely from the Summary, flag as CRITICAL with a specific suggestion to re-word the Summary's opening to include the title (only if KB supports the candidate plausibly holding that role).
- If the Summary is missing altogether, flag CRITICAL with a "add a Summary section" suggestion.
- This check applies to the resume only — cover letters don't have Summary sections.

ATS KEYWORD CHECK (always run this — most resumes die here):
- Employer/domain-specific platform acronyms (for example NG911, CAD, RMS, COP, MNS, OT software/hardware, operational technology) are special: if the draft does not claim direct experience with them, do NOT make their absence critical by itself. Treat the absence as an honest domain gap or optional Important/Minor note. Fabricating direct experience with target systems is worse than missing their keywords.
- For each of the JD's listed must-have skills, search the resume text (and the cover letter text) for the literal phrase or a very close variant (paraphrase that preserves the key noun + qualifier).
- Treat a missing must-have keyphrase as a CRITICAL issue with a specific suggestion: "Add the literal phrase 'X' to the [Skills line / appropriate bullet] if KB supports it; do not fabricate."
- Treat a keyphrase that's missing from BOTH the resume AND the cover letter as the worst case — flag as critical and note "missing from both docs".
- Do NOT flag a missing keyword if the underlying claim has no KB grounding (e.g., the JD wants 10 years of Kubernetes and the candidate has 0 — the resume rightly omits the claim; fabricating to satisfy ATS is worse than missing the keyword).
- "Near-verbatim" means the JD's literal noun phrase appears. "P&L responsibility" vs the JD's "P&L ownership" is near-verbatim and supports. "Financial accountability for portfolios" is a paraphrase that LOSES the keyword — flag it.`;

export async function runQcReviewer(opts: {
  reviewerRole: ReviewerRole;
  modelRole?: ReviewerRole;
  agentName?: string;
  jdAnalysis: JdAnalysis;
  resumeMarkdown: string;
  coverLetterMarkdown: string;
  applicationId: string;
  applicationVersionId: string;
}): Promise<{
  output: QcReview;
  costUsd: number;
  runId: string;
  model: string;
  provider: string;
}> {
  const reviewerLabel = opts.reviewerRole === "reviewer_a" ? "A" : "B";
  const agentName = opts.agentName ?? `qc_reviewer_${reviewerLabel.toLowerCase()}`;
  const targetPlatformCaution = buildTargetPlatformCaution(opts.jdAnalysis);

  const prompt = `# JD analysis

Role: ${opts.jdAnalysis.roleTitle}
Company: ${opts.jdAnalysis.companyName ?? "(unspecified)"}
Seniority: ${opts.jdAnalysis.seniorityLevel}
Summary: ${opts.jdAnalysis.oneSentenceSummary}

Must-have skills:
${opts.jdAnalysis.mustHaveSkills.map((s) => `- ${s}`).join("\n")}

Top responsibilities:
${opts.jdAnalysis.responsibilities.map((s) => `- ${s}`).join("\n")}

Success signals:
${opts.jdAnalysis.successSignals.map((s) => `- ${s}`).join("\n") || "(none)"}

${targetPlatformCaution}

# Resume draft

${opts.resumeMarkdown}

# Cover letter draft

${opts.coverLetterMarkdown}

---

You are Reviewer ${reviewerLabel}. Review per the schema. Be specific.`;

  try {
    const result = await callObject<QcReview>({
      role: opts.modelRole ?? opts.reviewerRole,
      agentName,
      applicationId: opts.applicationId,
      applicationVersionId: opts.applicationVersionId,
      system: SYSTEM_PROMPT_BASE,
      prompt,
      schema: QcReviewSchema,
      maxOutputTokens: 8000,
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
    if (typeof text === "string") {
      console.error(
        `[${agentName}] schema failure. raw output (first 1200 chars):`,
        text.slice(0, 1200),
      );
    } else {
      console.error(
        `[${agentName}] call failed:`,
        err instanceof Error ? err.message : err,
      );
    }
    throw err;
  }
}

function buildTargetPlatformCaution(jdAnalysis: JdAnalysis): string {
  const phrases = Array.from(
    new Set(
      [
        ...jdAnalysis.mustHaveSkills,
        ...jdAnalysis.niceToHaveSkills,
        ...jdAnalysis.keyLanguagePatterns,
        ...jdAnalysis.responsibilities,
      ].filter(isLikelyUnsupportedTargetPlatform),
    ),
  );
  if (phrases.length === 0) return "";

  return `# Target-platform grounding caution

The following JD phrases look like employer/domain-specific target systems or operating environments:
${phrases.map((phrase) => `- ${phrase}`).join("\n")}

Review these carefully. If the resume omits them because the candidate background does not show direct experience, do NOT score that omission as a hallucination-level or critical flaw. You may note it as an honest domain gap, but do not tell the writer to add these acronyms as candidate experience unless the draft already contains credible grounding.`;
}
