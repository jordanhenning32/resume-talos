import { z } from "zod";
import { callObject } from "@/lib/models/call";
import {
  renderVoiceChunksForPrompt,
  getPinnedFacts,
  retrieveGroupedFacts,
  retrieveVoiceChunks,
  type RetrievedFact,
} from "./retriever";
import { pickResumeExemplar } from "./exemplars";
import { findCertsForJd, renderCertReferenceBlock } from "./cert-acronyms";
import {
  getCanonicalCareerTimeline,
  renderCareerTimelineForPrompt,
} from "@/lib/kb/career-timeline";
import { renderExperienceTenureRulesForPrompt } from "@/lib/kb/experience-tenure";
import { ensureMandatoryResumeContent } from "@/lib/export/mandatory-resume-content";
import type { JdAnalysis } from "./jd-analyzer";
import type { KnockoutReport } from "./knockout-detector";
import type { WriterDirectives } from "@/lib/settings";
import type { FactType, MarketResearch } from "@/db/schema";
import { providerCallTimeoutMs } from "@/lib/models/timeout";

export const ResumeOutputSchema = z.object({
  markdown: z
    .string()
    .min(400)
    .describe(
      "The full resume body in Markdown. Use standard sections: header (name + contact line), Summary (2-3 sentences), Experience (one '### Title · Company · dates' per role with 3-6 bullets), Skills, Education, Certifications. Bullets must START with strong verbs and lead with quantified outcomes. NO leading 'I'.",
    ),
  citedFactIds: z
    .array(z.string())
    .max(80)
    .describe(
      "Every KB fact id you drew on, by id. Used by the groundedness verifier downstream. Be generous — every quantified claim you make should have a backing id.",
    ),
  variantTargetWords: z
    .number()
    .int()
    .describe(
      "Your target word count for this variant. Long = 700-900. Short = 350-450.",
    ),
  notes: z
    .string()
    .nullish()
    .describe(
      "Optional one-paragraph note about choices you made (what you cut, what you led with, how you handled gaps).",
    ),
});

export type ResumeOutput = z.infer<typeof ResumeOutputSchema>;

