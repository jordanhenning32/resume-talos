import { z } from "zod";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { kbFacts, type MarketResearch } from "@/db/schema";
import { callObject } from "@/lib/models/call";
import { recoverCitedFactIds } from "@/lib/kb/claim-recovery";
import { parseResumeMarkdown } from "@/lib/export/parse-resume";
import {
  datesCompatible,
  getCanonicalCareerTimeline,
  roleTitlesCompatible,
  sameCompanyName,
  type CanonicalCareerRole,
} from "@/lib/kb/career-timeline";
import { checkExperienceTenureClaims } from "@/lib/kb/experience-tenure";
import type { JdAnalysis } from "./jd-analyzer";

/**
 * Groundedness Verifier. Final hard gate before export.
 *
 * Reads the final resume + cover letter and the citedFactIds it claims, then
 * fetches those facts from the KB and checks every material claim in the
 * drafts traces back to a supporting fact. Flags hallucinations.
 *
 * Uses Haiku — focused checking task, cheap, fast.
 */

const IssueSchema = z.object({
  doc: z.enum(["resume", "cover_letter"]),
  severity: z.enum(["critical", "warning"]),
  quote: z.string().describe("Verbatim phrase from the draft that is NOT supported by any KB fact."),
  location: z
    .string()
    .nullish()
    .describe("Best-effort anchor (section, bullet number, paragraph)."),
  reason: z
    .string()
    .describe(
      "Why this claim has NO supporting KB fact. Must start with 'Unsupported because:' and describe what fact would need to exist but does not. If you find supporting evidence in the KB, DO NOT include the item here at all — drop it from issuesFound entirely.",
    ),
});

export const VerifierOutputSchema = z.object({
  passes: z
    .boolean()
    .describe(
      "True if every material claim in both documents is supported by the provided KB facts. Use strict judgment.",
    ),
  issuesFound: z
    .array(IssueSchema)
    .describe(
      "ONLY unsupported claims. The default and desired state is an empty array. A claim that you can trace to a KB fact id must NEVER appear here — drop it entirely. critical = factually wrong, invented, or has no KB grounding; warning = the underlying activity IS in the KB but the draft's framing is stretched (e.g. 'led' vs 'contributed to').",
    ),
  factsUsedCount: z
    .number()
    .int()
    .describe(
      "How many of the provided cited facts you found cleanly used in the drafts. This is a self-reported sanity check — over-citation is fine; under-citation suggests the writer made claims without backing.",
    ),
  summary: z.string().describe("2-3 sentences explaining the verdict."),
});

export type VerifierOutput = z.infer<typeof VerifierOutputSchema>;

