import { z } from "zod";
import { callObject } from "@/lib/models/call";
import {
  renderFactsForPrompt,
  retrieveGroupedFacts,
} from "./retriever";
import type { JdAnalysis } from "./jd-analyzer";
import type { AgentRole } from "@/lib/models/registry";

const DimensionScoreSchema = z.object({
  name: z.string(),
  score: z.number().int().min(0).max(100),
  reasoning: z.string().min(20).max(900),
});

export const FitScoreSchema = z.object({
  overall: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe(
      "Holistic 0-100 fit score. 80+ means proceed with confidence. 65-79 means workable with strong cover-letter framing. Below 65 means significant gaps — the writer can still produce a doc but it will require stretching the user's history.",
    ),
  dimensions: z
    .array(DimensionScoreSchema)
    .min(4)
    .max(8)
    .describe(
      "Scored breakdown across 4-7 dimensions. Always include: 'Required experience match', 'Skill alignment', 'Seniority match', 'Domain/industry alignment'. Optionally add up to 3 more (e.g. 'Culture/values alignment', 'Capture/BD partnership', 'Executive stakeholder engagement') if the JD provides enough signal to score them honestly.",
    ),
  topStrengths: z
    .array(z.string())
    .min(2)
    .max(5)
    .describe(
      "2-5 bullet-point strengths the user brings to this role, grounded in the retrieved KB facts. Reference specifics (numbers, project names, role titles).",
    ),
  topGaps: z
    .array(z.string())
    .max(5)
    .describe(
      "1-5 specific gaps where the JD asks for something the user's KB doesn't cleanly demonstrate. Be honest. If there are zero gaps the JD is probably too easy or the user is overqualified — note that.",
    ),
  reasoning: z
    .string()
    .min(80)
    .max(1200)
    .describe(
      "2-4 sentences of holistic reasoning behind the overall score. Reference the strongest evidence and the most material gap.",
    ),
  recommendation: z
    .enum(["strong_proceed", "proceed", "borderline", "pass"])
    .describe(
      "strong_proceed (85+): clearly a strong fit. proceed (70-84): worth pursuing. borderline (55-69): cover letter has to do heavy lifting. pass (<55): material misalignment.",
    ),
});

export type FitScore = z.infer<typeof FitScoreSchema>;

const SYSTEM_PROMPT = `You are the Fit Scoring agent for Resume Talos.

Your job: given a JD analysis and a balanced sample of the user's actual KB facts, produce an honest 0-100 fit score for whether THIS user should pursue THIS role.

Hard rules:
- Ground every claim in the retrieved facts. Don't invent skills the user doesn't have.
- Be honest about gaps. The fit score gates whether the user spends $5-10 generating documents — a fake-high score wastes their money.
- A 100 is reserved for "this JD reads like it was written for this candidate." 90s are excellent. 80s are strong. 70s are good. 60s are workable. 50s and below are stretch.
- Calibrate to the user's target zone explicitly stated in their KB context facts. If the user has stated "less of a fit: commercial IC engineering roles", a commercial IC engineering JD should score lower regardless of skill overlap.
- Weight required experience and seniority match heaviest. A senior IC role for a director-level candidate is a poor fit even with perfect skills, and vice versa.
- Strengths and gaps should reference SPECIFICS from the facts — project names, numbers, role titles. Generic language is useless to the writer downstream.`;

const FIT_SCORE_FALLBACK_ROLE: AgentRole = "reviewer_a";

export function isFitScoreSchemaFailure(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /No object generated|schema|did not match/i.test(message);
}

export async function scoreFit(opts: {
  jdAnalysis: JdAnalysis;
  jdText: string;
  applicationId?: string;
}): Promise<{
  fitScore: FitScore;
  factCount: number;
  retrievalCostUsd: number;
  scoringCostUsd: number;
  totalCostUsd: number;
  runId: string;
}> {
  // Build a query from the JD analysis — captures the role + must-haves + key language.
  const query = [
    opts.jdAnalysis.roleTitle,
    opts.jdAnalysis.oneSentenceSummary,
    opts.jdAnalysis.mustHaveSkills.join(", "),
    opts.jdAnalysis.successSignals.join(", "),
  ]
    .filter(Boolean)
    .join("\n\n");

  // Retrieve a balanced sample — emphasis on context + role + achievement + project.
  const retrieval = await retrieveGroupedFacts({ query, perTypeK: 6 });
  const factsBlock = renderFactsForPrompt(retrieval.groups);

  const prompt = `# JD analysis

Role: ${opts.jdAnalysis.roleTitle}
Company: ${opts.jdAnalysis.companyName ?? "(unspecified)"}
Seniority: ${opts.jdAnalysis.seniorityLevel}
Function: ${opts.jdAnalysis.teamFunction ?? "(unspecified)"}
Summary: ${opts.jdAnalysis.oneSentenceSummary}

Must-have skills:
${opts.jdAnalysis.mustHaveSkills.map((s) => `- ${s}`).join("\n")}

Nice-to-have skills:
${opts.jdAnalysis.niceToHaveSkills.map((s) => `- ${s}`).join("\n") || "(none)"}

Success signals:
${opts.jdAnalysis.successSignals.map((s) => `- ${s}`).join("\n") || "(none)"}

Top responsibilities:
${opts.jdAnalysis.responsibilities.map((s) => `- ${s}`).join("\n")}

# Retrieved KB facts (balanced sample)

${factsBlock}

---

Score the fit per the schema. Be honest. Reference specific facts.`;

  let result: { object: FitScore; costUsd: number; runId: string };
  try {
    result = await callObject<FitScore>({
      role: "fit_score",
      agentName: "fit_scorer",
      applicationId: opts.applicationId,
      system: SYSTEM_PROMPT,
      prompt,
      schema: FitScoreSchema,
      maxOutputTokens: 4000,
    });
  } catch (err) {
    if (!isFitScoreSchemaFailure(err)) throw err;
    console.warn(
      `[fit-scorer] primary structured output failed; retrying with ${FIT_SCORE_FALLBACK_ROLE}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    result = await callObject<FitScore>({
      role: FIT_SCORE_FALLBACK_ROLE,
      agentName: "fit_scorer_fallback",
      applicationId: opts.applicationId,
      system: SYSTEM_PROMPT,
      prompt,
      schema: FitScoreSchema,
      maxOutputTokens: 4000,
    });
  }

  return {
    fitScore: result.object,
    factCount: retrieval.totalFacts,
    retrievalCostUsd: retrieval.costUsd,
    scoringCostUsd: result.costUsd,
    totalCostUsd: retrieval.costUsd + result.costUsd,
    runId: result.runId,
  };
}
