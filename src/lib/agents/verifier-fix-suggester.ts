import { z } from "zod";
import { callObject } from "@/lib/models/call";
import { retrieveFacts, type RetrievedFact } from "./retriever";
import type { JdAnalysis } from "./jd-analyzer";

export type FixKind = "soften" | "drop" | "add_kb_fact";

export type VerifierFix = {
  kind: FixKind;
  title: string;
  explanation: string;
  /**
   * For `soften`: the rewritten claim text that the user can paste over
   * the original. For `drop`: the exact phrase or sentence to remove from
   * the resume. For `add_kb_fact`: a neutrally-phrased fact template the
   * user can validate and add via Quick Add.
   */
  suggestedText: string | null;
  /**
   * For `drop` / `soften`: a short snippet of where in the resume this
   * claim appears (so the user can find it). For `add_kb_fact`: null.
   */
  locationHint: string | null;
  confidence: "high" | "medium" | "low";
};

export type VerifierFixResult = {
  rootCause: "fabricated" | "ambiguous" | "out_of_scope" | "kb_gap";
  fixes: VerifierFix[];
  costUsd: number;
  factsRetrieved: number;
};

const FixSchema = z.object({
  kind: z
    .enum(["soften", "drop", "add_kb_fact"])
    .describe(
      "soften = rewrite claim to match what KB supports. drop = remove the claim entirely from resume. add_kb_fact = propose a KB fact the user can validate + add.",
    ),
  title: z
    .string()
    .describe("Very short label, ≤ 60 chars. e.g. 'Soften to KB-grounded FedRAMP claim'."),
  explanation: z
    .string()
    .describe(
      "1-2 sentence rationale. Reference the specific KB gap or fact that drove this fix. Be concrete.",
    ),
  suggestedText: z
    .string()
    .nullish()
    .describe(
      "For soften: the exact replacement text the user can paste over the old claim. For drop: the exact phrase/sentence to delete. For add_kb_fact: the neutrally-phrased fact template, e.g. 'At <employer>, operationalized access controls and audit logging on Azure Gov... [user fills in dates, scale]'. Null when not applicable.",
    ),
  locationHint: z
    .string()
    .nullish()
    .describe(
      "Short snippet from the resume markdown (≤ 120 chars) showing where the claim lives — helps the user find it in the Edit tab. Null for add_kb_fact.",
    ),
  confidence: z
    .enum(["high", "medium", "low"])
    .describe(
      "high = KB clearly supports this fix path. medium = reasonable inference. low = best-effort, user must judge.",
    ),
});

const ResponseSchema = z.object({
  rootCause: z
    .enum(["fabricated", "ambiguous", "out_of_scope", "kb_gap"])
    .describe(
      "fabricated = claim is invented, no KB support. ambiguous = KB has adjacent facts but doesn't directly support the strong wording. out_of_scope = claim is about something KB doesn't cover. kb_gap = candidate might have the experience but it's not documented.",
    ),
  fixes: z
    .array(FixSchema)
    .min(1)
    .max(3)
    .describe(
      "1-3 specific fixes, ordered by recommended preference. Usually: soften first, drop as fallback, add_kb_fact when the candidate plausibly has the experience.",
    ),
});

const SYSTEM_PROMPT = `You are the Verifier-Fix Suggester for Resume Talos.

The groundedness verifier flagged a claim in the candidate's resume as unsupported by the KB. Your job: propose 1-3 specific, actionable fixes the user can apply.

ROOT-CAUSE CLASSIFICATION:
- "fabricated": the writer invented the claim with no KB anchor. Strongest case for drop.
- "ambiguous": KB has adjacent facts but doesn't directly support the strong wording. Soften by aligning with what KB actually says.
- "out_of_scope": claim is about a domain/tech/scope KB doesn't cover at all. Drop unless user can add a KB fact.
- "kb_gap": candidate likely HAS the experience but it's not documented in KB yet. Suggest add_kb_fact AND soften the claim until then.

FIX TYPES — pick the right combo per issue:

soften
- Provide a rewritten claim that the user can paste over the bad one
- Use the JD's vocabulary where KB supports it; otherwise pivot to the closest KB-grounded language
- Don't fabricate. If the KB shows "delivered to scale" don't soften to "led at scale" — match the verb tense and scope KB actually backs
- Provide locationHint so the user can find the original bullet in the resume

drop
- Use when no meaningful KB grounding exists
- Provide the exact phrase or sentence to delete (locationHint)
- Briefly note what to write INSTEAD if the bullet collapses without it

add_kb_fact
- Use ONLY when the candidate plausibly has the experience (kb_gap root cause)
- Provide a neutrally-phrased fact template the user must validate before adding
- Use brackets for fields the user needs to fill: "At [employer], [verb] [system/scope] across [scale/dates]"
- ALWAYS pair with soften or drop — the resume still needs an immediate fix even if KB gets updated

HARD RULES:
- Never fabricate. Every soften must trace to a specific KB fact you can cite in explanation.
- Be concrete: explanation should name the KB fact id or specific phrasing that drove the fix.
- Order fixes by what the user should try FIRST. Soften before drop, drop before add_kb_fact when content is critical.
- For the "ambiguous" case, prefer one soften fix at high confidence over three weak fixes.`;

