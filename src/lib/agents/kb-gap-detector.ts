/**
 * KB gap detection. After JD analysis runs, scan the KB to see how well each
 * must-have / nice-to-have skill is covered before writing kicks off.
 *
 * Pipeline:
 *   1. Haiku expands each skill into 2-3 phrasing variants. A JD phrase
 *      like "federal civilian agency experience" expands to include things
 *      like "SSA", "federal IT delivery", "civilian agency", etc. — phrasings
 *      the KB might actually use.
 *   2. The skill and its variants are embedded in a single batch call.
 *   3. For each fact, we take the MAX similarity across the skill and its
 *      variants. This handles the cross-phrasing gap where the embedding
 *      similarity between the raw JD phrase and the candidate's actual KB
 *      facts is just below the threshold.
 *
 * Cost: ~$0.001 per app (one Haiku call + embedMany + N vector lookups).
 * Latency: ~1-2s typical.
 */

import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { kbFacts } from "@/db/schema";
import { embedTexts } from "@/lib/models/embed";
import { callObject } from "@/lib/models/call";

export type CoverageVerdict = "well_covered" | "thin" | "missing";

export type SkillCoverage = {
  skill: string;
  strongMatches: number;
  topFactIds: string[];
  topFactSnippets: string[];
  bestSimilarity: number;
  verdict: CoverageVerdict;
};

export type KbGapReport = {
  mustHave: SkillCoverage[];
  niceToHave: SkillCoverage[];
  missingMustHaveCount: number;
  thinMustHaveCount: number;
  wellCoveredMustHaveCount: number;
  embedCostUsd: number;
};

/** Cosine-similarity bar above which a fact is "relevant to" a skill. */
const SIMILARITY_THRESHOLD = 0.5;
/** Strong-match count required to call a skill well-covered. */
const WELL_COVERED_MIN_COUNT = 3;
/** How many top facts to keep per skill for the UI preview. */
const TOP_FACTS_PREVIEW = 3;
/** Max snippet length for a fact preview. */
const SNIPPET_MAX_CHARS = 100;
/** Max variants generated per skill by query expansion. */
const MAX_VARIANTS_PER_SKILL = 3;

function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export async function detectKbGaps(opts: {
  mustHaveSkills: string[];
  niceToHaveSkills: string[];
  /** Optional context to guide query expansion (improves variant quality). */
  context?: { roleTitle?: string; companyName?: string };
  applicationId?: string;
}): Promise<KbGapReport> {
  const allSkills = [...opts.mustHaveSkills, ...opts.niceToHaveSkills];
  if (allSkills.length === 0) {
    return emptyReport(0);
  }

  // Step 1: expand each skill into a small set of alternate phrasings.
  const expansion = await expandSkillsForSearch({
    skills: allSkills,
    context: opts.context,
    applicationId: opts.applicationId,
  });

  // Step 2: embed each skill + its variants in one batched call. Track which
  // embedding belongs to which skill via index ranges.
  // Compound skills like "Jira and Confluence proficiency" or "SQL/Python"
  // get their proper-noun components added as deterministic extra variants —
  // the combined-phrase embedding dilutes match against single-tool KB facts,
  // so we also probe each component separately and take the max.
  const phrasesPerSkill: string[][] = allSkills.map((s) =>
    buildSkillSearchPhrases(s, expansion.variantsBySkill[s] ?? []),
  );
  const flat = phrasesPerSkill.flat();
  const offsets: number[] = [];
  {
    let cursor = 0;
    for (const phrases of phrasesPerSkill) {
      offsets.push(cursor);
      cursor += phrases.length;
    }
  }
  const { embeddings, costUsd: embedCostUsd } = await embedTexts(flat);

  // Step 3: per skill, score against the KB using MAX similarity across all
  // its variant embeddings.
  const coverages = await Promise.all(
    allSkills.map((skill, idx) => {
      const start = offsets[idx];
      const end = idx + 1 < offsets.length ? offsets[idx + 1] : flat.length;
      const skillEmbeddings = embeddings.slice(start, end);
      return scoreSkillCoverage(skill, skillEmbeddings);
    }),
  );

  const mustHave = coverages.slice(0, opts.mustHaveSkills.length);
  const niceToHave = coverages.slice(opts.mustHaveSkills.length);

  return {
    mustHave,
    niceToHave,
    missingMustHaveCount: mustHave.filter((c) => c.verdict === "missing").length,
    thinMustHaveCount: mustHave.filter((c) => c.verdict === "thin").length,
    wellCoveredMustHaveCount: mustHave.filter((c) => c.verdict === "well_covered").length,
    embedCostUsd: embedCostUsd + expansion.costUsd,
  };
}

