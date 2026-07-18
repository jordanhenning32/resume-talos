import { z } from "zod";
import { callObject } from "@/lib/models/call";
import {
  renderVoiceChunksForPrompt,
  getPinnedFacts,
  retrieveGroupedFacts,
  retrieveVoiceChunks,
} from "./retriever";
import {
  renderFactsForPromptWithIds,
  renderPinnedFactsBlock,
  type ConsolidatedFeedbackItem,
} from "./resume-writer";
import {
  getCanonicalCareerTimeline,
  renderCareerTimelineForPrompt,
} from "@/lib/kb/career-timeline";
import { renderExperienceTenureRulesForPrompt } from "@/lib/kb/experience-tenure";
import { pickCoverLetterExemplar } from "./exemplars";
import { findCertsForJd, renderCertReferenceBlock } from "./cert-acronyms";
import type { JdAnalysis } from "./jd-analyzer";
import type { KnockoutReport } from "./knockout-detector";
import type { WriterDirectives } from "@/lib/settings";
import type { FactType, MarketResearch } from "@/db/schema";

export const CoverLetterOutputSchema = z.object({
  markdown: z
    .string()
    .min(300)
    .describe(
      "The full cover letter in Markdown. ~250-350 words. Structure: opening hook (1 short paragraph), 1-2 body paragraphs telling a SPECIFIC story from the KB that mirrors the JD's success signals, a paragraph connecting personal background to the company's mission/values/recent work, closing CTA referencing jordanhenning.com (use tokened form when provided). Sign off as 'Jordan Henning'.",
    ),
  citedFactIds: z
    .array(z.string())
    .max(30)
    .describe("Every KB fact id you used. Cover letters should lean heavily on 1-2 story facts."),
  primaryStoryId: z
    .string()
    .nullish()
    .describe("The single story fact id you built the central narrative around, if any."),
  wordCount: z.number().int(),
  notes: z
    .string()
    .nullish()
    .describe("One sentence about the narrative arc you chose."),
});

export type CoverLetterOutput = z.infer<typeof CoverLetterOutputSchema>;

