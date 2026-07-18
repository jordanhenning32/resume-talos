import { z } from "zod";
import { callObject } from "@/lib/models/call";
import { retrieveFacts, type RetrievedFact } from "./retriever";
import type { JdAnalysis } from "./jd-analyzer";
import type { KnockoutReport } from "./knockout-detector";

export type QuestionType =
  | "yes_no"
  | "multi_select"
  | "short_answer"
  | "long_answer"
  | "numeric"
  | "salary_or_range"
  | "self_id";

export type AnswerConfidence = "high" | "medium" | "low" | "needs_user_input";

export type QuestionAnswer = {
  question: string;
  questionType: QuestionType;
  suggestedAnswer: string;
  confidence: AnswerConfidence;
  groundingNotes: string;
  warnings: string[];
  groundingFactIds: string[];
};

export type QuestionnaireResult = {
  answers: QuestionAnswer[];
  generalNotes: string[];
  costUsd: number;
  factsRetrieved: number;
};

const QuestionAnswerSchema = z.object({
  question: z
    .string()
    .describe("The original question text, normalized but otherwise unchanged."),
  questionType: z
    .enum([
      "yes_no",
      "multi_select",
      "short_answer",
      "long_answer",
      "numeric",
      "salary_or_range",
      "self_id",
    ])
    .describe(
      "Classify: yes_no (binary), multi_select (radio/checkbox with options listed), short_answer (1-2 sentences), long_answer (paragraph or essay), numeric (specific number expected like years/percentage), salary_or_range (compensation), self_id (EEO/veteran/disability/race/gender voluntary disclosure).",
    ),
  suggestedAnswer: z
    .string()
    .describe(
      "The proposed answer. For yes_no: 'Yes' or 'No' (with optional one-line context). For multi_select: the option text(s) chosen. For numeric: just the number / range. For salary_or_range: a researched range OR 'Open' OR a recommendation to defer (never invent a number). For self_id: never recommend disclosure; suggest 'Prefer not to answer' as default. For short/long answer: the actual proposed prose response.",
    ),
  confidence: z
    .enum(["high", "medium", "low", "needs_user_input"])
    .describe(
      "high: KB has a direct unambiguous answer. medium: KB supports an inference. low: KB doesn't really cover this; best-effort. needs_user_input: salary, relocation willingness, self-ID — the system should not decide.",
    ),
  groundingNotes: z
    .string()
    .describe(
      "One short sentence noting which KB facts back the answer, or why confidence is low. e.g. 'Public Trust clearance held continuously 2008-2025 per KB.' or 'No KB fact addresses willingness to relocate — user-only decision.'",
    ),
  warnings: z
    .array(z.string())
    .nullish()
    .describe(
      "Optional warnings the user should consider before answering. e.g. 'Disclosing veteran status may help with priority programs but is voluntary.' or 'Your KB shows ~17 years federal civilian experience; if the bucket option is '10+', pick that.'",
    ),
  groundingFactIds: z
    .array(z.string())
    .nullish()
    .describe(
      "IDs of the KB facts that ground this answer (from the provided KB facts list). Empty if no facts apply (e.g. salary, self-ID).",
    ),
});

const QuestionnaireResponseSchema = z.object({
  answers: z
    .array(QuestionAnswerSchema)
    .describe(
      "One entry per distinct question identified in the user's pasted text, in the same order as they appear. If the paste is a single multi-part question, split into parts.",
    ),
  generalNotes: z
    .array(z.string())
    .nullish()
    .describe(
      "Optional cross-cutting observations not tied to a single question. Use sparingly — e.g. 'Several questions ask about salary; recommend looking up Glassdoor data for $role at $company before submitting.'",
    ),
});