export async function runVerifierFixSuggester(opts: {
  claim: string;
  reason: string;
  jdAnalysis: JdAnalysis;
  resumeMarkdown: string;
  applicationId?: string;
}): Promise<VerifierFixResult> {
  // Retrieve facts relevant to the flagged claim — what does the KB
  // actually say in this area?
  let facts: RetrievedFact[] = [];
  let retrievalCost = 0;
  try {
    const r = await retrieveFacts({ query: opts.claim, topK: 12 });
    facts = r.facts;
    retrievalCost = r.costUsd;
  } catch (err) {
    console.warn(
      "[verifier-fix-suggester] retrieval failed; suggesting without KB context:",
      err instanceof Error ? err.message : err,
    );
  }

  const factsBlock = facts.length
    ? facts
        .map(
          (f) =>
            `[id=${f.id}] (${f.factType}, sim=${f.similarity.toFixed(2)}) ${f.content}${f.evidenceQuote ? ` ⟨quote: "${f.evidenceQuote.slice(0, 180)}"⟩` : ""}`,
        )
        .join("\n")
    : "(no facts retrieved — KB may not cover this area at all)";

  // Try to find the claim in the resume markdown so we can give a precise
  // location hint. The verifier's claim text is often a paraphrase, so we
  // match on the top 3-5 distinctive content words.
  const claimSnippet = findClaimContext(opts.claim, opts.resumeMarkdown);

  const userPrompt = `Flagged claim:
"${opts.claim}"

Verifier's reason:
${opts.reason}

JD context:
- Role: ${opts.jdAnalysis.roleTitle}
- Company: ${opts.jdAnalysis.companyName ?? "(unknown)"}
- Seniority: ${opts.jdAnalysis.seniorityLevel}
- One-sentence summary: ${opts.jdAnalysis.oneSentenceSummary}

KB facts retrieved for this claim (${facts.length} facts):
${factsBlock}

${claimSnippet ? `Where the claim appears in the resume (approximate):\n"${claimSnippet}"\n` : "Resume location: not found via keyword match — provide locationHint as null.\n"}

Resume markdown (first 4000 chars, for context):
---
${opts.resumeMarkdown.slice(0, 4000)}
---

Return 1-3 fixes per the schema.`;

  const result = await callObject<z.infer<typeof ResponseSchema>>({
    role: "verifier_fix_suggester",
    agentName: "verifier_fix_suggester",
    applicationId: opts.applicationId,
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
    schema: ResponseSchema,
    maxOutputTokens: 3000,
  });

  return {
    rootCause: result.object.rootCause,
    fixes: result.object.fixes.map((f) => ({
      kind: f.kind,
      title: f.title,
      explanation: f.explanation,
      suggestedText: f.suggestedText ?? null,
      locationHint: f.locationHint ?? null,
      confidence: f.confidence,
    })),
    costUsd: result.costUsd + retrievalCost,
    factsRetrieved: facts.length,
  };
}

/**
 * Best-effort keyword overlap to find where the claim lives in the resume.
 * The verifier's claim string is often a quote or paraphrase — we extract
 * the top distinctive content words and search the markdown for a sentence
 * that contains the most of them. Returns the surrounding ~200 chars or
 * null if no decent overlap.
 */
function findClaimContext(claim: string, markdown: string): string | null {
  const words = claim
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 5 && !STOPWORDS.has(w));
  if (words.length === 0) return null;
  // Score each line by how many distinctive words it contains.
  const lines = markdown.split("\n");
  let bestIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    let score = 0;
    for (const w of words) if (lower.includes(w)) score++;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  if (bestScore < 2 || bestIdx < 0) return null;
  // Return the line plus 50 chars of context on either side.
  const start = Math.max(0, bestIdx - 1);
  const end = Math.min(lines.length, bestIdx + 2);
  return lines.slice(start, end).join(" ").slice(0, 220).trim();
}

const STOPWORDS = new Set([
  "their",
  "those",
  "these",
  "which",
  "while",
  "where",
  "after",
  "before",
  "during",
  "should",
  "would",
  "could",
  "across",
  "experience",
  "production",
  "include",
  "including",
  "such",
  "from",
  "with",
  "this",
  "that",
  "into",
  "than",
  "have",
  "will",
  "must",
  "able",
]);