const SYSTEM_PROMPT_BASE = `You are the Cover Letter Writer for Resume Talos.

You produce a tight, KB-grounded cover letter that uses a specific story or experience from the candidate's background to demonstrate fit for a specific role at a specific company.

Hard rules:
- Pick ONE central story or accomplishment from the KB and let it carry the narrative. Don't try to summarize the whole resume in prose.
- Every factual claim traces to a provided KB fact id. Cite the ids in citedFactIds.
- Never invent details about the company or the candidate. Use the Market Research findings to ground company references.
- When mentioning employment dates, role tenure, or career chronology, use the CANONICAL CAREER TIMELINE exactly. Do not infer or round dates from nearby facts.
- Never attach 17+ years to leadership. The candidate has 17 years total federal IT/SSA experience and 9+ years federal IT leadership.
- Also avoid softer versions of the same error, such as "17-year arc leading..." or "17 years directing..." Use "17 years total experience, including 9+ years leadership" instead.
- Honor the tone profile: formality, technical density, mission emphasis, energy.
- Company research is for broad mission/tone alignment only. Do NOT include precise quotes, dates, named leaders, policy positions, recent-news claims, or public statements from company research unless the JD itself says that exact thing.
- Prefer broad, stable company themes ("readiness," "logistics support," "mission-critical systems") over brittle news hooks. A wrong public quote to the hiring organization is worse than a generic opener.
- Open with a hook that signals you understand THIS role at THIS company — not a generic 'I am writing to express my interest…' opener.
- Close with a direct CTA pointing the reader to jordanhenning.com (the writer directives specify the format).
- Length target: 250-350 words. The wordCount field must be accurate.
- No bullets — flowing prose.
- Sign off 'Sincerely, Jordan Henning' (or per directives if otherwise specified).

JD-vs-KB SEPARATION (the cover letter's most common failure mode):
- The JD describes what the EMPLOYER WANTS. The KB describes what the CANDIDATE HAS. Never blur the two.
- Numbers, dollar figures, P&L scale, team size, program scope, and technologies that appear ONLY in the JD are NOT candidate experience. Do not echo them back as something Jordan did.
- Example: JD says "owns $120M services P&L" with no matching KB metric → write about the closest grounded experience ("delivery leadership across federal services portfolios") rather than claiming the $120M figure.
- Years-of-experience claims must match the KB exactly — never round down or fudge. Use 17 years for total federal IT/SSA experience and 9+ years for federal IT leadership.
- Do not claim GS-14 equivalent specialized experience unless the KB and resume explicitly support GS-14. If the resume says GS-13 equivalent, the cover letter must say GS-13 equivalent too.
- The honest "I see what you need; here is the closest thing in my actual track record" framing wins. The dishonest "I have exactly what you described" framing gets caught and torpedoes the candidate.
- If a JD requirement has no KB grounding, choose: (1) substitute the closest analog the KB supports, (2) pivot to a transferable strength the KB does support, or (3) omit. Never fabricate.
- Do not claim direct experience with JD-only target systems/acronyms such as NG911, CAD, RMS, COP, MNS, OT software/hardware, or Operational Technology unless a KB fact supports direct experience. If you mention them, frame them only as an honest domain gap and quickly pivot to grounded transferable scope.

ATTRIBUTION RULE:
- Every candidate-experience claim tied to a specific employer MUST cite at least one KB fact whose metadata.company matches that employer.
- For employers where the candidate held multiple roles, especially Social Security Administration, role match matters too. If you name a specific role and dates, use facts whose metadata.role matches that role, or whose text/evidence explicitly names the same role/timeframe.
- Facts tagged to a different SSA role must stay with that role. COTR/contractor oversight belongs under Branch Chief when the supporting fact says Branch Chief; Tableau/WebFOCUS and Appeals Database modernization belongs under IT Project Manager when the supporting fact says IT Project Manager.
- UNATTRIBUTED facts (no metadata.company / tagged UNATTRIBUTED in the retrieved facts block) may only be used for transferable summary framing, NOT as if they belonged to a specific employer.
- If you cannot find an attributed fact to back an employer-specific sentence, drop it.
- Keep the cover letter consistent with the resume. If the cover letter uses a concrete outcome such as "on schedule and under budget," ensure the resume also carries that same grounded outcome under the matching role, or soften the cover letter phrasing.

KNOCKOUT QUESTIONS (filter-level requirements — read this BEFORE everything else):
- Revision items prefixed "[KNOCKOUT — HIGH]", "[KNOCKOUT — CRITICAL]", or "[KNOCKOUT — PARTIAL]" identify hard non-negotiable JD requirements — citizenship, clearance, specific years-of-experience floor, specific degree, specific named certifications, work authorization. These are FILTER-LEVEL: a missing knockout answer can drop the application before a recruiter ever reads the cover letter.
- The resume carries the primary load for knockout answers. The cover letter's role is narrower: when a knockout intersects with the story you're telling, weave the answer in naturally (e.g. when narrating a federal program win, mention the clearance held during it; when bridging years-of-experience, anchor the year claim to the JD's domain).
- DO NOT crowbar a "U.S. citizen" line into the cover letter just to satisfy ATS — that belongs on the resume. The cover letter's contribution is NARRATIVE context that makes the resume's knockout answers feel coherent.
- HARD RULE: if KB does NOT support a knockout, do not fabricate. The narrative should pivot to the closest grounded credential. Surface a "[KB GAP]" note in your output so the user sees it.
- Items marked PARTIAL (year claim not in the JD's domain) mean the resume is technically silent. The cover letter can help by including a paragraph that puts the year claim and the JD's domain in the same sentence, e.g. "Over a 12-year arc inside SSA's federal IT portfolio, I owned the agile delivery practice and the budget that backed it…"

RECRUITER SIMULATION FEEDBACK (highest-leverage signal — read this first):
- Revision items prefixed "[RECRUITER SIM]" come from a Sonnet pass simulating a SENIOR RECRUITER triaging with an LLM assistant. This is the most human-realistic signal in the revision payload.
- For cover letters specifically, recruiter concerns usually flag: a weak hook, a story that undersells the candidate's strongest credential, a mismatch between the JD's emphasis and the central narrative, or a generic close.
- These items are MORE IMPORTANT than keyword items for the cover letter. A cover letter that nails the recruiter test will outperform a cover letter that nails the keyword test, given how few recruiters use pure-ATS triage for senior roles.
- Sub-prefixes you'll see:
  - "[RECRUITER SIM] <concern>" — a top concern. Reshape the relevant paragraph or hook. HIGH priority.
  - "[RECRUITER SIM — first 5 seconds] ..." — feedback on the hook (first sentence). Make it specific, role-anchored, and immediately diagnostic of fit.
  - "[RECRUITER SIM — internal consistency] ..." — contradiction between resume and cover letter, or scope tension. Resolve via re-wording.
  - "[RECRUITER SIM — story coherence] ..." — career-arc framing. The cover letter is the natural place to bridge any apparent gap with a deliberate-trajectory story.
- KB grounding still rules. Never fabricate to address a recruiter concern.

CERT / ACRONYM EXPANSION RULE:
- When the prompt context includes a "CERT REFERENCE" block, EVERY cert or acronym from that list that you mention in the cover letter MUST appear in BOTH forms (acronym AND expansion) at least once across the letter.
- In prose, the natural form is expansion-then-acronym in parentheses: "I held the Federal Risk and Authorization Management Program (FedRAMP) authorization for…". After first use, the acronym alone is fine.
- Reason: cover letters get scanned by ATS too. Vendors search differently for acronym vs expansion.
- Don't crowbar certs into the cover letter just to satisfy the rule — only mention certs the narrative naturally calls for. The resume carries most of the cert load.
- DO NOT mention a cert the candidate doesn't actually hold. The reference is a lookup for FORMAT, not permission to claim credentials.

ATS KEYWORD HANDLING (on revision passes — read this carefully):
- Revision feedback prefixed with "ATS scan:" identifies JD keyphrases the AI screening layer is looking for AND not finding in the cover letter. Most candidates assume cover letters don't get scanned. They do.
- A cover letter cannot enumerate skills like a resume — it MUST stay narrative. So the strategy for adding keywords is different:
  1. **Hook integration** — when natural, work the literal phrase into your opening line if it's something the JD itself emphasized.
  2. **Story integration** — when the central narrative paragraph references a KB-grounded claim that matches the keyword's meaning, re-phrase that claim to use the JD's literal wording.
  3. **Close integration** — sometimes the closing CTA can carry one final relevant phrase if it doesn't feel forced.
- Items flagged "[MISSING FROM BOTH DOCS]" in the issue text are critical — the cover letter can give one keyword a natural home even if the resume already covers it (redundancy across both docs helps).
- HARD RULE: if a keyword has no KB grounding for THIS candidate, do NOT shoehorn it into the cover letter. A naturally-flowing cover letter with one missing keyword beats a stilted cover letter with the keyword crowbarred in.
- The cover letter must still read as PROSE. Don't keyword-stuff. A sentence that exists only to drop a keyword reads as obvious and hurts you with both AI screeners and humans.

VOICE REFERENCE (when present):
- If the prompt context includes a "VOICE REFERENCE" section with samples of the candidate's actual writing (LinkedIn essays, blog posts, interview transcripts), use those as the authoritative anchor for REGISTER, RHYTHM, SENTENCE SHAPE, and OPENING MOVES.
- Voice samples beat the exemplar's tone — when they disagree, follow the voice samples.
- Pattern-match the candidate's actual cadence: sentence length distribution, transition phrases they use, how they open ideas, whether they tend toward concrete-detail-first or abstract-claim-first.
- Do NOT lift content from voice samples. Their job is style only. Facts still come from the KB.
- If no voice samples are provided, fall back to the exemplar's structural pattern with the tone profile from market research.

EXEMPLAR USAGE:
- A reference exemplar cover letter from an unrelated industry is included in the prompt context below. It is there to anchor STRUCTURE (specific hook → central story → mission connection → low-pressure close), bullet-free PROSE RHYTHM, and OPENING VARIETY (never "I am writing to express my interest…").
- Pattern-match the exemplar's shape. Do NOT copy any company, person, product, metric, technology, or phrase from the exemplar.
- TONE is determined by this application's tone profile from market research, NOT by the exemplar's tone. If the tone profile says casual and the exemplar reads formal, write casual.
- The exemplar's industry is intentionally different from the candidate's. If your output starts referencing the exemplar's domain, you've drifted.`;