const SYSTEM_PROMPT = `You are the Groundedness Verifier for Resume Talos. You are the last gate before the documents go to a real recruiter — if a hallucination gets past you, it gets to the recruiter.

# Your job

Find every material CLAIM the drafts make that has no supporting source. List only those — supported claims must NEVER appear in issuesFound.

# Three ground-truth sources

You are given THREE sources of truth. A claim is supported if it traces to the right one of them:

- SOURCE 1: KB facts (with ids). Grounds claims ABOUT THE CANDIDATE — their numbers, titles, tenure, scope, technologies they used, awards they earned, projects they led.
- SOURCE 2: Market research (about the hiring company). Grounds claims ABOUT THE HIRING COMPANY — its mission, public strategy, recent news, products, leadership moves, internal projects. Only present if the user approved the research; treat absence as "no SOURCE 2."
- SOURCE 3: The JD posting itself (verbatim). Grounds claims the writer is echoing from the posting — the role's listed responsibilities, the company's published phrasing, anything the JD says about itself.

Match the claim to the right source. A candidate claim cannot be supported by market research; a company claim cannot be supported by KB facts.

# Core decision per claim

For each material claim:
  Q1: Is it a candidate-claim or a company-claim?
    Candidate-claim → check SOURCE 1.
    Company-claim   → check SOURCE 2 and SOURCE 3.
  Q2: Can you find supporting content in the matched source?
    YES → silently approve. Do NOT add to issuesFound.
    NO  → add to issuesFound.

"Material" = numbers, dollar figures, scope (team size, portfolio, P&L), titles, employers, technologies, dates, certifications, awards, project outcomes, employer-specific projects or strategies. Soft framing (adjectives, transitions) is NOT material.

# Failure modes you are specifically here to catch

This system has THREE recurring hallucination patterns. Be aggressive on all three.

1. JD-PARROTING (most common). The writer takes a number or scope from the JD and restates it as the candidate's experience.
   - JD says "owns $120M P&L." KB has no $120M figure. Draft says "Owned $120M P&L." → CRITICAL.
   - JD says "$30M+ capture pursuits." KB has no $30M figure. Draft says "capture partnership on $30M+ pursuits." → CRITICAL even if the candidate has done some capture work — the $30M number itself is not theirs.
   - Always check: does the KB contain THIS EXACT NUMBER or scope? If not, the claim is fabricated from the JD.

2. EMPLOYER-SPECIFIC FABRICATIONS. The cover letter or resume names a specific project, strategy, product, leadership move, or initiative belonging to the hiring company. These claims must trace to SOURCE 2 (market research) or SOURCE 3 (JD posting). They do NOT need KB support — the candidate is not claiming personal experience with these.
   - Draft: "your CMS OneGov work and VIA investment strategy." → check SOURCE 2 + SOURCE 3. If both mention CMS OneGov AND VIA, it's supported. If neither does, CRITICAL.
   - Draft: "the platform refresh your CTO announced last quarter." → same check — must trace to SOURCE 2 or 3.
   - When in doubt, search SOURCE 2's "Recent news" and "Products / Services" and SOURCE 3's verbatim text. Common variations: "OneGov" might appear as "One Gov" or "OneGov initiative."

3. TENURE / SCALE UNDERSTATEMENTS OR OVERSTATEMENTS. Years-of-experience and headcount must match the KB exactly.
   - KB: "17 years at SSA." Draft: "16+ years at SSA." → CRITICAL (understated tenure signals carelessness).
   - KB: "Led a 50-person team." Draft: "Led a 200-person team." → CRITICAL.

# Examples that ARE supported — do NOT flag these

- KB: "Led a 352-person organization." Draft: "Directed a 352-person organization." → supported (paraphrase, same number).
- KB: "Selected Tableau and WebFocus; managed integration." Draft: "Selected Tableau and WebFocus, managed integration." → supported.
- KB: "20× cycle-time reduction from 40 to 2 hours." Draft: "compressed proposal workflow from 40 hours to 2 — a 20× cycle-time reduction." → supported.

# Severity

- CRITICAL: a number, dollar figure, scope, title, employer name, technology, project name, or strategy that the KB does NOT contain. Default for hallucinations.
- WARNING: the activity IS in the KB but framing overstates the candidate's role (e.g. "I delivered" when KB says "I managed implementation of"). Use sparingly.

# Anti-pattern — DO NOT DO THIS

NEVER list a claim in issuesFound and then explain in 'reason' that the claim IS supported by ANY source. Specifically, if your reasoning would include phrases like:
  - "this is supported"
  - "fact [X] confirms this"
  - "SOURCE 2 does mention"
  - "appears in SOURCE 2 / market research / the JD"
  - "is mentioned in the KB"
  - "making it supported"
…the item does NOT belong in issuesFound. The verdict for that claim is "approved" — drop it from the array entirely. Every reason field must describe what supporting content is MISSING, not what supporting content was FOUND.

# Output format

- 'quote' is verbatim from the draft.
- 'reason' MUST start with "Unsupported because:" and describe what KB fact would need to exist but does not. If you cannot honestly write that, the item does not belong in issuesFound.

When in doubt, FLAG. Missing a hallucination is worse than over-flagging — a human can dismiss a false positive in one click, but cannot undo a hallucination that reached the recruiter.`;