/**
 * For a single skill, run a vector query for each (skill + variant)
 * embedding and merge results, taking the MAX similarity per fact. Counts
 * the merged strong-match facts.
 */
async function scoreSkillCoverage(
  skill: string,
  embeddings: number[][],
): Promise<SkillCoverage> {
  // Pull top-N per embedding, then merge by fact id using max similarity.
  const perEmbedding = await Promise.all(
    embeddings.map(async (emb) => {
      const vec = vectorLiteral(emb);
      const rows = await db()
        .select({
          id: kbFacts.id,
          content: kbFacts.content,
          similarity: sql<number>`1 - (${kbFacts.embedding} <=> ${vec}::vector)`,
        })
        .from(kbFacts)
        .orderBy(sql`${kbFacts.embedding} <=> ${vec}::vector`)
        .limit(8);
      return rows;
    }),
  );

  const merged = new Map<string, { content: string; similarity: number }>();
  for (const rows of perEmbedding) {
    for (const r of rows) {
      const existing = merged.get(r.id);
      if (!existing || r.similarity > existing.similarity) {
        merged.set(r.id, { content: r.content, similarity: r.similarity });
      }
    }
  }
  const ranked = [...merged.entries()]
    .map(([id, v]) => ({ id, content: v.content, similarity: v.similarity }))
    .sort((a, b) => b.similarity - a.similarity);

  const strong = ranked.filter((r) => r.similarity >= SIMILARITY_THRESHOLD);
  const verdict: CoverageVerdict =
    strong.length >= WELL_COVERED_MIN_COUNT
      ? "well_covered"
      : strong.length >= 1
        ? "thin"
        : "missing";

  const topForPreview = strong.slice(0, TOP_FACTS_PREVIEW);

  return {
    skill,
    strongMatches: strong.length,
    topFactIds: topForPreview.map((r) => r.id),
    topFactSnippets: topForPreview.map((r) =>
      r.content.length > SNIPPET_MAX_CHARS
        ? `${r.content.slice(0, SNIPPET_MAX_CHARS - 1)}…`
        : r.content,
    ),
    bestSimilarity: ranked[0]?.similarity ?? 0,
    verdict,
  };
}

// ---------------------------------------------------------------------------
// Query expansion via Haiku
// ---------------------------------------------------------------------------

const ExpansionSchema = z.object({
  expansions: z
    .array(
      z.object({
        skill: z.string().describe("The original skill phrase from the JD."),
        variants: z
          .array(z.string())
          .max(MAX_VARIANTS_PER_SKILL)
          .describe(
            "2-3 alternate phrasings that the candidate's KB might use for this skill. Include common synonyms, technical abbreviations (e.g. 'P&L' ↔ 'profit and loss'), employer-domain reframings (e.g. 'federal civilian agency' ↔ 'federal IT delivery'), and adjacent activity phrasings. Do not include the original skill phrase verbatim. Do not invent candidate-specific names — return generic phrasings only.",
          ),
      }),
    )
    .describe("One entry per input skill, in the same order."),
});

type SkillExpansion = {
  variantsBySkill: Record<string, string[]>;
  costUsd: number;
};