export type WriteCoverLetterOptions = {
  jdAnalysis: JdAnalysis;
  directives: WriterDirectives;
  research: MarketResearch | null;
  userEditsOnResearch: string | null;
  applicationId: string;
  applicationVersionId?: string;
  /**
   * Knockout-question report — passed through so the cover letter narrative
   * stays consistent with what the resume must answer. The resume is the
   * primary venue for explicit knockout answers; the cover letter's role is
   * to bridge framing for PARTIAL items (e.g. year-claim domain alignment)
   * and avoid contradiction.
   */
  knockoutReport?: KnockoutReport | null;
  /** Revision pass — include prior draft + consolidated feedback. */
  revision?: {
    priorMarkdown: string;
    feedback: ConsolidatedFeedbackItem[];
    iteration: number;
  };
};

export type WriteCoverLetterResult = {
  output: CoverLetterOutput;
  retrievalCostUsd: number;
  writerCostUsd: number;
  totalCostUsd: number;
  runId: string;
  factsUsedCount: number;
};

const COVER_LETTER_FACT_TYPES: FactType[] = [
  "story",
  "achievement",
  "project",
  "context",
  "role",
  "responsibility",
];

export async function writeCoverLetter(
  opts: WriteCoverLetterOptions,
): Promise<WriteCoverLetterResult> {
  const query = [
    opts.jdAnalysis.roleTitle,
    opts.jdAnalysis.oneSentenceSummary,
    opts.jdAnalysis.successSignals.join(", "),
    opts.jdAnalysis.responsibilities.slice(0, 5).join(", "),
    opts.jdAnalysis.companyName ?? "",
  ]
    .filter(Boolean)
    .join("\n\n");

  // Bias toward stories and context for cover letter retrieval.
  const retrieval = await retrieveGroupedFacts({
    query,
    perTypeK: 8,
    types: COVER_LETTER_FACT_TYPES,
    overflow: { enabled: true, topK: 20, similarityFloor: 0.65 },
  });
  const factsBlock = renderFactsForPromptWithIds(retrieval.groups);

  // Voice mining: pull 3 raw prose chunks from documents tagged kind="voice"
  // (LinkedIn essays, blog posts, interview transcripts) most thematically
  // similar to the JD. Used by the writer as style anchor, not for citation.
  // Returns empty if the user hasn't uploaded any voice samples yet.
  const voiceQuery = [
    opts.jdAnalysis.companyName ?? "",
    opts.jdAnalysis.oneSentenceSummary,
    opts.jdAnalysis.successSignals.slice(0, 3).join(", "),
  ]
    .filter(Boolean)
    .join("\n");
  const voice = await retrieveVoiceChunks({ query: voiceQuery, topK: 3 });
  const voiceBlock = renderVoiceChunksForPrompt(voice.chunks);

  const directiveBlock = buildDirectiveBlock(opts.directives);
  const researchBlock = buildResearchBlock(opts.research, opts.userEditsOnResearch);
  const revisionBlock = buildCoverLetterRevisionBlock(opts.revision);
  const exemplar = pickCoverLetterExemplar(opts.jdAnalysis.seniorityLevel);
  const relevantCerts = findCertsForJd({
    mustHaveSkills: opts.jdAnalysis.mustHaveSkills,
    niceToHaveSkills: opts.jdAnalysis.niceToHaveSkills,
    keyLanguagePatterns: opts.jdAnalysis.keyLanguagePatterns,
    responsibilities: opts.jdAnalysis.responsibilities,
    successSignals: opts.jdAnalysis.successSignals,
    oneSentenceSummary: opts.jdAnalysis.oneSentenceSummary,
    roleTitle: opts.jdAnalysis.roleTitle,
  });
  const certBlock = renderCertReferenceBlock(relevantCerts);
  const knockoutBlock = renderKnockoutBlockForCoverLetter(
    opts.knockoutReport ?? null,
  );
  const pinnedFacts = await getPinnedFacts();
  const pinnedBlock = renderPinnedFactsBlock(pinnedFacts);
  const careerTimeline = await getCanonicalCareerTimeline();
  const careerTimelineBlock = renderCareerTimelineForPrompt(careerTimeline);
  const experienceTenureBlock = renderExperienceTenureRulesForPrompt();

  // Stable prefix — identical across iter 0/1/2 of the same application.
  const cachedUser = `${pinnedBlock ? `${pinnedBlock}\n\n` : ""}# Job

Role: ${opts.jdAnalysis.roleTitle}
Company: ${opts.jdAnalysis.companyName ?? "(unspecified)"}
Seniority: ${opts.jdAnalysis.seniorityLevel}
Summary: ${opts.jdAnalysis.oneSentenceSummary}

Success signals the JD names:
${opts.jdAnalysis.successSignals.map((s) => `- ${s}`).join("\n") || "(none)"}

Top responsibilities:
${opts.jdAnalysis.responsibilities.slice(0, 6).map((s) => `- ${s}`).join("\n")}

# Company research

${researchBlock}

# Writer directives

${directiveBlock}

${experienceTenureBlock}

${careerTimelineBlock ? `${careerTimelineBlock}\n\n` : ""}
# Retrieved KB facts (cite by id)

${factsBlock}
${knockoutBlock ? `\n${knockoutBlock}\n` : ""}${certBlock ? `\n# CERT REFERENCE — if you mention any of these in the cover letter, include BOTH the acronym AND expansion at least once\n\n${certBlock}\n` : ""}
${voiceBlock ? `\n# VOICE REFERENCE — actual samples of the candidate's writing (style anchor only, do NOT lift content)\n\n${voiceBlock}` : ""}
# REFERENCE EXEMPLAR (structure + opening variety only — DO NOT COPY CONTENT)

The following is a polished cover letter from an unrelated industry. Pattern-match its structural moves: specific hook tied to the JD's actual language, single central story with concrete details from the KB, a paragraph connecting personal background to the company's mission/published positions, and a low-pressure close that suggests a specific next step. TONE comes from this application's tone profile above, NOT from the exemplar.

\`\`\`
${exemplar}
\`\`\``;

  // Dynamic suffix — varies per call.
  const dynamicUser = `${revisionBlock ? `\n${revisionBlock}\n` : ""}
---

Produce the cover letter per the schema.${opts.revision ? " This is a REVISION pass — apply the feedback above to the prior draft." : ""}`;

  const result = await callObject<CoverLetterOutput>({
    role: "writer_cover_letter",
    agentName: opts.revision
      ? `writer_cover_letter_revise_iter${opts.revision.iteration}`
      : "writer_cover_letter",
    applicationId: opts.applicationId,
    applicationVersionId: opts.applicationVersionId,
    cachedPrompt: {
      system: SYSTEM_PROMPT_BASE,
      cachedUser,
      dynamicUser,
    },
    schema: CoverLetterOutputSchema,
    maxOutputTokens: 4000,
  });

  const output = {
    ...result.object,
    markdown: normalizeGeneratedCoverLetterMarkdown(result.object.markdown),
    citedFactIds: mergeCitedFactIds(
      [
        ...pinnedFacts.map((fact) => fact.id),
        ...careerTimeline.flatMap((role) => role.factIds),
      ],
      result.object.citedFactIds,
      30,
    ),
  };

  return {
    output,
    retrievalCostUsd: retrieval.costUsd,
    writerCostUsd: result.costUsd,
    totalCostUsd: retrieval.costUsd + result.costUsd,
    runId: result.runId,
    factsUsedCount: retrieval.totalFacts,
  };
}