export async function verifyDrafts(opts: {
  resumeMarkdown: string;
  coverLetterMarkdown: string;
  citedFactIds: string[];
  jdAnalysis: JdAnalysis;
  /** Raw JD text — second ground-truth source for company/role claims the
   *  writer can legitimately echo from the posting. */
  jdText?: string | null;
  /** Approved market research — third ground-truth source for company-side
   *  claims (mission, recent news, public strategy). Only passed when
   *  user-approved; the writer was allowed to use it, so the verifier is too. */
  marketResearch?: MarketResearch | null;
  applicationId: string;
  applicationVersionId: string;
}): Promise<{
  output: VerifierOutput;
  costUsd: number;
  runId: string;
  factsLoaded: number;
  recoveryFired: boolean;
  recoveredFactIds: string[];
}> {
  let effectiveCitedFactIds = opts.citedFactIds;
  let recoveryFired = false;
  let recoveredFactIds: string[] = [];
  if (opts.citedFactIds.length < 3) {
    const recovery = await recoverCitedFactIds({
      resumeMarkdown: opts.resumeMarkdown,
      coverLetterMarkdown: opts.coverLetterMarkdown,
      inheritedFactIds: opts.citedFactIds,
    });
    effectiveCitedFactIds = recovery.recoveredFactIds;
    recoveredFactIds = recovery.recoveredFactIds;
    recoveryFired = true;
  }

  // Pull every cited fact from the KB (plus a small safety pool of similar
  // facts to help the verifier sanity-check claims the writer might have
  // restated without citing).
  const facts =
    effectiveCitedFactIds.length > 0
      ? await db()
          .select({
            id: kbFacts.id,
            factType: kbFacts.factType,
            content: kbFacts.content,
            evidenceQuote: kbFacts.evidenceQuote,
            metadata: kbFacts.metadata,
          })
          .from(kbFacts)
          .where(inArray(kbFacts.id, effectiveCitedFactIds))
      : [];
  const careerTimeline = await getCanonicalCareerTimeline();

  const factsBlock = facts
    .map((f) => {
      const meta = (f.metadata ?? {}) as { company?: string; role?: string; startDate?: string; endDate?: string };
      const ctx =
        meta.company || meta.role
          ? ` (${[meta.company, meta.role].filter(Boolean).join(" · ")}${
              meta.startDate || meta.endDate ? ` [${meta.startDate ?? "?"}–${meta.endDate ?? "?"}]` : ""
            })`
          : "";
      return `- [${f.id}] (${f.factType})${ctx} ${f.content}${f.evidenceQuote ? `\n    evidence: "${f.evidenceQuote}"` : ""}`;
    })
    .join("\n");

  const researchBlock = buildResearchBlock(opts.marketResearch);
  const jdBlock = opts.jdText
    ? `# JD posting (verbatim — public-facing claims about the role and the hiring company)\n\n${opts.jdText}`
    : `# JD posting\n\nRole: ${opts.jdAnalysis.roleTitle}\nCompany: ${opts.jdAnalysis.companyName ?? "(unspecified)"}`;

  const prompt = `# GROUND TRUTH SOURCE 1 — KB facts (claims about the CANDIDATE)

${factsBlock || "(no facts were cited — anything material in the drafts about the candidate is unsupported)"}

# GROUND TRUTH SOURCE 2 — Market research (claims about the HIRING COMPANY)

${researchBlock}

# GROUND TRUTH SOURCE 3 — JD posting (public claims the writer can legitimately echo)

${jdBlock}

# Resume draft

${opts.resumeMarkdown}

# Cover letter draft

${opts.coverLetterMarkdown}

---

For each material claim:
- If it's about the candidate (numbers, scope, tenure, titles, technologies the candidate worked on), it must trace to SOURCE 1 (KB facts).
- If it's about the hiring company (mission, recent news, products, public strategy), it must trace to SOURCE 2 (market research) or SOURCE 3 (the JD posting verbatim).
- If it cannot be traced to any source, flag it.

Quote the offending phrase verbatim. If everything checks out, passes=true with issuesFound=[].`;

  try {
    const result = await callObject<VerifierOutput>({
      role: "verifier",
      agentName: "groundedness_verifier",
      applicationId: opts.applicationId,
      applicationVersionId: opts.applicationVersionId,
      system: SYSTEM_PROMPT,
      prompt,
      schema: VerifierOutputSchema,
      maxOutputTokens: 6000,
    });
    // Belt-and-suspenders post-filter: drop self-contradicting issues where
    // the model lists a claim then explains it IS supported. Even with the
    // tightened prompt, Haiku occasionally falls into the "thinking out loud
    // in issuesFound" pattern, so we screen the reason text for telltale
    // supported-claim phrases.
    const filtered = filterSelfContradictingIssues(result.object.issuesFound);
    const droppedCount = result.object.issuesFound.length - filtered.length;
    const outputBase: VerifierOutput =
      droppedCount > 0
        ? {
            ...result.object,
            issuesFound: filtered,
            // If filtering brought us to zero issues, the verdict flips to pass.
            passes: result.object.passes || filtered.length === 0,
          }
        : result.object;
    const crossAttributionIssues = checkCrossAttribution(opts.resumeMarkdown, facts);
    const careerTimelineIssues = checkCareerTimeline(
      opts.resumeMarkdown,
      careerTimeline,
    );
    const experienceTenureIssues = [
      ...checkExperienceTenureClaims(opts.resumeMarkdown, "resume"),
      ...checkExperienceTenureClaims(opts.coverLetterMarkdown, "cover_letter"),
    ];
    const mergedIssues = filterSelfContradictingIssues([
      ...outputBase.issuesFound,
      ...crossAttributionIssues,
      ...careerTimelineIssues,
      ...experienceTenureIssues,
    ]);
    const outputWithCross: VerifierOutput =
      crossAttributionIssues.length > 0 ||
      careerTimelineIssues.length > 0 ||
      experienceTenureIssues.length > 0
        ? {
            ...outputBase,
            issuesFound: mergedIssues,
            passes: outputBase.passes && mergedIssues.length === 0,
          }
        : outputBase;
    const output: VerifierOutput = recoveryFired
      ? {
          ...outputWithCross,
          summary: `[Recovery: ${facts.length} facts loaded via claim-recovery] ${outputWithCross.summary}`,
        }
      : outputWithCross;
    if (droppedCount > 0) {
      console.log(
        `[verifier] Dropped ${droppedCount} self-contradicting issue(s) — the model listed claims it then explained were supported.`,
      );
    }
    return {
      output,
      costUsd: result.costUsd,
      runId: result.runId,
      factsLoaded: facts.length,
      recoveryFired,
      recoveredFactIds,
    };
  } catch (err) {
    const text = (err as { text?: unknown })?.text;
    console.error(
      "[verifier] schema failure. raw output (first 1200 chars):",
      typeof text === "string" ? text.slice(0, 1200) : "(no text on error)",
    );
    throw err;
  }
}