const SYSTEM_PROMPT = `You are the Screening-Questionnaire Helper for Resume Talos.

The user is about to submit an application. Most ATS systems hit them with 5-20 screening questions AFTER they upload the resume — yes/no filters, multi-select with options, years-of-experience matrices, short-answer essays, salary expectations, self-ID/EEO. These questions are the actual filter on many platforms — answering badly means the resume never reaches a human.

Your job: read the pasted question text + the JD analysis + retrieved KB facts about this candidate, and propose a grounded answer for each question. Be conservative — never invent.

KEY RULES:

1. NEVER FABRICATE. Every claim must trace to a KB fact (cite its id in groundingFactIds) or the answer must be flagged "needs_user_input" or "low" confidence.

2. SALARY questions: NEVER make up a number. If market research data is provided, propose a range with explicit "based on market research for $role at $company". Otherwise, recommend "Open / negotiable based on full package" or flag "needs_user_input" so the user can research Glassdoor / Levels.fyi / company posting. Comp is a personal call.

3. SELF-ID / EEO / VETERAN-STATUS / DISABILITY / RACE / GENDER questions: never recommend disclosure. Suggest "Prefer not to answer" or "Decline to self-identify" as the default, with a brief note that disclosure is voluntary and personal. Exception: explicit veteran status if KB shows military service AND the JD/employer has visible priority programs for veterans (still a personal call — flag confidence: medium with a warning).

4. CITIZENSHIP / WORK AUTH: high confidence if KB shows U.S. citizenship explicitly. If KB doesn't mention citizenship, flag medium/low and note the gap.

5. CLEARANCE LEVEL: cite the highest level the KB supports. Never claim higher than KB. If JD requires higher than KB shows, propose "Held [actual level] — open to upgrading; reinstatement-eligible if previously held."

6. YEARS-OF-EXPERIENCE matrices ("0-2 / 3-5 / 5-10 / 10+ years"): pick the bucket KB facts support. If the JD's domain matches what KB shows in TIME (e.g. "17 years federal civilian agency" satisfies "10+ years federal"), confidence=high. If KB shows long total tenure but NOT clearly in the JD's domain, confidence=medium with a note.

7. KNOWN CERTIFICATIONS / DEGREES (multi-select): only check items the KB explicitly grounds. Never check a certification the KB doesn't show.

8. LONG-FORM "tell us about a time" or "why this role" prompts: produce a 100-150 word KB-grounded draft. Open with a specific, concrete claim from KB; close with how it maps to the JD's responsibilities. If KB is thin on the topic, flag low confidence and write a structural placeholder with [BRACKETS] for the user to fill.

9. KNOCKOUT CROSS-REFERENCE: if a knockout report is provided, your answers for citizenship / clearance / experience years / degree must match the verdicts there exactly. Don't re-litigate.

10. CONSISTENCY WITH THE RESUME: don't propose answers that would contradict claims the writer is likely to surface (founder framing, P&L scoping, etc. — those are guided by the JD analysis + market research context).

TONE: terse, factual, recruiter-readable. No filler ("I'm excited to..."). Active voice. Specific numbers and named programs where KB supports.

Always return EXACTLY one entry per question identified in the user's paste, in the same order.`;