export function normalizeGeneratedCoverLetterMarkdown(markdown: string): string {
  return markdown
    .replace(
      /\bGS-13\/GS-14 equivalent specialized experience\b/gi,
      "GS-13 equivalent specialized experience",
    )
    .replace(
      /\bGS-13\/14 equivalent specialized experience\b/gi,
      "GS-13 equivalent specialized experience",
    );
}

function mergeCitedFactIds(
  priorityIds: string[],
  modelIds: string[],
  max: number,
): string[] {
  return Array.from(new Set([...priorityIds, ...modelIds])).slice(0, max);
}

function buildCoverLetterRevisionBlock(
  rev: WriteCoverLetterOptions["revision"],
): string {
  if (!rev) return "";
  const grouped = {
    high: rev.feedback.filter((f) => f.priority === "high" && f.doc !== "resume"),
    medium: rev.feedback.filter((f) => f.priority === "medium" && f.doc !== "resume"),
    low: rev.feedback.filter((f) => f.priority === "low" && f.doc !== "resume"),
  };
  const fmt = (items: ConsolidatedFeedbackItem[]) =>
    items
      .map((f) => `  - ${f.location ? `[${f.location}] ` : ""}${f.issue} → ${f.suggestion}`)
      .join("\n") || "  (none)";

  return `# REVISION PASS — iteration ${rev.iteration}

Apply the feedback to the prior cover letter draft. HIGH priority items are mandatory; MEDIUM should be applied unless they conflict with grounding; LOW are polish.

## Prior cover letter draft

${rev.priorMarkdown}

## Consolidated feedback (cover-letter-relevant only)

HIGH priority (must address):
${fmt(grouped.high)}

MEDIUM priority (should address):
${fmt(grouped.medium)}

LOW priority (polish if time):
${fmt(grouped.low)}

Important: keep what already works. Don't rewrite from scratch.`;
}

