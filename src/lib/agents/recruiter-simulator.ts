/**
 * Recruiter Simulator agent.
 *
 * Simulates the third category of modern AI screening: a senior recruiter
 * doing high-volume triage with an LLM assistant ("Should I phone-screen
 * this candidate for $JD? Score 0-100 and explain."). This behaves nothing
 * like keyword ATS or embedding ATS — it's sensitive to first-paragraph
 * clarity, internal consistency, story coherence, and signals of judgment.
 *
 * Cost: ~$0.02 per run (Sonnet, ~5K input + ~600 output tokens). Cached on
 * the application row to avoid paying it on every page view.
 */

import { z } from "zod";
import { callObject } from "@/lib/models/call";
import type { JdAnalysis } from "./jd-analyzer";

export const RecruiterSimulationSchema = z.object({
  advanceScore: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe(
      "Probability (0-100) you'd advance this candidate to a phone screen given the JD and the triage standard described in the system prompt. 70+ = clear advance, 50-69 = borderline, <50 = pass.",
    ),
  recommendation: z
    .enum(["advance", "borderline", "pass"])
    .describe("Bucketed verdict derived from advanceScore."),
  twoSentenceRationale: z
    .string()
    .min(20)
    .describe(
      "Exactly the explanation you'd type back to yourself in your triage notes. 2 sentences. Concrete, not generic.",
    ),
  topStrengths: z
    .array(z.string())
    .min(1)
    .max(3)
    .describe(
      "1-3 things that would catch a recruiter's eye positively in this specific JD context. Each is 1 sentence, specific.",
    ),
  topConcerns: z
    .array(z.string())
    .max(3)
    .describe(
      "0-3 things that would make a recruiter hesitate. Each is 1 sentence, specific. Empty if no concerns.",
    ),
  firstImpressionNotes: z
    .string()
    .describe(
      "What you noticed in the FIRST 5 seconds — the resume's Summary opening line, the cover letter's hook. Specific. Recruiters spend ~7 seconds on the first pass.",
    ),
  internalConsistencyNotes: z
    .string()
    .describe(
      "Any contradictions between resume claims, between resume and cover letter, or between scope claims and dates/employer. Empty string if none.",
    ),
  storyCoherence: z
    .string()
    .describe(
      "Does this candidate's career arc make sense for THIS role? Are they over/underqualified? Pivoting? Coherent narrative or scattered?",
    ),
});

export type RecruiterSimulation = z.infer<typeof RecruiterSimulationSchema>;

const SYSTEM_PROMPT = `You are simulating a SENIOR TECHNICAL RECRUITER doing high-volume triage with an LLM assistant. Today you will screen ~100 candidates for the role described in the JD. You don't have time to be perfect; you have time to be RIGHT about who to spend 30 minutes on the phone with.

# Your decision frame

You are scoring 0-100 the probability you'd advance this candidate to a phone screen. NOT "is this candidate perfect" — "is this candidate worth a phone screen given the JD and what I can see in 30 seconds of triage."

# What you weight heavily

1. **First impression** (~30% of weight). The resume's Summary opening line and the cover letter's hook dominate your initial read. Vague openers ("Results-driven leader passionate about…") get penalized. Specific, role-anchored openers ("VP-level federal services delivery executive with…") get rewarded.

2. **Story coherence** (~25%). Does this candidate's career arc point AT this role? Are they pivoting (which is fine if explained), overqualified (worth flagging), underqualified (worth flagging), or are they a credible match?

3. **Concrete evidence** (~20%). Specific numbers, names, scope figures. Vague activity descriptions ("led various initiatives") count as red flags. Quantified outcomes ("compressed RFP cycle from 40 to 2 hours, 20×") count as green flags.

4. **Internal consistency** (~15%). Do dates and scope claims add up? Does the cover letter contradict the resume? Does the candidate's Summary framing match their actual recent roles?

5. **Voice authenticity** (~10%). Does the cover letter sound like a real person with a developed POV, or like generic-AI prose? "I have always be a go getter" feels human; "I am writing to express my interest" feels boilerplate.

# What you do NOT do

- You don't count keywords. You're not an ATS — an ATS already ran upstream of you.
- You don't take "must-have skills" lists literally. You make judgment calls.
- You don't penalize for missing certifications if the candidate's actual experience is strong.
- You don't reward keyword stuffing or padded experience.

# Triage rigor

- "Advance" (70-100): you'd genuinely want a phone screen. Strong fit signal.
- "Borderline" (50-69): you'd advance only if your funnel is thin or the candidate has a unique angle.
- "Pass" (0-49): you'd move to the next resume.

Be honest. If the candidate looks great, score them ≥80. If they look mismatched, score them <40. Spread is informative — too many candidates in the 55-65 band means you're hedging instead of judging.`;

/**
 * Patterns we look for in `storyCoherence` and `internalConsistencyNotes`
 * to decide if those notes are flagging a real issue (vs. saying everything
 * is fine). Conservative — when the recruiter mentions a soft concern, flag.
 */
const STORY_CONCERN_PATTERNS =
  /\b(pivot|underqualif|overqualif|scattered|incoherent|gap|concern|undersells|misalign|unclear|reaching|stretch|borderline|risk|weak|slight|but the|however)\b/i;