export async function runQuestionnaireHelper(opts: {
  rawQuestions: string;
  jdAnalysis: JdAnalysis;
  marketResearchSummary?: string | null;
  knockoutReport?: KnockoutReport | null;
  applicationId?: string;
}): Promise<QuestionnaireResult> {
  const rawTrimmed = opts.rawQuestions.trim();
  if (rawTrimmed.length === 0) {
    return {
      answers: [],
      generalNotes: ["No questions provided."],
      costUsd: 0,
      factsRetrieved: 0,
    };
  }

  // Pre-split candidate questions by line / numbered marker / common separators
  // so we can run targeted retrieval per question. This is a best-effort
  // pre-segmentation — the LLM is the final authority on question boundaries.
  const candidates = preSplitQuestions(rawTrimmed);
  let totalRetrievalCost = 0;
  const factsById = new Map<string, RetrievedFact>();

  for (const q of candidates) {
    if (q.trim().length < 4) continue;
    try {
      const r = await retrieveFacts({ query: q, topK: 8 });
      totalRetrievalCost += r.costUsd;
      for (const f of r.facts) factsById.set(f.id, f);
    } catch (err) {
      console.warn(
        "[questionnaire-helper] retrieval failed for question:",
        err instanceof Error ? err.message : err,
      );
    }
  }
  // Always also retrieve a small overall pool so the agent has structural
  // context (current role, citizenship, clearance, top achievements).
  try {
    const overall = await retrieveFacts({
      query: `${opts.jdAnalysis.roleTitle} screening profile context citizenship clearance veteran tenure`,
      topK: 12,
    });
    totalRetrievalCost += overall.costUsd;
    for (const f of overall.facts) factsById.set(f.id, f);
  } catch {
    // best-effort
  }

  const facts = Array.from(factsById.values()).slice(0, 60);
  const factsBlock = facts
    .map(
      (f) =>
        `[id=${f.id}] (${f.factType}) ${f.content}${f.evidenceQuote ? ` ⟨quote: "${f.evidenceQuote.slice(0, 200)}"⟩` : ""}`,
    )
    .join("\n");

  const knockoutBlock = opts.knockoutReport
    ? `KNOCKOUT REPORT (already extracted from JD — your answers must stay consistent):\n${opts.knockoutReport.knockouts
        .map(
          (k) =>
            `- [${k.category}] "${k.requirement}" — coverage: ${k.coverage.verdict}${k.coverage.notes ? ` (${k.coverage.notes})` : ""}`,
        )
        .join("\n")}\n`
    : "";

  const marketBlock = opts.marketResearchSummary
    ? `\nMARKET RESEARCH SUMMARY (use only if the question asks about the company / role / salary norms):\n${opts.marketResearchSummary.slice(0, 1500)}\n`
    : "";

  const userPrompt = `JD context:
- Role: ${opts.jdAnalysis.roleTitle}
- Company: ${opts.jdAnalysis.companyName ?? "(unknown)"}
- Seniority: ${opts.jdAnalysis.seniorityLevel}
- One-sentence summary: ${opts.jdAnalysis.oneSentenceSummary}
- Must-have skills: ${opts.jdAnalysis.mustHaveSkills.slice(0, 12).join("; ")}

${knockoutBlock}${marketBlock}
RETRIEVED KB FACTS (${facts.length} facts — cite ids in groundingFactIds):
${factsBlock}

---
PASTED QUESTIONS FROM THE ATS SCREENING FORM (parse into individual questions yourself; some may be multi-part):

${rawTrimmed}
---

Return one structured answer per question. Stay conservative — flag confidence honestly.`;

  const result = await callObject<z.infer<typeof QuestionnaireResponseSchema>>({
    role: "questionnaire_helper",
    agentName: "questionnaire_helper",
    applicationId: opts.applicationId,
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
    schema: QuestionnaireResponseSchema,
    maxOutputTokens: 6000,
  });

  const answers: QuestionAnswer[] = result.object.answers.map((a) => ({
    question: a.question,
    questionType: a.questionType,
    suggestedAnswer: a.suggestedAnswer,
    confidence: a.confidence,
    groundingNotes: a.groundingNotes,
    warnings: a.warnings ?? [],
    groundingFactIds: a.groundingFactIds ?? [],
  }));

  return {
    answers,
    generalNotes: result.object.generalNotes ?? [],
    costUsd: result.costUsd + totalRetrievalCost,
    factsRetrieved: facts.length,
  };
}

/**
 * Best-effort pre-split of raw paste into candidate questions. The LLM
 * makes the final call, but per-question retrieval needs SOMETHING to
 * embed. We split on common separators that ATS questionnaire pastes use:
 *  - numbered lines ("1.", "2)", "Q1:")
 *  - blank-line separation
 *  - lines ending with "?"
 */
function preSplitQuestions(raw: string): string[] {
  // First try numbered/lettered list markers.
  const numberedMatches = raw.match(/(?:^|\n)\s*(?:\d+[.)]|Q\d+:?|\([a-z]\)|[a-z]\))\s+[^\n]+(?:\n(?![\d)]|Q\d+:?|\([a-z]\)|[a-z]\))[^\n]+)*/gm);
  if (numberedMatches && numberedMatches.length >= 2) {
    return numberedMatches.map((m) => m.replace(/^\s*(?:\d+[.)]|Q\d+:?|\([a-z]\)|[a-z]\))\s+/, "").trim());
  }
  // Otherwise split on blank lines.
  const byBlank = raw.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  if (byBlank.length >= 2) return byBlank;
  // Otherwise split on sentence-ending question marks.
  const byQuestion = raw
    .split(/(?<=\?)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (byQuestion.length >= 2) return byQuestion;
  // Fallback: just one big question.
  return [raw];
}