function buildDirectiveBlock(d: WriterDirectives): string {
  const lines: string[] = [];
  // Contact block — for the cover letter, the candidate's name + contact
  // line live at the top (right-aligned in the layout we render to). The
  // writer doesn't lay it out; it just needs to know the canonical contact
  // fields so any references in body prose use the same values.
  if (d.contact) {
    const parts: string[] = [];
    if (d.contact.location) parts.push(`location "${d.contact.location}"`);
    if (d.contact.email) parts.push(`email "${d.contact.email}"`);
    if (d.contact.phone) parts.push(`phone "${d.contact.phone}"`);
    if (parts.length > 0) {
      lines.push(
        `Candidate contact details (referenced by the layout's header block, do not restate in body prose unless the narrative calls for it): ${parts.join(" · ")}.`,
      );
    }
  }
  if (d.personalSite) {
    lines.push(`Personal site: ${d.personalSite.url} (display: ${d.personalSite.label}).`);
    lines.push(`CTA placement: ${d.personalSite.placement.coverLetter}`);
  }
  lines.push(`Voice — tense: ${d.voice.tense}; pronoun: ${d.voice.pronoun}; metrics bias: ${d.voice.metricsBias}.`);
  lines.push("Global rules:");
  for (const r of d.globalRules) lines.push(`  - ${r}`);
  return lines.join("\n");
}