const CONSISTENCY_CLEAN_PATTERNS =
  /\b(none|no contradictions|no issues|no problems|consistent|coherent|all check|nothing to flag|no material)\b/i;

const FIRST_IMPRESSION_WEAK_PATTERNS =
  /\b(weak|generic|vague|cluttered|buried|unclear|could be|stronger|tighten|sharpen|improve|miss|lacks?)\b/i;

/**
 * Convert a recruiter simulation result into ConsolidatedFeedbackItem-shaped
 * revision items the writer sees on the next iteration. Each finding is
 * prefixed `[RECRUITER SIM]` so the writer recognizes the source and
 * applies the right strategy (framing / lede / story, not keyword work).
 *
 * Targeting both docs (`doc: "both"`) — recruiter feedback is usually
 * holistic and the cover-letter writer's filter passes "both" through.
 */
export function recruiterSimToFeedbackItems(
  sim: RecruiterSimulation,
): Array<{
  priority: "high" | "medium" | "low";
  doc: "resume" | "cover_letter" | "both";
  location: string | null;
  issue: string;
  suggestion: string;
}> {
  const items: Array<{
    priority: "high" | "medium" | "low";
    doc: "resume" | "cover_letter" | "both";
    location: string | null;
    issue: string;
    suggestion: string;
  }> = [];

  // Top concerns → HIGH each. These are exactly the things a recruiter
  // would advance/pass on.
  for (const concern of sim.topConcerns) {
    items.push({
      priority: "high",
      doc: "both",
      location: null,
      issue: `[RECRUITER SIM] ${concern}`,
      suggestion: `Address this in revision. The recruiter simulator flagged it as a triage-time impression a human screener would form. Reshape the relevant Summary line, bullet, or cover-letter paragraph — but only within KB grounding. If the concern can't be honestly addressed (e.g., the candidate genuinely lacks the credential), strengthen the surrounding context to compensate rather than fabricating.`,
    });
  }

  // First-impression note → MEDIUM IF it suggests improvement is needed.
  // If the note is glowing, skip it.
  if (
    sim.firstImpressionNotes &&
    FIRST_IMPRESSION_WEAK_PATTERNS.test(sim.firstImpressionNotes)
  ) {
    items.push({
      priority: "medium",
      doc: "both",
      location: null,
      issue: `[RECRUITER SIM — first 5 seconds] ${sim.firstImpressionNotes}`,
      suggestion: `Strengthen the lede. For the resume, this means the Summary's opening line. For the cover letter, the hook (first sentence). Both should be concrete, role-anchored, and diagnostic of fit — not generic.`,
    });
  }

  // Internal consistency → HIGH IF non-empty AND not a "clean" verdict.
  const consistency = sim.internalConsistencyNotes?.trim() ?? "";
  if (
    consistency.length > 0 &&
    !CONSISTENCY_CLEAN_PATTERNS.test(consistency)
  ) {
    items.push({
      priority: "high",
      doc: "both",
      location: null,
      issue: `[RECRUITER SIM — internal consistency] ${consistency}`,
      suggestion: `Resolve the contradiction. Cross-check resume claims against cover-letter claims, and verify scope/date/title figures match across both docs. A human reviewer treats contradictions as red flags.`,
    });
  }

  // Story coherence → MEDIUM IF it identifies a concern.
  if (sim.storyCoherence && STORY_CONCERN_PATTERNS.test(sim.storyCoherence)) {
    items.push({
      priority: "medium",
      doc: "both",
      location: null,
      issue: `[RECRUITER SIM — story coherence] ${sim.storyCoherence}`,
      suggestion: `Tighten the narrative arc so the candidate's path clearly points at THIS role. The cover letter is the natural place to bridge any apparent gap — frame the career trajectory as deliberate, not accidental. Stay grounded in KB facts.`,
    });
  }

  return items;
}

export async function runRecruiterSimulation(opts: {
  jdAnalysis: JdAnalysis;
  jdText: string;
  resumeMarkdown: string;
  coverLetterMarkdown: string;
  applicationId: string;
  applicationVersionId?: string;
}): Promise<{
  output: RecruiterSimulation;
  costUsd: number;
  runId: string;
}> {
  const prompt = `# JD posting (verbatim)

${opts.jdText}

# JD analysis (parsed)

Role: ${opts.jdAnalysis.roleTitle}
Company: ${opts.jdAnalysis.companyName ?? "(unspecified)"}
Seniority: ${opts.jdAnalysis.seniorityLevel}
Summary: ${opts.jdAnalysis.oneSentenceSummary}

# Resume

${opts.resumeMarkdown}

# Cover letter

${opts.coverLetterMarkdown}

---

Triage this candidate per the structured output. Be concrete and specific — your two-sentence rationale should reference actual phrases or claims, not generic categories.`;

  const result = await callObject<RecruiterSimulation>({
    role: "screener", // Sonnet — same model as the existing QC screener; different agent name
    agentName: "recruiter_llm_simulator",
    applicationId: opts.applicationId,
    applicationVersionId: opts.applicationVersionId,
    system: SYSTEM_PROMPT,
    prompt,
    schema: RecruiterSimulationSchema,
    maxOutputTokens: 4000,
  });

  return {
    output: result.object,
    costUsd: result.costUsd,
    runId: result.runId,
  };
}