async function expandSkillsForSearch(opts: {
  skills: string[];
  context?: { roleTitle?: string; companyName?: string };
  applicationId?: string;
}): Promise<SkillExpansion> {
  if (opts.skills.length === 0) {
    return { variantsBySkill: {}, costUsd: 0 };
  }

  const contextLine = opts.context?.roleTitle
    ? `\nRole context: ${opts.context.roleTitle}${opts.context.companyName ? ` at ${opts.context.companyName}` : ""}.`
    : "";

  const system = `You are a query-expansion assistant for a resume-grounding system.

For each JD-derived skill phrase, generate 2-3 alternate phrasings a candidate's knowledge base might use to describe the same concept. The goal is to bridge the vocabulary gap between how a JD phrases requirements and how the candidate's prior documents phrase their experience.

Rules:
- Each variant is 2-6 words. Plain noun phrases or activity phrases.
- Include common synonyms ("P&L ownership" → "profit and loss responsibility").
- Include domain-level reframings ("federal civilian agency experience" → "federal IT delivery", "civilian agency work").
- For ABSTRACT / SOFT-SKILL phrases (communication, leadership, collaboration, stakeholder management, problem solving, etc.), do NOT just rephrase the abstract noun — generate CONCRETE ACTIVITY variants describing what DOING the skill looks like in a real resume. Candidate KBs phrase soft skills as concrete actions and specific audiences, not abstract noun phrases. Examples:
  - "executive communication" → ["presenting to C-suite", "briefing CEOs and VPs", "executive narrative translation", "memos to senior leadership"]
  - "stakeholder management" → ["managing VP-level stakeholders", "cross-functional stakeholder alignment", "stakeholder communication and trade-off negotiation"]
  - "team leadership" → ["directly managing engineers", "leading cross-functional teams", "supervising direct reports"]
  - "executive presence" → ["board-level presentations", "C-suite credibility", "senior leadership trust"]
  - "conflict resolution" → ["resolving disagreements with senior leadership", "navigating cross-team conflict", "mediating between competing priorities"]
- Include acronyms ↔ expansions in BOTH directions — a JD phrase in acronym form should get spelled-out variants, AND a JD phrase in spelled-out form should get acronym + abbreviation variants:
  - "FedRAMP" → ["Federal Risk and Authorization Management Program"]
  - "Master of Business Administration" → ["MBA", "M.B.A."]
  - "Project Management Professional" → ["PMP", "PMP certification"]
- For named TOOLS / PRODUCTS, include a VENDOR-PREFIXED variant — candidate KB facts often co-occur the tool name with its vendor or product family, which lifts embedding similarity. Examples:
  - "Jira" → ["Atlassian Jira", "Jira ticket tracking"]
  - "Confluence" → ["Atlassian Confluence", "Confluence wiki"]
  - "Tableau" → ["Tableau dashboards", "Tableau visualization"]
  - "Snowflake" → ["Snowflake warehouse", "Snowflake data platform"]
  - "BigQuery" → ["Google BigQuery"]
  - "Power BI" → ["Microsoft Power BI"]
  - "Slack" → ["Slack workspace", "Slack channels"]
- For GENERIC credential / degree phrases that are field-agnostic in the JD ("bachelor's degree", "master's degree", "doctorate", "engineering degree", "MBA or equivalent"), ALSO generate FIELD-QUALIFIED variants. Candidate resumes phrase these in the specific form ("B.A. in Computer Information Systems", "Bachelor of Science in Engineering"); a pure-acronym variant alone is too sparse for the embedding to match. Use the role context (provided below) to guess the likely field. Cover both the credential token and at least one field-qualified phrasing. Examples:
  - JD says "bachelor's degree" for a software role → ["B.S. in Computer Science", "Bachelor of Science", "B.A. in Computer Information Systems"]
  - JD says "bachelor's degree" for a finance role → ["B.S. in Finance", "Bachelor of Science", "B.A. in Economics"]
  - JD says "master's degree" for a business role → ["MBA", "Master of Business Administration", "M.S. in Management"]
- Do NOT invent candidate-specific employer names or proper nouns.
- Do NOT repeat the original phrase as a variant.
- Return an entry for EVERY input skill, in the same order, even if you only have 1 good variant.`;

  const userPrompt = `Generate alternate phrasings for these JD skills:${contextLine}

${opts.skills.map((s, i) => `${i + 1}. ${s}`).join("\n")}`;

  try {
    const result = await callObject<z.infer<typeof ExpansionSchema>>({
      role: "verifier", // re-use Haiku route (verifier is the project's Haiku role)
      agentName: "kb_gap_query_expander",
      applicationId: opts.applicationId,
      system,
      prompt: userPrompt,
      schema: ExpansionSchema,
      maxOutputTokens: 2000,
    });

    const variantsBySkill: Record<string, string[]> = {};
    for (const e of result.object.expansions) {
      variantsBySkill[e.skill] = e.variants.filter(
        (v) => v && v.toLowerCase() !== e.skill.toLowerCase(),
      );
    }
    // Defensive: if any skill is missing from the response (model dropped it),
    // ensure the map has an empty array so the caller doesn't crash.
    for (const s of opts.skills) {
      if (!variantsBySkill[s]) variantsBySkill[s] = [];
    }
    return { variantsBySkill, costUsd: result.costUsd };
  } catch (err) {
    // If expansion fails for any reason, fall back to no variants — we
    // still get useful results from the raw skill embeddings.
    console.warn(
      "[kb-gap-detector] query expansion failed, falling back to raw skills:",
      err instanceof Error ? err.message : String(err),
    );
    return {
      variantsBySkill: Object.fromEntries(opts.skills.map((s) => [s, []])),
      costUsd: 0,
    };
  }
}

function emptyReport(embedCostUsd: number): KbGapReport {
  return {
    mustHave: [],
    niceToHave: [],
    missingMustHaveCount: 0,
    thinMustHaveCount: 0,
    wellCoveredMustHaveCount: 0,
    embedCostUsd,
  };
}