const SYSTEM_PROMPT_BASE = `You are the Resume Writer for Resume Talos.

You produce a tailored, KB-grounded resume in Markdown that maximizes fit for a specific job.

Hard rules:
- Every quantified claim, role description, or skill mention must trace to a provided KB fact id. Cite the ids you used in citedFactIds.
- Do NOT invent companies, dates, titles, metrics, technologies, or projects. If the KB doesn't say it, you don't say it.
- Experience role headings MUST come from the CANONICAL CAREER TIMELINE when present. Copy the title, company, and dates exactly; never infer or round dates from nearby facts.
- Never attach 17+ years to leadership. The candidate has 17 years total federal IT/SSA experience and 9+ years federal IT leadership.
- Also avoid softer versions of the same error, such as "17-year arc leading..." or "17 years directing..." Use "17 years total experience, including 9+ years leadership" instead.
- Match the JD's vocabulary where natural (the JD's "keyLanguagePatterns" list is your guide), without keyword-stuffing.
- Lead bullets with strong verbs and quantified outcomes. "Cut X from Y hours to Z hours" beats "Worked on X".
- No first-person pronouns ("I", "my").
- One blank line between sections. One '###' heading per role. Dashes for bullets.
- Honor seniority signal: a VP-level resume has different bullet density than an IC resume.

LIGHTWEIGHT COMPANY CONTEXT:
- When a "Company context" block is provided, use it only as a LIGHT weighting signal for emphasis, vocabulary, and prioritization. It helps you decide which grounded candidate strengths to foreground.
- Do NOT turn company research into candidate claims. Company facts do not count as KB evidence and must never appear as something the candidate did.
- Avoid naming company-specific news, leaders, or internal initiatives in the resume unless the JD itself requires it and the phrasing is clearly about the target employer, not the candidate.
- The resume should still read as a portable, ATS-friendly resume tailored to the role. The cover letter carries the richer company-specific narrative.

JD-vs-KB SEPARATION (read carefully — this is the most common failure mode):
- The JD describes what the EMPLOYER WANTS. The KB describes what the CANDIDATE HAS. They are two different lists. Never let them blur.
- A number, scale figure, technology, P&L size, team size, or program scope that appears ONLY in the JD is NOT candidate experience. You may NOT restate it as something the candidate did.
- Example: if the JD says "owns $120M services P&L" and the KB contains no $120M number, you may write "delivery leadership for federal services portfolios" (substance the KB supports) but NEVER "owns $120M services P&L" (fabricated from JD).
- Example: if the JD mentions "$30M+ capture pursuits" and the KB has no such metric, do not write it. Reach for the closest supported metric in the KB or omit.
- Years-of-experience claims must match the KB exactly. The candidate has 17 years total federal IT/SSA experience, but only 9+ years federal IT leadership; never write "17+ years federal IT leadership."
- When a JD requirement has NO matching KB evidence, you have three honest options: (1) substitute the closest analog the KB supports, (2) emphasize transferable skills the KB does support, or (3) omit. You may NOT fabricate.
- If you reach for a JD phrase, ask yourself: "Which KB fact id grounds this exact number/scale/scope?" If you cannot point at one, rewrite.
- Do NOT claim direct experience with target-company-specific systems, acronyms, or operating environments (for example NG911, CAD, RMS, COP, MNS, OT software/hardware) unless a KB fact explicitly supports that exact system or a clearly equivalent class. Do not use "adjacent to" as a workaround for unsupported direct experience.
- Do NOT list unsupported JD-only platform acronyms in Skills or Summary as candidate capabilities. If strategically necessary, acknowledge the domain gap once in plain language, after the grounded transferable scope. Never write that the candidate tracks, leads, manages, or assesses OT software/hardware unless KB facts say so.

ATTRIBUTION RULE:
- Every bullet under an Experience role MUST cite at least one KB fact whose metadata.company matches the role's company.
- For employers where the candidate held multiple roles, especially Social Security Administration, company match alone is NOT enough. A bullet under a specific Experience role must be grounded by facts whose metadata.role matches that role, or by facts whose text/evidence explicitly names that same role and timeframe.
- Facts tagged to a different role at the same employer MUST stay under that matching role. Example: Tableau/WebFocus / agency-wide BI implementation belongs under the IT Project Manager tenure, not Branch Chief.
- Company-only facts with no metadata.role may be used in Summary or Skills as transferable context, but do NOT place them under a specific Experience role unless the fact text itself clearly names that role and timeframe.
- UNATTRIBUTED facts (no metadata.company / tagged UNATTRIBUTED in the retrieved facts block) may only be cited in transferable-skills sections (Summary or Skills), NOT under any specific Experience role.
- Personal projects, side projects, and independent builds may only appear in Projects, Summary, or Skills unless the fact metadata.company explicitly matches the employer role.
- Contracting Officer Technical Representative (COTR) is a Branch Chief / federal contracting fact. Do not place COTR or "COTR-style" language under Quadratic Digital unless a Quadratic-attributed fact explicitly supports it.
- If you cannot find an attributed fact to back a bullet under a given employer, that bullet does not belong there. Drop it.
- If a role appears in retrieved facts but NOT in the CANONICAL CAREER TIMELINE, do not create an Experience heading for it. Use it only as transferable Summary/Skills context when grounded.

KNOCKOUT QUESTIONS (filter-level requirements — read this BEFORE everything else):
- Revision items prefixed "[KNOCKOUT — HIGH]", "[KNOCKOUT — CRITICAL]", or "[KNOCKOUT — PARTIAL]" identify hard non-negotiable JD requirements — citizenship, clearance, specific years-of-experience floor, specific degree, specific named certifications, work authorization. These are FILTER-LEVEL concerns: many ATS systems drop applications that don't EXPLICITLY answer these questions, regardless of keyword coverage or overall fit.
- For each knockout item, address it with a verbatim, easy-to-find answer near the TOP of the resume — Summary section, a dedicated "Clearances & Eligibility" line, or the Skills line. The reader should NOT have to hunt for the answer.
- Format conventions:
  - Citizenship: "U.S. citizen." as a standalone line or in Summary.
  - Clearance: "Public Trust Clearance - High Risk Tier (previously held 2008-2025; reinstatement-eligible)" with explicit status. Use "previously held" unless KB explicitly says the clearance is currently active. Match or exceed the JD's required level; never overstate.
  - Years-of-experience floor: surface a literal "X+ years" claim TIED to the JD's named domain. For federal IT / SSA total experience, use "17 years total federal IT experience." For leadership / management / supervisory / GS-13/14 requirements, use "9+ years federal IT leadership." NEVER write "17+ years federal IT leadership."
  - Degree: include both abbreviation AND field, e.g. "M.B.A., Malone University" and "B.A. in Computer Information Systems, Kent State University" — the abbreviation alone may not match the JD's degree phrasing.
  - Certifications: spell out both the acronym AND the expansion at least once (this also satisfies the CERT EXPANSION rule below).
- HARD RULE: if the KB does NOT support a knockout (the candidate isn't a U.S. citizen, doesn't hold the cert, doesn't meet the years floor for that specific domain), DO NOT fabricate. Skip the item and surface a clear "[KB GAP]" note in your output — the user will see it and decide. Fabricating to satisfy a knockout is worse than failing one.
- Items marked PARTIAL (e.g. "17 years claimed but not tied to the JD's P&L domain") mean a strict reviewer might not credit the claim. Rewrite the surrounding bullet so the year claim and the domain noun appear together, e.g. "delivered $200M+ federal IT portfolio P&L oversight over 12 years" instead of "17 years federal experience" alone in the Summary and "P&L oversight" elsewhere.

RECRUITER SIMULATION FEEDBACK (highest-leverage signal — read this first):
- Revision items prefixed "[RECRUITER SIM]" come from a Sonnet pass simulating a SENIOR RECRUITER doing high-volume triage with an LLM assistant. This is a HUMAN-perspective signal, not keyword matching.
- A single recruiter concern like "the cover letter undersells the multi-agent story" is worth more than five keyword tweaks. The recruiter is modeling who actually advances to a phone screen.
- Recruiter items target framing, lede, story choice, internal consistency, and overall coherence. Address them BEFORE working on keyword items.
- Sub-prefixes you'll see:
  - "[RECRUITER SIM] <concern>" — a top concern. Reshape the relevant section. HIGH priority.
  - "[RECRUITER SIM — first 5 seconds] ..." — the lede impression (Summary opener / cover hook). Tighten it.
  - "[RECRUITER SIM — internal consistency] ..." — contradiction or scope-vs-claim tension. Resolve via re-wording, not by inventing new facts.
  - "[RECRUITER SIM — story coherence] ..." — career-arc framing. Often best addressed in the cover letter, but can reshape the resume's role descriptions too.
- KB grounding still rules. If a recruiter concern points at a credential the candidate lacks, you cannot fabricate it — instead, strengthen the surrounding context (transferable evidence, adjacent KB facts) so the absence is less prominent.

CANONICAL SECTION NAMES (filter-level — read this carefully):
- Section headers MUST use these EXACT canonical names. Workday, Taleo, and most enterprise ATS parsers key the candidate profile off literal header strings; variant names cause the parser to silently skip the section. Even small deviations ("Career Highlights" instead of "Summary", "Tech Toolkit" instead of "Skills", "Certifications & Awards" instead of "Certifications") cost real signal.
- Use these names EXACTLY for the four core sections:
  - "## Summary"  (not "Professional Summary" / "Career Highlights" / "Executive Summary")
  - "## Experience"  (not "Professional Experience" / "Work Experience" / "Employment History")
  - "## Skills"  (not "Technical Skills" / "Core Competencies" / "Tech Toolkit")
  - "## Education"  (not "Academic Background" / "Education & Training")
- For other sections, prefer canonical ATS-friendly names: "## Certifications", "## Clearances", "## Awards", "## Projects", "## Publications", "## Volunteer", "## Languages". Avoid compound names like "Clearances & Eligibility" or "Certifications & Awards" — split into two single-name sections instead.

HARD PAGE LIMIT (filter-level):
- Long variant: MUST fit 2 pages (≤ 900 words total). Short variant: MUST fit 1 page (≤ 500 words).
- A resume that overflows the page limit is auto-rejected by many recruiter pipelines BEFORE keyword scoring. This is the hardest constraint in the system.
- If your content won't fit: drop the lowest-impact bullets, compress wordy phrasing, cut adjectives, remove roles older than 15 years unless directly material to the JD. NEVER drop knockout-relevant content (citizenship, clearance, years claim, degree, named certs).
- Resume bullets target one line each. Three-line bullets are almost always too long — break or rewrite.

SUMMARY SECTION RULE (structural — read this carefully):
- The resume MUST have a Summary section (header: "## Summary") near the top.
- The JD's literal role title (or a very close variant covering ≥85% of its content words) MUST appear in the Summary if KB grounding allows the candidate to plausibly hold that title.
- Most ATS layers weight the Summary section heavily — a missing or paraphrased role title here is one of the most common reasons resumes fail keyword scoring.
- Preferred format: lead the Summary with a noun-phrase identity that contains the JD title, e.g. "VP, Federal AI Services Delivery with 9+ years federal IT leadership and 17 years total federal IT experience…" or "Federal AI Services Delivery executive with…"
- If the candidate's career doesn't yet match the title exactly (e.g. CGO applying to a VP role), use a phrasing that BRIDGES — "Federal services delivery executive (Chief Growth Officer, Quadratic Digital) targeting a VP, Federal AI Services Delivery role with…" — so the literal title still appears in the Summary.
- Never invent seniority. If the candidate has never been an "executive" at all, don't open with "executive." Truth > ATS optimization.

CERT / ACRONYM EXPANSION RULE:
- In the Certifications section, omit years unless the KB evidence explicitly says the credential was earned or issued in that year. If the date could be read as an expiration, renewal, or candidate-confirmation date, list the credential without a year.
- Candidate-confirmed lapsed or previously held credentials are still resume facts when clearly marked with their status. List them in Certifications as "lapsed" or "previously held"; never imply they are active.
- When the prompt context includes a "CERT REFERENCE" block, EVERY cert or acronym listed there that you actually mention in the resume MUST appear in BOTH forms (acronym AND expansion) at least once.
- Preferred format: spell out the expansion the first time the cert appears, with the acronym in parentheses: "Federal Risk and Authorization Management Program (FedRAMP)". Subsequent uses can just use the acronym.
- Alternate format also works: "FedRAMP (Federal Risk and Authorization Management Program)" — choose whichever reads better in the bullet.
- Reason: ATS vendors index differently — some search the acronym, some the expansion. Including both is the cheapest hedge against scanner variance.
- DO NOT mention a cert the candidate doesn't actually hold. The reference block is a lookup for FORMAT, not permission to claim credentials. Grounding rules still apply.
- Skills line is a great place to include both forms for clearances and certs: "Public Trust clearance · FAC-P/PM (Federal Acquisition Certification — Program/Project Managers)".

ATS KEYWORD HANDLING (on revision passes — read this carefully):
- Revision feedback prefixed with "ATS scan:" identifies JD keyphrases the AI screening layer is looking for AND not finding in the current draft. These are MECHANICAL keyword gaps, not opinion. Address them deliberately.
- The single most common cause of resumes dying at screening is a missing literal keyword. So when an ATS feedback item appears with HIGH priority (missing must-have), TREAT IT AS A HARD REQUIREMENT TO FIX — but only via the strategies below.
- Fix strategies, in order of preference:
  1. **Skills line** — most ATS layers weight the Skills section heavily. Adding the literal phrase here is the cheapest win when KB supports it (e.g. "Public Trust clearance" → add to Skills line directly).
  2. **Re-word an existing bullet** — find a bullet whose underlying claim already matches the keyword's meaning, and re-phrase the bullet to use the JD's literal wording. The bullet still cites the same KB fact; you're just changing the surface form.
  3. **Add a new bullet** — only when KB has unsurfaced grounding for the keyword that doesn't fit any existing bullet. Cite the supporting fact id.
- Items flagged "[MISSING FROM BOTH DOCS]" in the issue text are the worst-case ATS red flags — these MUST be addressed if any KB grounding exists.
- HARD RULE: if no KB fact supports the underlying claim, DO NOT add the keyword. Skipping is correct. Fabricating to satisfy ATS is worse than missing a keyword.
- For target-domain platform acronyms that are JD-only and not in the KB, omit them from candidate-experience claims. If useful, use broader grounded analogs such as "mission-critical federal platforms," "public-facing federal systems," or "life-impacting service delivery" only when the KB supports those analogs.
- If reviewer or ATS feedback asks for NG911, CAD, RMS, COP, MNS, OT, or Operational Technology but the KB does not support direct experience, do not put those tokens in the Skills line as capabilities. At most, use a short gap disclosure such as "Direct NG911/CAD/RMS domain experience is a stated gap; transferable scope is mission-critical federal application delivery."
- Avoid keyword-stuffing. Each added keyword should sit inside a real bullet/section. A 20-word skills line with no context will be detected as stuffing by modern ATS and downgraded.

VOICE REFERENCE (when present):
- If the prompt context includes a "VOICE REFERENCE" section with samples of the candidate's actual writing, use it to anchor BULLET RHYTHM and VERB CHOICE — how they phrase outcomes when they're writing as themselves.
- Voice samples are style-only. Facts still come from the KB.
- Resume bullets must stay tight (verb-led, quantified). Voice samples won't be bullet-shaped, but their word choice and concreteness should inform bullet voice.
- If no voice samples are provided, fall back to the exemplar's pattern.

EXEMPLAR USAGE:
- A reference exemplar resume from an unrelated industry is included below the JD analysis. It is there to anchor STRUCTURE, BULLET RHYTHM, VERB CHOICE, and QUANTIFICATION DEPTH — nothing else.
- Pattern-match the exemplar's shape: section headings, role-header line format, 3-5 bullets per role, verbs in past tense, every bullet leading with a strong verb and a quantified outcome where possible.
- Do NOT copy any company, person, product, metric, or technology from the exemplar. Every concrete claim still comes from the KB.
- The exemplar's industry is intentionally different from the candidate's. If your output starts to read like the exemplar's domain instead of the candidate's, you've drifted.`;