/**
 * Render approved market research as a flat block the verifier can scan.
 * Only fields the writer is actually using are included — keep it tight.
 * Returns a "no research" sentinel when nothing is approved, so the
 * verifier knows company-side claims have no SOURCE 2 to lean on.
 */
function buildResearchBlock(research: MarketResearch | null | undefined): string {
  if (!research || research.userApproved !== "true") {
    return "(no approved market research — any specific claim about the hiring company's internal projects, products, leadership, or strategy must trace to SOURCE 3 (JD) verbatim or be flagged as unsupported)";
  }
  const findings = (research.findings ?? {}) as {
    overview?: string;
    mission?: string | null;
    values?: string[] | null;
    culture?: string | null;
    recentNews?: Array<{ title: string; summary?: string | null; date?: string | null }> | null;
    productsServices?: string[] | null;
    leadership?: string[] | null;
  };
  const out: string[] = [];
  out.push(`Company: ${research.companyName}`);
  if (findings.overview) out.push(`Overview: ${findings.overview}`);
  if (findings.mission) out.push(`Mission: ${findings.mission}`);
  if (findings.values?.length) out.push(`Values: ${findings.values.join(", ")}`);
  if (findings.culture) out.push(`Culture: ${findings.culture}`);
  if (findings.productsServices?.length) {
    out.push("Products / Services:");
    for (const p of findings.productsServices) out.push(`  - ${p}`);
  }
  if (findings.leadership?.length) {
    out.push("Leadership:");
    for (const l of findings.leadership) out.push(`  - ${l}`);
  }
  if (findings.recentNews?.length) {
    out.push("Recent news / public moves:");
    for (const n of findings.recentNews) {
      out.push(`  - ${n.title}${n.date ? ` (${n.date})` : ""}${n.summary ? `: ${n.summary}` : ""}`);
    }
  }
  if (research.userEdits) {
    out.push("");
    out.push(`User-approved additions: ${research.userEdits}`);
  }
  return out.join("\n");
}