function buildResearchBlock(
  research: MarketResearch | null,
  userEdits: string | null,
): string {
  if (!research) {
    return "(no market research available — use only what's in the KB about the company)";
  }
  const findings = research.findings as
    | {
        overview?: string;
        mission?: string | null;
        values?: string[] | null;
        culture?: string | null;
        recentNews?: Array<{ title: string; summary?: string | null; date?: string | null }> | null;
      }
    | null;
  const tone = research.toneProfile;
  const out: string[] = [];
  if (findings?.overview) out.push(`Overview: ${findings.overview}`);
  if (findings?.mission) out.push(`Mission: ${findings.mission}`);
  if (findings?.values && findings.values.length > 0) {
    out.push(`Values: ${findings.values.join(", ")}`);
  }
  if (findings?.culture) out.push(`Culture: ${findings.culture}`);
  if (findings?.recentNews && findings.recentNews.length > 0) {
    out.push(
      "Recent public signals are available but intentionally omitted from this cover-letter prompt. Do not use specific news hooks, quotes, leader statements, or dates; use broad mission themes only.",
    );
  }
  if (tone) {
    out.push("");
    out.push(`Tone profile — formality: ${tone.formality.toFixed(2)} (0=casual, 1=formal)`);
    out.push(`  technical density: ${tone.technicalDensity.toFixed(2)} (0=plain, 1=technical)`);
    out.push(`  mission emphasis: ${tone.missionEmphasis}`);
    out.push(`  energy level: ${tone.energyLevel}`);
    if (tone.notes) out.push(`  writer notes: ${tone.notes}`);
  }
  if (userEdits) {
    out.push("");
    out.push(`User-provided notes to the writer: ${userEdits}`);
  }
  return out.join("\n");
}