const RESUME_USER_PROMPT_HEADER = `You will produce a resume for Jordan Henning. The contact line directly under the candidate name on the resume header MUST contain every contact field listed in the Writer Directives below — location, email, phone, personal site — separated by " · ". Each field is mandatory; omitting any of them is wrong.`;

export type ConsolidatedFeedbackItem = {
  priority: "high" | "medium" | "low";
  doc: "resume" | "cover_letter" | "both";
  location?: string | null;
  issue: string;
  suggestion: string;
};

export type WriteResumeOptions = {
  variant: "long" | "short";
  jdAnalysis: JdAnalysis;
  directives: WriterDirectives;
  applicationId: string;
  applicationVersionId?: string;
  /**
   * Light company context for weighting resume emphasis and vocabulary.
   * Candidate claims must still come only from KB facts.
   */
  research?: MarketResearch | null;
  userEditsOnResearch?: string | null;
  /**
   * Knockout-question report (citizenship / clearance / years / degree /
   * certification / work auth). When provided, the writer sees the specific
   * items it must address explicitly in the resume — paired with KB
   * coverage status per item so it knows which to surface verbatim, which
   * to bridge, and which to omit (no fabrication). Stays in the cached
   * prefix so caching still works across iterations.
   */
  knockoutReport?: KnockoutReport | null;
  /** Revision pass — include prior draft + consolidated feedback. */
  revision?: {
    priorMarkdown: string;
    feedback: ConsolidatedFeedbackItem[];
    iteration: number;
  };
};