export function buildSkillSearchPhrases(
  skill: string,
  modelVariants: string[] = [],
): string[] {
  const trimmed = skill.trim();
  if (trimmed.length === 0) return [];

  const modelCapped = modelVariants.slice(0, MAX_VARIANTS_PER_SKILL);
  const variants = [
    ...modelCapped,
    ...credentialVariantsForSkill(trimmed),
    ...splitCompoundSkill(trimmed),
  ];

  const seen = new Set([trimmed.toLowerCase()]);
  const unique: string[] = [];
  for (const variant of variants) {
    const normalized = variant.trim();
    const key = normalized.toLowerCase();
    if (normalized && !seen.has(key)) {
      seen.add(key);
      unique.push(normalized);
    }
  }

  return [trimmed, ...unique];
}

function credentialVariantsForSkill(skill: string): string[] {
  const normalized = skill.toLowerCase();
  const variants: string[] = [];

  if (/\bbachelor'?s?\b|\bbaccalaureate\b/.test(normalized)) {
    variants.push(
      "Bachelor of Science",
      "Bachelor of Arts",
      "B.S. degree",
      "B.A. degree",
    );
  }

  if (/\bmaster'?s?\b/.test(normalized)) {
    variants.push(
      "Master of Science",
      "Master of Arts",
      "M.S. degree",
      "M.A. degree",
    );
  }

  if (/\bm\.?b\.?a\.?\b|master of business administration/.test(normalized)) {
    variants.push("MBA", "M.B.A.", "Master of Business Administration");
  }

  return variants;
}

/**
 * Detect compound multi-tool skills (e.g. "Jira and Confluence proficiency",
 * "Tableau / Power BI", "SQL & Python") and split into per-component query
 * variants. The combined embedding gets diluted across both tools plus the
 * "proficiency" filler, so the original phrase alone often lands BELOW
 * threshold against a single-tool KB fact. Probing each component separately
 * fixes that.
 *
 * Heuristic — only split when both sides of the connective look like proper
 * nouns (capitalized words / acronyms). Avoids splitting natural-language
 * phrases that happen to contain "and" ("research and development",
 * "monitoring and evaluation").
 *
 * Returns 0-3 component variants; empty if the skill doesn't look compound.
 */
export function splitCompoundSkill(skill: string): string[] {
  const trimmed = skill.trim();
  if (trimmed.length === 0) return [];

  // Try each connective in order of specificity. Stop at the first that
  // produces a clean proper-noun split.
  const splitters: Array<{ regex: RegExp }> = [
    { regex: /\s+and\s+/i },
    { regex: /\s+&\s+/ },
    { regex: /\s+or\s+/i },
    { regex: /\s*\/\s*/ },
    { regex: /\s*,\s*/ },
  ];
  for (const { regex } of splitters) {
    if (!regex.test(trimmed)) continue;
    const parts = trimmed.split(regex).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    // Require EVERY part to start with an uppercase letter, OR be a 1-4 char
    // acronym. This keeps "Jira and Confluence proficiency" → split, but
    // skips "stakeholder management and trade-off negotiation" → no split.
    const allProper = parts.every((p) => looksLikeProperNoun(p));
    if (!allProper) continue;
    return parts.flatMap((p) => componentVariants(p, trimmed));
  }
  return [];
}

const PROPER_RE = /^[A-Z][A-Za-z0-9.+\-]*(?:\s+[A-Za-z0-9.+\-]+){0,3}$/;
const ACRONYM_RE = /^[A-Z][A-Z0-9.+/\-]{0,5}$/;

function looksLikeProperNoun(part: string): boolean {
  // Strip a trailing qualifier like "proficiency" / "experience" / "knowledge"
  // so "Jira proficiency" doesn't fail the test on the lowercase tail.
  const trailing =
    /^(.*?)\s+(?:proficiency|experience|expertise|knowledge|skills?|certification|familiarity)$/i;
  const m = part.match(trailing);
  const head = m ? m[1] : part;
  return PROPER_RE.test(head) || ACRONYM_RE.test(head);
}

function componentVariants(component: string, originalSkill: string): string[] {
  const variants: string[] = [];
  variants.push(component);
  // Inherit the original's qualifier if present, e.g. "Jira" + "proficiency"
  // → "Jira proficiency". Otherwise, the bare token alone is fine for
  // embedding match against a tool-named KB fact.
  const qualifierMatch = originalSkill.match(
    /\b(proficiency|experience|expertise|knowledge|skills?|certification|familiarity)$/i,
  );
  if (qualifierMatch && !component.toLowerCase().endsWith(qualifierMatch[1].toLowerCase())) {
    variants.push(`${component} ${qualifierMatch[1]}`);
  }
  return variants;
}