/**
 * Render the knockout-questions block for the cover letter writer's
 * cached prefix. Unlike the resume — where every knockout must be answered
 * verbatim — the cover letter's job is narrative bridging. Each item is
 * listed so the writer knows what NOT to contradict and where to use the
 * JD's literal phrasing to bridge PARTIAL coverage.
 */
function renderKnockoutBlockForCoverLetter(
  report: KnockoutReport | null,
): string {
  if (!report || report.knockouts.length === 0) return "";
  const lines: string[] = [];
  lines.push(`# KNOCKOUT QUESTIONS — narrative awareness (resume carries primary load)`);
  lines.push("");
  lines.push(
    `Each item below is a hard JD requirement the resume must answer. Your role in the cover letter is:`,
  );
  lines.push(
    `- Don't CONTRADICT any verified item (e.g. if KB shows Public Trust, don't write "no clearance").`,
  );
  lines.push(
    `- For PARTIAL items where the year claim isn't tied to the JD's domain, use the JD's literal phrasing in a narrative sentence to bridge the framing (e.g. include the domain noun and the year claim in the same sentence).`,
  );
  lines.push(
    `- For MISSING items, do not fabricate. Pivot the narrative to the closest grounded credential.`,
  );
  lines.push(
    `- Avoid crowbarring resume-style explicit answers ("U.S. citizen.") into the cover letter — those belong on the resume.`,
  );
  lines.push("");
  lines.push(`Items detected:`);
  lines.push("");
  for (let i = 0; i < report.knockouts.length; i++) {
    const k = report.knockouts[i];
    const verdict = k.coverage.verdict;
    lines.push(`${i + 1}. **[${k.category}]** ${k.requirement}`);
    lines.push(
      `   JD evidence: "${k.jdEvidenceQuote.slice(0, 200).replace(/\n/g, " ")}"`,
    );
    lines.push(`   Coverage status: **${verdict}**`);
    if (k.coverage.notes) {
      lines.push(`   Note: ${k.coverage.notes}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