export type WriteResumeResult = {
  output: ResumeOutput;
  retrievalCostUsd: number;
  writerCostUsd: number;
  totalCostUsd: number;
  runId: string;
  factsUsedCount: number;
};

const RESUME_FACT_TYPES: FactType[] = [
  "achievement",
  "role",
  "responsibility",
  "project",
  "skill",
  "tool",
  "certification",
  "education",
  "metric",
  "context",
];

export async function writeResume(opts: WriteResumeOptions): Promise<WriteResumeResult> {
  // Build a comprehensive retrieval query from the JD.
  const query = [
    opts.jdAnalysis.roleTitle,
    opts.jdAnalysis.oneSentenceSummary,
    opts.jdAnalysis.mustHaveSkills.join(", "),
    opts.jdAnalysis.niceToHaveSkills.join(", "),
    opts.jdAnalysis.responsibilities.join(", "),
    opts.jdAnalysis.keyLanguagePatterns.join(", "),
  ]
    .filter(Boolean)
    .join("\n\n");

  // Get a generous balanced sample of facts.
  const perTypeK = opts.variant === "long" ? 15 : 10;
  const retrieval = await retrieveGroupedFacts({
    query,
    perTypeK,
    types: RESUME_FACT_TYPES,
    overflow: { enabled: true, topK: 20, similarityFloor: 0.65 },
  });
  capRetrievalGroups(retrieval.groups, opts.variant === "long" ? 80 : 50);
  retrieval.totalFacts = retrieval.groups.reduce((sum, group) => sum + group.facts.length, 0);
  const factsBlock = renderFactsForPromptWithIds(retrieval.groups);

  // Voice mining for resume — same retriever as cover letter but with fewer
  // samples (resume bullets are short, less voice surface area to anchor).
  // Returns empty if no voice docs uploaded.
  const voiceQuery = [
    opts.jdAnalysis.roleTitle,
    opts.jdAnalysis.oneSentenceSummary,
  ]
    .filter(Boolean)
    .join("\n");
  const voice = await retrieveVoiceChunks({ query: voiceQuery, topK: 2 });
  const voiceBlock = renderVoiceChunksForPrompt(voice.chunks);

  const targetWords =
    opts.variant === "long"
      ? "750-850 words. HARD CAP: 900 words / 2 PAGES. Anything over 2 pages is auto-rejected by recruiter pipelines — this is a non-negotiable ceiling."
      : "350-450 words. HARD CAP: 500 words / 1 PAGE. One page is the entire format for this variant; never spill onto a second.";

  const directiveBlock = buildDirectiveBlock(opts.directives);
  const researchBlock = buildResumeResearchBlock(
    opts.research ?? null,
    opts.userEditsOnResearch ?? null,
  );
  const revisionBlock = buildResumeRevisionBlock(opts.revision);
  const exemplar = pickResumeExemplar(opts.jdAnalysis.seniorityLevel);
  // Cert-acronym detection: only inject a CERT REFERENCE block when this
  // JD actually references known certs. Keeps the prompt lean for roles
  // that don't need it (e.g. consumer tech IC).
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
  const knockoutBlock = renderKnockoutBlockForResume(opts.knockoutReport ?? null);
  const pinnedFacts = await getPinnedFacts();
  const pinnedBlock = renderPinnedFactsBlock(pinnedFacts);
  const careerTimeline = await getCanonicalCareerTimeline();
  const careerTimelineBlock = renderCareerTimelineForPrompt(careerTimeline);
  const experienceTenureBlock = renderExperienceTenureRulesForPrompt();

  // Stable prefix — identical across iter 0/1/2 of the same application.
  // This is what gets cached on the first call and read cheaply after.
  const cachedUser = `${pinnedBlock ? `${pinnedBlock}\n\n` : ""}${RESUME_USER_PROMPT_HEADER}

# Variant: ${opts.variant.toUpperCase()}
Target length: ${targetWords}.

# Job description analysis
Role: ${opts.jdAnalysis.roleTitle}
Company: ${opts.jdAnalysis.companyName ?? "(not specified)"}
Seniority: ${opts.jdAnalysis.seniorityLevel}
Function: ${opts.jdAnalysis.teamFunction ?? "(not specified)"}
Summary: ${opts.jdAnalysis.oneSentenceSummary}

Must-have skills:
${opts.jdAnalysis.mustHaveSkills.map((s) => `- ${s}`).join("\n")}

Nice-to-have skills:
${opts.jdAnalysis.niceToHaveSkills.map((s) => `- ${s}`).join("\n") || "(none)"}

Key language patterns (echo naturally where it fits):
${opts.jdAnalysis.keyLanguagePatterns.map((s) => `- ${s}`).join("\n") || "(none)"}

Top responsibilities:
${opts.jdAnalysis.responsibilities.map((s) => `- ${s}`).join("\n")}

# Company context (lightweight - emphasis only, NOT candidate evidence)
${researchBlock}

# Writer directives
${directiveBlock}

${experienceTenureBlock}

${careerTimelineBlock ? `${careerTimelineBlock}\n\n` : ""}
# Retrieved KB facts (with ids — cite these in citedFactIds)

${factsBlock}
${knockoutBlock ? `\n${knockoutBlock}\n` : ""}${certBlock ? `\n# CERT REFERENCE — when you mention any cert/acronym below, include BOTH the acronym AND the expansion at least once\n\n${certBlock}\n` : ""}
${voiceBlock ? `\n# VOICE REFERENCE — actual samples of the candidate's writing (style anchor only, do NOT lift content)\n\n${voiceBlock}` : ""}
# REFERENCE EXEMPLAR (structure only — DO NOT COPY CONTENT)

The following is a polished resume from an unrelated industry. Pattern-match its structure, bullet rhythm, verb choice, and quantification depth. Every concrete claim in YOUR output still must come from the KB above.

\`\`\`markdown
${exemplar}
\`\`\``;

  // Dynamic suffix — changes per call (revision block + final instruction).
  const dynamicUser = `${revisionBlock ? `\n${revisionBlock}\n` : ""}
---

Produce the resume per the schema. Variant: ${opts.variant}.${opts.revision ? " This is a REVISION pass — apply the feedback above to the prior draft." : ""}`;

  const result = await callObject<ResumeOutput>({
    role: "writer_resume",
    agentName: opts.revision
      ? `writer_resume_${opts.variant}_revise_iter${opts.revision.iteration}`
      : `writer_resume_${opts.variant}`,
    applicationId: opts.applicationId,
    applicationVersionId: opts.applicationVersionId,
    cachedPrompt: {
      system: SYSTEM_PROMPT_BASE,
      cachedUser,
      dynamicUser,
    },
    schema: ResumeOutputSchema,
    maxOutputTokens: opts.variant === "long" ? 8000 : 5000,
    timeoutMs: resumeWriterTimeoutMs(opts.variant),
  });

  const output = {
    ...result.object,
    markdown: normalizeGeneratedResumeMarkdown(result.object.markdown),
    citedFactIds: mergeCitedFactIds(
      [
        ...pinnedFacts.map((fact) => fact.id),
        ...careerTimeline.flatMap((role) => role.factIds),
      ],
      result.object.citedFactIds,
      80,
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

export function normalizeGeneratedResumeMarkdown(markdown: string): string {
  const normalized = markdown
    .replace(
      /\bB\.?\s*S\.?\s+in\s+Computer\s+Science,\s+Malone\s+University(?:\s*[,·-]\s*\d{4})?/gi,
      "B.A. in Computer Information Systems, Kent State University, 2008",
    )
    .replace(
      /\bBachelor\s+of\s+Science\s+in\s+Computer\s+Science\s+from\s+Malone\s+University(?:\s*[,·-]\s*\d{4})?/gi,
      "B.A. in Computer Information Systems, Kent State University, 2008",
    )
    .replace(
      /\bB\.?\s*A\.?\s+in\s+Computer\s+Information\s+Systems,\s+Kent\s+State\s+University(?:\s*[,·-]\s*)?2007\b/gi,
      "B.A. in Computer Information Systems, Kent State University, 2008",
    )
    .replace(
      /\bB\.?\s*A\.?,?\s+(?:in\s+)?Computer\s+Information\s+Systems?(?:\s*\([^)]*\))?\*{0,2}\s*(?:,|\s*[\u2013\u2014-])\s*Kent\s+State\s+University\*{0,2}\s*(?:[,·\u2013\u2014-]|\()\s*2007\b/gi,
      "B.A. in Computer Information Systems, Kent State University, 2008",
    )
    .replace(/\bWebFocus\b/g, "WebFOCUS")
    .replace(
      /\btracking and assessing standard metrics for IT and OT software\/hardware development across teams\b/gi,
      "tracking and assessing standard IT delivery metrics across teams",
    )
    .replace(
      /\bIT and Operational Technology \(OT\) software\/hardware solution tracking and metrics assessment\b/gi,
      "IT delivery solution tracking and metrics assessment",
    )
    .replace(
      /\bIT and OT software\/hardware development\b/gi,
      "IT software delivery",
    )
    .replace(
      /\b12-person HQ team including 2 team leads and four Agile teams\b/gi,
      "12-person HQ team (2 team leads + 10 staff across four Agile teams)",
    )
    .replace(
      /\b12-person HQ team including two team leads and four Agile teams\b/gi,
      "12-person HQ team (2 team leads + 10 staff across four Agile teams)",
    )
    .replace(/\bCOTR-style oversight\b/gi, "federal delivery oversight")
    .replace(
      /\bPublic Trust Clearance\s*[-\u2013\u2014]\s*High Risk Tier\s*\(held\s+2008[\u2013-]2025\s+during SSA tenure;\s*reinstatement-eligible\)/gi,
      "Public Trust Clearance - High Risk Tier (previously held 2008-2025; reinstatement-eligible)",
    )
    .replace(
      /\bPublic Trust Clearance\s*[-\u2013\u2014]\s*High Risk Tier\s*\(held\s+2008[\u2013-]2025,\s*reinstatement-eligible\)/gi,
      "Public Trust Clearance - High Risk Tier (previously held 2008-2025; reinstatement-eligible)",
    )
    .replace(
      /\bPublic Trust Clearance\s*[-\u2013\u2014]\s*High Risk Tier\s*\(held\s+2008[\u2013-]2025;\s*reinstatement-eligible\)/gi,
      "Public Trust Clearance - High Risk Tier (previously held 2008-2025; reinstatement-eligible)",
    );
  return ensureMandatoryResumeContent(normalized);
}

function mergeCitedFactIds(
  priorityIds: string[],
  modelIds: string[],
  max: number,
): string[] {
  return Array.from(new Set([...priorityIds, ...modelIds])).slice(0, max);
}

function buildResumeRevisionBlock(rev: WriteResumeOptions["revision"]): string {
  if (!rev) return "";
  const grouped = {
    high: rev.feedback.filter((f) => f.priority === "high" && f.doc !== "cover_letter"),
    medium: rev.feedback.filter((f) => f.priority === "medium" && f.doc !== "cover_letter"),
    low: rev.feedback.filter((f) => f.priority === "low" && f.doc !== "cover_letter"),
  };
  const fmt = (items: ConsolidatedFeedbackItem[]) =>
    items
      .map((f) => `  - ${f.location ? `[${f.location}] ` : ""}${f.issue} → ${f.suggestion}`)
      .join("\n") || "  (none)";

  return `# REVISION PASS — iteration ${rev.iteration}

This is a revision of a prior draft. Apply the feedback below. HIGH priority items are mandatory; MEDIUM should be applied unless they conflict with grounding; LOW are polish.

## Prior resume draft

${rev.priorMarkdown}

## Consolidated feedback (resume-relevant only)

HIGH priority (must address):
${fmt(grouped.high)}

MEDIUM priority (should address):
${fmt(grouped.medium)}

LOW priority (polish if time):
${fmt(grouped.low)}

Important: keep the parts of the prior draft that already work. Don't rewrite from scratch unless the feedback explicitly requires it.`;
}

function buildResumeResearchBlock(
  research: MarketResearch | null,
  userEdits: string | null,
): string {
  if (!research) {
    return "(no company research available; rely on the JD analysis and KB facts)";
  }
  const findings = research.findings as
    | {
        overview?: string;
        mission?: string | null;
        values?: string[] | null;
        culture?: string | null;
        recentNews?: Array<{
          title: string;
          summary?: string | null;
          date?: string | null;
        }> | null;
        productsServices?: string[] | null;
      }
    | null;
  const tone = research.toneProfile;
  const out: string[] = [];
  if (findings?.overview) out.push(`Overview: ${clipForPrompt(findings.overview, 260)}`);
  if (findings?.mission) out.push(`Mission: ${clipForPrompt(findings.mission, 180)}`);
  if (findings?.productsServices && findings.productsServices.length > 0) {
    out.push(
      `Products/services: ${findings.productsServices
        .slice(0, 4)
        .map((item) => clipForPrompt(item, 70))
        .join(", ")}`,
    );
  }
  if (findings?.values && findings.values.length > 0) {
    out.push(
      `Values/themes: ${findings.values
        .slice(0, 4)
        .map((item) => clipForPrompt(item, 70))
        .join(", ")}`,
    );
  }
  if (findings?.culture) out.push(`Culture signal: ${clipForPrompt(findings.culture, 220)}`);
  if (findings?.recentNews && findings.recentNews.length > 0) {
    out.push("Recent public signals:");
    for (const item of findings.recentNews.slice(0, 2)) {
      out.push(
        `  - ${clipForPrompt(item.title, 110)}${item.date ? ` (${item.date})` : ""}${
          item.summary ? `: ${clipForPrompt(item.summary, 120)}` : ""
        }`,
      );
    }
  }
  if (tone) {
    out.push("");
    out.push(
      `Tone weighting: formality ${tone.formality.toFixed(2)}, technical density ${tone.technicalDensity.toFixed(2)}, mission emphasis ${tone.missionEmphasis}, energy ${tone.energyLevel}.`,
    );
    if (tone.notes) out.push(`Tone notes: ${clipForPrompt(tone.notes, 220)}`);
  }
  if (userEdits) {
    out.push("");
    out.push(`User-approved research notes: ${clipForPrompt(userEdits, 400)}`);
  }
  out.push("");
  out.push(
    "Use this only to choose emphasis and vocabulary. Do not cite it in citedFactIds and do not convert company facts into candidate claims.",
  );
  return out.join("\n");
}

function resumeWriterTimeoutMs(variant: WriteResumeOptions["variant"]): number {
  const explicit =
    process.env.RESUME_WRITER_PROVIDER_CALL_TIMEOUT_MS ??
    process.env.WRITER_PROVIDER_CALL_TIMEOUT_MS;
  if (explicit) return providerCallTimeoutMs(explicit);

  const globalTimeout = providerCallTimeoutMs();
  const writerFloor = variant === "long" ? 240_000 : 180_000;
  return Math.max(globalTimeout, writerFloor);
}

function clipForPrompt(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1).trimEnd()}.`;
}

/**
 * Render the knockout-questions block for the resume writer's cached
 * prefix. Lists each hard JD requirement with its KB coverage status so
 * the writer knows which items to surface verbatim, which to bridge, and
 * which to omit (no fabrication).
 *
 * Returns empty string when no report is provided (no block emitted).
 */
function renderKnockoutBlockForResume(
  report: KnockoutReport | null,
): string {
  if (!report || report.knockouts.length === 0) return "";
  const lines: string[] = [];
  lines.push(
    `# KNOCKOUT QUESTIONS — every item below MUST be answered explicitly somewhere in the resume`,
  );
  lines.push("");
  lines.push(
    `These are filter-level hard requirements from the JD. Many ATS systems drop applications that don't explicitly answer them — keyword score doesn't matter if a knockout is silent.`,
  );
  lines.push("");
  lines.push(`How to handle each based on KB coverage:`);
  lines.push(
    `- **verified**: KB clearly grounds it. Surface explicitly near the top — Summary, Skills line, or a dedicated "Clearances & Eligibility" block. Make it easy for an ATS to find.`,
  );
  lines.push(
    `- **partial**: KB grounds it weakly or the year claim isn't tied to the JD's domain. Bridge by rewording an existing bullet to use the JD's literal phrasing, anchored to the closest KB-supported fact.`,
  );
  lines.push(
    `- **missing** or **none**: KB does NOT support it. DO NOT FABRICATE. Omit the claim entirely; the user will be flagged separately about the gap.`,
  );
  lines.push(
    `- **blocking**: A prior draft contradicted the requirement. Resolve the contradiction.`,
  );
  lines.push("");
  lines.push(`Items detected from this JD:`);
  lines.push("");
  for (let i = 0; i < report.knockouts.length; i++) {
    const k = report.knockouts[i];
    const verdict = k.coverage.verdict;
    const source = k.coverage.source ?? "resume";
    lines.push(`${i + 1}. **[${k.category}]** ${k.requirement}`);
    lines.push(
      `   JD evidence: "${k.jdEvidenceQuote.slice(0, 200).replace(/\n/g, " ")}"`,
    );
    lines.push(
      `   Coverage status: **${verdict}** (scored against ${source === "kb" ? "the candidate's KB — no resume draft yet, you are producing the first one that needs to land it" : source === "resume" ? "the prior resume draft" : "no source"})`,
    );
    if (k.coverage.notes) {
      lines.push(`   Note: ${k.coverage.notes}`);
    }
    if (k.scalarMinimum != null) {
      lines.push(
        `   Scalar floor: ${k.scalarMinimum}+ ${k.scalarUnit ?? "years"}`,
      );
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

function buildDirectiveBlock(d: WriterDirectives): string {
  const lines: string[] = [];
  // Contact block — these are MANDATORY on the resume header. The writer
  // must include each of these verbatim, separated by " · ", on the
  // contact line directly under the candidate name.
  if (d.contact) {
    const parts: string[] = [];
    if (d.contact.location) parts.push(`Location: "${d.contact.location}"`);
    if (d.contact.email) parts.push(`Email: "${d.contact.email}"`);
    if (d.contact.phone) parts.push(`Phone: "${d.contact.phone}"`);
    if (parts.length > 0) {
      lines.push(
        `RESUME CONTACT LINE — MANDATORY. Include EACH of these verbatim on the contact line immediately under the candidate's name, separated by " · ":`,
      );
      for (const p of parts) lines.push(`  - ${p}`);
      lines.push(
        `  - Also include the personal site (see below) on the same contact line.`,
      );
    }
  }
  if (d.personalSite) {
    lines.push(`Personal site: ${d.personalSite.url} (display as: ${d.personalSite.label}).`);
    lines.push(`Placement rule: ${d.personalSite.placement.resume}`);
  }
  lines.push(`Voice — tense: ${d.voice.tense}; pronoun: ${d.voice.pronoun}; metrics bias: ${d.voice.metricsBias}.`);
  lines.push("Global rules:");
  for (const r of d.globalRules) lines.push(`  - ${r}`);
  return lines.join("\n");
}

/** Renders retrieved facts including their ids — writers need ids to cite. */
export function renderFactsForPromptWithIds(
  groups: Awaited<ReturnType<typeof retrieveGroupedFacts>>["groups"],
): string {
  const out: string[] = [];
  for (const g of groups) {
    out.push(`### ${g.factType} (${g.facts.length})`);
    for (const f of g.facts) {
      const meta = (f.metadata ?? {}) as {
        company?: string;
        role?: string;
        startDate?: string;
        endDate?: string;
      };
      const ctx =
        meta.company || meta.role
          ? ` (${[meta.company, meta.role].filter(Boolean).join(" · ")}${
              meta.startDate || meta.endDate
                ? ` [${meta.startDate ?? "?"}–${meta.endDate ?? "?"}]`
                : ""
            })`
          : " (UNATTRIBUTED -- DO NOT PLACE UNDER A SPECIFIC EMPLOYER unless you can match it via context)";
      out.push(`- [${f.id}]${ctx} ${f.content}`);
    }
    out.push("");
  }
  return out.join("\n");
}

export function renderPinnedFactsBlock(facts: RetrievedFact[]): string {
  if (facts.length === 0) return "";
  const lines = ["# CRITICAL ATTRIBUTION RULES -- apply to every bullet and every paragraph", ""];
  for (const f of facts) {
    const meta = (f.metadata ?? {}) as { company?: string; role?: string };
    const ctx = [meta.company, meta.role].filter(Boolean).join(" · ");
    lines.push(`- [${f.id}] ${f.content}${ctx ? ` (${ctx})` : ""}`);
  }
  return lines.join("\n");
}

function capRetrievalGroups(
  groups: Awaited<ReturnType<typeof retrieveGroupedFacts>>["groups"],
  maxFacts: number,
) {
  let total = groups.reduce((sum, group) => sum + group.facts.length, 0);
  while (total > maxFacts) {
    const largest = groups
      .filter((group) => group.facts.length > 0)
      .sort((a, b) => b.facts.length - a.facts.length)[0];
    if (!largest) return;
    let lowestIndex = 0;
    for (let i = 1; i < largest.facts.length; i++) {
      if (largest.facts[i].similarity < largest.facts[lowestIndex].similarity) {
        lowestIndex = i;
      }
    }
    largest.facts.splice(lowestIndex, 1);
    total--;
  }
}