/**
 * Self-contradiction patterns. We ONLY drop issues whose `reason` makes
 * the unconditional self-contradicting statement that the claim IS
 * supported — not partial-support reasoning ("the activity is supported
 * but not the specific number"), which is a legitimate warning shape.
 *
 * Erring on the side of keeping issues: missing a real hallucination is
 * worse than letting one false positive through (a human can dismiss it).
 */
const SELF_CONTRADICTION_PATTERNS = [
  /\bthis\s+is\s+supported\b/i,
  /\bthe\s+claim\s+is\s+supported\b/i,
  /^\s*supported\b/i,
  // "SOURCE 2 does mention" — with optional parenthetical like "SOURCE 2 (market research) does mention"
  /\bsource\s*\d+\s*(\([^)]*\))?\s*(does\s+)?(mention|contain|cover|reference|state|say|confirm|support)/i,
  // "appears in SOURCE 2 market research", "is mentioned in the KB"
  /\bappears\s+in\s+(source|market\s+research|the\s+kb|the\s+jd)/i,
  /\bis\s+(mentioned|present|listed|noted)\s+in\s+(source|market\s+research|the\s+kb|the\s+jd)/i,
  /\b(market\s+research|the\s+kb|the\s+jd\s+posting)\s+(does\s+)?(mentions?|contains?|covers?|references?|confirms?|supports?|states?|says?)\b/i,
  /\bmaking\s+it\s+supported\b/i,
  // "supporting the 'three-year tenure' claim", "supports the … claim"
  /\bsupport(s|ing)?\s+(the\s+)?(['"\w-]+\s+){0,5}claim\b/i,
];

export function filterSelfContradictingIssues(
  issues: VerifierOutput["issuesFound"],
): VerifierOutput["issuesFound"] {
  return issues.filter((issue) => {
    const reason = issue.reason ?? "";
    if (isPartialSupportReason(reason)) return true;
    return !SELF_CONTRADICTION_PATTERNS.some((re) => re.test(reason));
  });
}

function isPartialSupportReason(reason: string): boolean {
  return /\b(but|however|although|while)\b.{0,160}\b(not|no|without|unsupported|overstates?|does\s+not|doesn't|fails?\s+to)\b/i.test(
    reason,
  );
}

export function checkCrossAttribution(
  resumeMarkdown: string,
  facts: Array<{
    id: string;
    content: string;
    metadata: Record<string, unknown> | null;
  }>,
): VerifierOutput["issuesFound"] {
  const issues: VerifierOutput["issuesFound"] = [];
  const lines = resumeMarkdown.split(/\r?\n/);
  let currentCompany: string | null = null;

  for (const line of lines) {
    if (/^##\s+/.test(line)) currentCompany = null;
    const header = line.match(/^#{2,4}\s+.+?\s+(?:\u00b7|\|)\s+([^|·]+?)\s+(?:\u00b7|\|)\s+.+$/);
    if (header) {
      currentCompany = header[1].trim();
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (!bullet || !currentCompany) continue;

    const best = bestFactForBullet(bullet[1], facts);
    if (!best || best.score < 2) continue;
    const factCompany = (best.fact.metadata?.company as string | undefined)?.trim();

    // A bullet under employer X is fine if SOME fact attributed to X supports
    // it about as well as the global-best fact does. Without this, a bullet
    // genuinely grounded in an X fact gets flagged just because an off-employer
    // fact happens to share a couple of generic words ("compliance", "posture").
    const sameEmployer = bestFactForBullet(
      bullet[1],
      facts.filter((f) => {
        const c = (f.metadata?.company as string | undefined)?.trim();
        return c ? sameCompany(c, currentCompany!) : false;
      }),
    );
    if (sameEmployer && sameEmployer.score >= 2 && sameEmployer.score >= best.score - 1) {
      continue;
    }

    if (factCompany) {
      if (sameCompany(factCompany, currentCompany)) continue;
      // The bullet names the off-employer org inline (e.g. "Bronze Star, U.S.
      // Army, 2006"). The attribution is transparent to the reader, not a
      // mix-up, so don't flag it.
      if (bulletNamesCompany(bullet[1], factCompany)) continue;
      issues.push({
        doc: "resume",
        severity: "critical",
        quote: bullet[1],
        location: `Experience - ${currentCompany}`,
        reason: `Unsupported because: this bullet's matching KB fact [${best.fact.id}] is attributed to ${factCompany}, not ${currentCompany}.`,
      });
      continue;
    }
    // No company on the matched fact. A bullet sitting UNDER a specific
    // employer should be backed by a fact attributed to that employer —
    // unattributed and transferable facts belong only in Summary/Skills.
    // Flag as a warning (not critical) since the match is heuristic. The
    // stricter score floor reduces false positives from coincidental overlap.
    if (best.score < 3) continue;
    const transferable =
      (best.fact.metadata?.attribution as string | undefined) === "transferable";
    issues.push({
      doc: "resume",
      severity: "warning",
      quote: bullet[1],
      location: `Experience - ${currentCompany}`,
      reason: transferable
        ? `Possible misattribution: this bullet under ${currentCompany} best-matches KB fact [${best.fact.id}], which is marked transferable (not tied to a single employer). Transferable facts belong in Summary/Skills, not under a specific role.`
        : `Possible misattribution: this bullet under ${currentCompany} best-matches KB fact [${best.fact.id}], which has no employer attribution. Either attribute the fact to an employer in the KB or move this content to Summary/Skills.`,
    });
  }

  return issues;
}

export function checkCareerTimeline(
  resumeMarkdown: string,
  careerTimeline: CanonicalCareerRole[],
): VerifierOutput["issuesFound"] {
  if (careerTimeline.length === 0) return [];
  const issues: VerifierOutput["issuesFound"] = [];
  const parsed = parseResumeMarkdown(resumeMarkdown);

  for (const role of parsed.experience) {
    const header = [
      role.title,
      role.company ?? "(missing company)",
      role.dates ?? "(missing dates)",
    ].join(" | ");

    if (!role.company || !role.dates) {
      issues.push({
        doc: "resume",
        severity: "critical",
        quote: header,
        location: "Experience",
        reason:
          "Unsupported because: every Experience role heading must include a company and date range copied from the canonical KB career timeline.",
      });
      continue;
    }

    const companyMatches = careerTimeline.filter((canonical) =>
      sameCompanyName(role.company ?? "", canonical.company),
    );
    if (companyMatches.length === 0) {
      issues.push({
        doc: "resume",
        severity: "critical",
        quote: header,
        location: "Experience",
        reason: `Unsupported because: no canonical KB career timeline row exists for company "${role.company}".`,
      });
      continue;
    }

    const titleMatches = companyMatches.filter((canonical) =>
      roleTitlesCompatible(role.title, canonical.role),
    );
    if (titleMatches.length === 0) {
      issues.push({
        doc: "resume",
        severity: "critical",
        quote: header,
        location: `Experience - ${role.company}`,
        reason: `Unsupported because: no canonical KB career timeline row for ${role.company} has role title "${role.title}". Valid role titles: ${companyMatches.map((r) => r.role).join("; ")}.`,
      });
      continue;
    }

    const dateMatch = titleMatches.find((canonical) =>
      datesCompatible(role.dates ?? "", canonical),
    );
    if (!dateMatch) {
      issues.push({
        doc: "resume",
        severity: "critical",
        quote: header,
        location: `Experience - ${role.company}`,
        reason: `Unsupported because: the canonical KB career timeline lists ${titleMatches.map((r) => `${r.role} at ${r.company} as ${r.displayDate}`).join("; ")}, but the resume says "${role.dates}".`,
      });
    }
  }

  return issues;
}

function bestFactForBullet(
  bullet: string,
  facts: Array<{ id: string; content: string; metadata: Record<string, unknown> | null }>,
): { fact: (typeof facts)[number]; score: number } | null {
  const bulletWords = tokenize(bullet);
  let best: { fact: (typeof facts)[number]; score: number } | null = null;
  for (const fact of facts) {
    const factWords = tokenize(fact.content);
    let score = 0;
    for (const word of bulletWords) {
      if (factWords.has(word)) score++;
    }
    if (!best || score > best.score) {
      best = { fact, score };
    }
  }
  return best;
}

const STOP_WORDS = new Set([
  "and",
  "the",
  "for",
  "with",
  "from",
  "that",
  "this",
  "into",
  "over",
  "under",
  "using",
  "across",
  "through",
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9+]+/g, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 4 && !STOP_WORDS.has(word)),
  );
}

// True when the bullet text itself names the company — i.e. the candidate has
// transparently self-attributed (an award or credential earned at another org).
function bulletNamesCompany(bullet: string, company: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const c = norm(company);
  if (!c) return false;
  if (norm(bullet).includes(c)) return true;
  // Also accept an alias/abbreviation appearing in the bullet (e.g. "SSA").
  for (const key of companyKeys(bullet)) {
    if (companyKeys(company).has(key)) return true;
  }
  return false;
}

function sameCompany(a: string, b: string): boolean {
  const aKeys = companyKeys(a);
  const bKeys = companyKeys(b);
  for (const key of aKeys) {
    if (bKeys.has(key)) return true;
  }
  return abbreviationMatches(a, b);
}

function normalizeCompany(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\b(inc|llc|ltd|corp|corporation|company|digital)\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

const COMPANY_ALIAS_GROUPS = [
  ["SSA", "Social Security Administration"],
  ["VA", "Department of Veterans Affairs"],
  ["CMS", "Centers for Medicare and Medicaid Services"],
  ["GDIT", "General Dynamics IT"],
  ["MTD", "MTD Products"],
];

const COMPANY_ALIAS_KEYS = buildCompanyAliasKeys();

function buildCompanyAliasKeys(): Map<string, string> {
  const out = new Map<string, string>();
  COMPANY_ALIAS_GROUPS.forEach((forms, index) => {
    for (const form of forms) {
      out.set(normalizeCompany(form), `alias:${index}`);
    }
  });
  return out;
}

function companyKeys(value: string): Set<string> {
  const keys = new Set<string>();
  const add = (candidate: string) => {
    const normalized = normalizeCompany(candidate);
    if (!normalized) return;
    keys.add(normalized);
    const alias = COMPANY_ALIAS_KEYS.get(normalized);
    if (alias) keys.add(alias);
  };

  add(value);
  add(value.replace(/\([^)]*\)/g, " "));
  for (const form of shortCompanyForms(value)) add(form);
  return keys;
}

function abbreviationMatches(a: string, b: string): boolean {
  return (
    shortCompanyForms(a).some((form) => normalizeCompany(form) === initials(b)) ||
    shortCompanyForms(b).some((form) => normalizeCompany(form) === initials(a))
  );
}

function shortCompanyForms(value: string): string[] {
  return Array.from(new Set(value.match(/\b[A-Z0-9]{2,5}\b/g) ?? []));
}

const INITIAL_STOP_WORDS = new Set(["and", "for", "of", "the"]);

function initials(value: string): string {
  const words = value
    .replace(/\([^)]*\)/g, " ")
    .replace(/&/g, " and ")
    .match(/[A-Za-z0-9]+/g) ?? [];
  return words
    .filter((word) => !INITIAL_STOP_WORDS.has(word.toLowerCase()))
    .map((word) => (/^[A-Z0-9]{2,5}$/.test(word) ? word.toLowerCase() : word[0].toLowerCase()))
    .join("");
}
