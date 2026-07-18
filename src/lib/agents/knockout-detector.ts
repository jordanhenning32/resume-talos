import { z } from "zod";
import { callObject } from "@/lib/models/call";
import type { JdAnalysis } from "./jd-analyzer";

export type KnockoutCategory =
  | "citizenship"
  | "clearance"
  | "experience_years"
  | "degree"
  | "certification"
  | "work_authorization"
  | "other";

export type KnockoutCoverageVerdict =
  | "verified"
  | "partial"
  | "missing"
  | "blocking"
  | "cannot_determine";

export type Knockout = {
  id: string;
  category: KnockoutCategory;
  requirement: string;
  jdEvidenceQuote: string;
  scalarMinimum: number | null;
  scalarUnit: "years" | "months" | null;
  coverage: {
    verdict: KnockoutCoverageVerdict;
    resumeSnippet: string | null;
    notes: string | null;
    /**
     * Where the evidence came from. "resume" when we matched the latest
     * draft. "kb" when no resume exists yet and we fell back to the
     * candidate's KB facts as proxy evidence (the writer will need to
     * surface this in the resume). "none" when neither source contained
     * matching evidence.
     */
    source: "resume" | "kb" | "none";
  };
};

export type KnockoutReport = {
  knockouts: Knockout[];
  missingCount: number;
  partialCount: number;
  verifiedCount: number;
  blockingCount: number;
  cannotDetermineCount: number;
  resumeVersionId: string | null;
  costUsd: number;
};

const DetectedKnockoutSchema = z.object({
  category: z.enum([
    "citizenship",
    "clearance",
    "experience_years",
    "degree",
    "certification",
    "work_authorization",
    "other",
  ]),
  requirement: z
    .string()
    .describe(
      "Canonical, terse phrasing of the requirement, e.g. 'U.S. citizenship', 'Active Public Trust clearance', 'Bachelor's degree in IT-related field', '5+ years federal IT experience', 'PMP certification', 'Authorized to work in the U.S. without sponsorship'.",
    ),
  jdEvidenceQuote: z
    .string()
    .describe(
      "Verbatim short snippet from the JD that establishes this knockout. Keep under 200 chars. Quote exact wording so a reviewer can re-verify.",
    ),
  scalarMinimum: z
    .number()
    .nullish()
    .describe(
      "If category is experience_years and a numeric minimum is given (e.g. '5+ years'), report 5. Null otherwise.",
    ),
  scalarUnit: z
    .enum(["years", "months"])
    .nullish()
    .describe("Unit for scalarMinimum. Null if not applicable."),
});

const DetectionSchema = z.object({
  knockouts: z
    .array(DetectedKnockoutSchema)
    .describe(
      "Every hard non-negotiable requirement in the JD. Be conservative: only include items where failure to meet them would disqualify the applicant outright, not skills the JD says are 'preferred', 'plus', or 'nice to have'. 2-8 entries is typical for a well-written JD; some JDs have 0.",
    ),
});

const SYSTEM_PROMPT = `You are the Knockout-Question Detector for Resume Talos.

Your job: read a job description and identify HARD knockout requirements. These are requirements where failure to meet (or failure to ANSWER explicitly on the resume) typically causes an ATS or recruiter to drop the application before deeper review.

WHAT COUNTS AS A KNOCKOUT:
- Citizenship/nationality requirements ("must be a U.S. citizen", "U.S. National")
- Clearance requirements ("active Secret clearance", "TS/SCI required at start")
- Specific numeric experience requirements ("must have 5+ years of X", "minimum 10 years federal")
- Specific degree requirements ("Bachelor's in CS or related", "MBA required")
- Specific named certifications that gate the role ("PMP required", "must hold CISSP at time of hire")
- Work authorization ("authorized to work without sponsorship")

WHAT DOES NOT COUNT:
- Soft skills ("strong communication", "team player")
- Preferred or nice-to-have items ("preferred", "plus", "ideally")
- Broad domain skills ("experience with cloud platforms") — those are competencies, handled elsewhere
- General "X+ years of related experience" boilerplate without a hard floor that gates the role grade

For each knockout, return:
- category (one of the enum values)
- canonical short requirement string
- verbatim JD evidence quote (short, exact wording from the JD)
- scalarMinimum + scalarUnit if it's a numeric experience floor

Be conservative. If unsure whether something is a hard knockout or just a preference, leave it out. False positives waste reviewer attention; the writer's KB grounding rules already cover competency claims.`;

export async function detectKnockoutsFromJd(opts: {
  jdText: string;
  jdAnalysis: JdAnalysis;
  applicationId?: string;
}): Promise<{ knockouts: Omit<Knockout, "coverage">[]; costUsd: number }> {
  const userPrompt = `Job description follows. Extract every HARD knockout requirement (binary or scalar). Return [] if the JD has none.

JD analysis already extracted these fields you can cross-reference (do not invent items not in the JD body):
- roleTitle: ${opts.jdAnalysis.roleTitle}
- seniorityLevel: ${opts.jdAnalysis.seniorityLevel}
- experienceYears: ${JSON.stringify(opts.jdAnalysis.experienceYears)}
- mustHaveSkills (NOT all are knockouts — most are competencies; only promote to knockout if the JD phrases them as hard floors): ${opts.jdAnalysis.mustHaveSkills.slice(0, 12).join("; ")}

Raw JD text:
---
${opts.jdText}
---`;

  const result = await callObject<z.infer<typeof DetectionSchema>>({
    role: "knockout_detector",
    agentName: "knockout_detector",
    applicationId: opts.applicationId,
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
    schema: DetectionSchema,
    maxOutputTokens: 4000,
  });

  const knockouts: Omit<Knockout, "coverage">[] = result.object.knockouts.map(
    (k) => ({
      id: stableId(k.category, k.requirement),
      category: k.category,
      requirement: k.requirement.trim(),
      jdEvidenceQuote: k.jdEvidenceQuote.trim(),
      scalarMinimum: k.scalarMinimum ?? null,
      scalarUnit: k.scalarUnit ?? null,
    }),
  );

  return { knockouts, costUsd: result.costUsd };
}

/** Coverage shape before annotateSource attaches the source tag. */
type RawCoverage = Omit<Knockout["coverage"], "source">;

export type CoverageSources = {
  /** Latest resume markdown — the authoritative source when a draft exists. */
  resumeMarkdown: string;
  /**
   * Concatenated content of relevant KB facts (education, certification,
   * role, context, achievement, skill, project, responsibility). Used as a
   * fallback when no resume exists yet — tells the candidate whether their
   * KB grounds the requirement, so the writer can surface it during draft
   * generation.
   */
  kbContext: string;
};

/**
 * Deterministic coverage check: given a list of detected knockouts and the
 * candidate's two evidence sources (resume + KB), return a verdict per
 * knockout. The resume is authoritative when it has content — it's what an
 * ATS actually sees. When the resume is empty (no drafts yet), we fall back
 * to the KB so the user knows which knockouts they CAN ground vs which need
 * KB additions.
 */
export function checkKnockoutCoverage(
  knockouts: Omit<Knockout, "coverage">[],
  sources: CoverageSources,
): Knockout[] {
  return knockouts.map((k) => ({
    ...k,
    coverage: coverForKnockout(k, sources),
  }));
}

function coverForKnockout(
  k: Omit<Knockout, "coverage">,
  sources: CoverageSources,
): Knockout["coverage"] {
  const resume = sources.resumeMarkdown || "";
  const kb = sources.kbContext || "";
  const resumeHasContent = resume.trim().length > 0;
  const kbHasContent = kb.trim().length > 0;

  if (!resumeHasContent && !kbHasContent) {
    return {
      verdict: "missing",
      resumeSnippet: null,
      notes: "No resume or KB content available — add KB facts first.",
      source: "none",
    };
  }

  // Resume wins when present — it's what an ATS reads.
  const text = resumeHasContent ? resume : kb;
  const source: "resume" | "kb" = resumeHasContent ? "resume" : "kb";

  const raw =
    k.category === "citizenship"
      ? matchCitizenship(text)
      : k.category === "clearance"
        ? matchClearance(k, text)
        : k.category === "experience_years"
          ? matchExperienceYears(k, text)
          : k.category === "degree"
            ? matchDegree(k, text)
            : k.category === "certification"
              ? matchCertification(k, text)
              : k.category === "work_authorization"
                ? matchWorkAuth(text)
                : matchOther(k, text);

  return annotateSource(raw, source);
}

/**
 * Wraps a raw match result with the `source` tag and adjusts the notes
 * so the user understands whether the evidence came from their resume or
 * from their KB (i.e. needs to land in the resume on next generation).
 */
function annotateSource(
  raw: RawCoverage,
  source: "resume" | "kb",
): Knockout["coverage"] {
  if (source === "resume") {
    return { ...raw, source };
  }
  // KB source — rewrite "Resume does not..." / "Resume claims..." style notes
  // so they reflect KB framing, and prepend a "needs to land in resume" cue
  // for non-missing verdicts.
  let notes = raw.notes ?? null;
  if (notes) {
    notes = notes
      .replace(/^Resume\s+/i, "KB ")
      .replace(/\bResume\s+/g, "KB ");
  }
  if (raw.verdict === "verified" || raw.verdict === "partial") {
    const prefix = `Found in your KB (no resume yet — the writer will surface this when generating drafts).`;
    notes = notes ? `${prefix} ${notes}` : prefix;
  } else if (raw.verdict === "missing") {
    notes = `Not yet in your KB — add facts about this before generating, or the writer won't have grounding.${notes ? ` ${notes}` : ""}`;
  }
  return { ...raw, source, notes };
}

const CITIZENSHIP_PATTERNS = [
  /\bU\.?\s*S\.?\s*citizen(?:ship)?\b/i,
  /\bUnited\s+States\s+citizen(?:ship)?\b/i,
  /\bU\.?\s*S\.?\s*national\b/i,
];

function matchCitizenship(text: string): RawCoverage {
  for (const re of CITIZENSHIP_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const snippet = snippetAround(text, m.index ?? 0);
      if (hasNearbyNegation(text, m.index ?? 0)) {
        return {
          verdict: "blocking",
          resumeSnippet: snippet,
          notes: "Resume explicitly negates U.S. citizenship.",
        };
      }
      return {
        verdict: "verified",
        resumeSnippet: snippet,
        notes: null,
      };
    }
  }
  return {
    verdict: "missing",
    resumeSnippet: null,
    notes: "Resume does not explicitly state U.S. citizenship.",
  };
}

const CLEARANCE_LEVELS = [
  { label: "TS/SCI", patterns: [/\bTS\s*\/\s*SCI\b/i, /\btop\s+secret\s*\/\s*SCI\b/i] },
  { label: "Top Secret", patterns: [/\btop\s+secret\b/i, /\bTS\b/] },
  { label: "Secret", patterns: [/\bsecret\s+clearance\b/i, /\bsecret\b(?!\s+sci)/i] },
  { label: "Public Trust", patterns: [/\bpublic\s+trust\b/i] },
];

function matchClearance(
  k: Omit<Knockout, "coverage">,
  text: string,
): RawCoverage {
  // Determine what level the JD requires from the requirement string
  const reqLower = k.requirement.toLowerCase();
  const requiredLevel =
    /(ts\s*\/\s*sci|top\s+secret\s*\/\s*sci)/i.test(reqLower) ? "TS/SCI" :
    /top\s+secret/i.test(reqLower) ? "Top Secret" :
    /\bsecret\b/i.test(reqLower) ? "Secret" :
    /public\s+trust/i.test(reqLower) ? "Public Trust" :
    null;

  // Scan resume for any clearance mention
  for (const level of CLEARANCE_LEVELS) {
    for (const re of level.patterns) {
      const m = text.match(re);
      if (m) {
        const snippet = snippetAround(text, m.index ?? 0);
        if (hasNearbyNegation(text, m.index ?? 0)) {
          return {
            verdict: "blocking",
            resumeSnippet: snippet,
            notes: `Resume explicitly negates ${level.label} clearance.`,
          };
        }
        if (!requiredLevel) {
          return {
            verdict: "verified",
            resumeSnippet: snippet,
            notes: `Resume mentions ${level.label}; JD requirement level unclear so accepting as verified.`,
          };
        }
        // Compare levels — higher level on resume satisfies lower level required
        const order = ["Public Trust", "Secret", "Top Secret", "TS/SCI"];
        const resumeRank = order.indexOf(level.label);
        const jdRank = order.indexOf(requiredLevel);
        if (resumeRank >= jdRank) {
          return {
            verdict: "verified",
            resumeSnippet: snippet,
            notes: resumeRank === jdRank
              ? null
              : `Resume holds ${level.label}; satisfies JD requirement of ${requiredLevel}.`,
          };
        }
        return {
          verdict: "partial",
          resumeSnippet: snippet,
          notes: `Resume mentions ${level.label} but JD requires ${requiredLevel}.`,
        };
      }
    }
  }
  return {
    verdict: "missing",
    resumeSnippet: null,
    notes: requiredLevel
      ? `Resume does not mention any clearance; JD requires ${requiredLevel}.`
      : "Resume does not mention any clearance.",
  };
}

function matchExperienceYears(
  k: Omit<Knockout, "coverage">,
  text: string,
): RawCoverage {
  const min = k.scalarMinimum;
  if (min == null) {
    return {
      verdict: "cannot_determine",
      resumeSnippet: null,
      notes: "No scalar minimum extracted from JD; manual review.",
    };
  }
  // Domain keywords come from the requirement string with the "X+ years"
  // token stripped — e.g. "5+ years P&L responsibility at $50M+ scale" →
  // domain keywords are ["responsibility", "scale"]. We use these to check
  // whether a numeric-year claim in the resume is in the SAME context as
  // what the JD is asking about, not just any 17+ years anywhere.
  const domainKeywords = k.requirement
    .replace(/\d+\+?\s*(?:years?|months?)/gi, "")
    .replace(/\$[\d.]+[KMB]?\+?/g, "")
    .toLowerCase()
    .split(/[\s,;:./()$+]+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));

  const yearRegex = /(\d{1,2})\s*\+?\s*years?/gi;
  const matches = Array.from(text.matchAll(yearRegex));
  if (matches.length === 0) {
    return {
      verdict: "missing",
      resumeSnippet: null,
      notes: `Resume contains no numeric "X years" claim to compare against JD floor of ${min}.`,
    };
  }

  type Candidate = { value: number; index: number; domainHits: number; domainRatio: number };
  const candidates: Candidate[] = [];
  for (const m of matches) {
    const value = Number(m[1]);
    if (!Number.isFinite(value)) continue;
    const idx = m.index ?? 0;
    const ctx = text
      .slice(Math.max(0, idx - 120), idx + 120)
      .toLowerCase();
    const hits = domainKeywords.filter((w) => ctx.includes(w));
    const ratio =
      domainKeywords.length > 0 ? hits.length / domainKeywords.length : 1;
    candidates.push({ value, index: idx, domainHits: hits.length, domainRatio: ratio });
  }

  // Tier 1: year claim that meets the floor AND lives near the JD's domain
  const domainAligned = candidates
    .filter((c) => c.value >= min && c.domainRatio >= 0.5)
    .sort((a, b) => b.value - a.value)[0];
  if (domainAligned) {
    return {
      verdict: "verified",
      resumeSnippet: snippetAround(text, domainAligned.index),
      notes: `Resume claims ${domainAligned.value}+ years in context of the JD's domain (floor: ${min}).`,
    };
  }

  // Tier 2: year claim that meets the floor but NOT clearly near the domain —
  // this is the "17 years federal experience near a 5+ years P&L floor"
  // scenario. Treat as partial: number is fine, attribution is uncertain.
  const meetsFloor = candidates
    .filter((c) => c.value >= min)
    .sort((a, b) => b.value - a.value)[0];
  if (meetsFloor) {
    return {
      verdict: "partial",
      resumeSnippet: snippetAround(text, meetsFloor.index),
      notes:
        domainKeywords.length > 0
          ? `Resume claims ${meetsFloor.value}+ years but the year claim is NOT clearly tied to the JD's domain (${domainKeywords.slice(0, 4).join(", ")}). A strict reviewer may not credit it.`
          : `Resume claims ${meetsFloor.value}+ years (no domain to check against).`,
    };
  }

  // Tier 3: no year claim meets the floor
  const closest = candidates.sort((a, b) => b.value - a.value)[0];
  return {
    verdict: "partial",
    resumeSnippet: snippetAround(text, closest.index),
    notes: `Resume's strongest year claim is ${closest.value}, below JD floor of ${min}.`,
  };
}

const DEGREE_TOKENS = [
  { rank: 4, patterns: [/\bph\.?\s*d\.?\b/i, /\bdoctorate\b/i] },
  { rank: 3, patterns: [/\bm\.?\s*b\.?\s*a\.?\b/i, /\bmaster'?s\b/i, /\bm\.?\s*s\.?\b/i, /\bm\.?\s*a\.?\b/i] },
  { rank: 2, patterns: [/\bbachelor'?s\b/i, /\bb\.?\s*s\.?\b/i, /\bb\.?\s*a\.?\b/i] },
  { rank: 1, patterns: [/\bassociate'?s\b/i, /\ba\.?\s*a\.?\b/i, /\ba\.?\s*s\.?\b/i] },
];

function matchDegree(
  k: Omit<Knockout, "coverage">,
  text: string,
): RawCoverage {
  const reqLower = k.requirement.toLowerCase();
  const requiredRank =
    /(ph\.?\s*d|doctorate)/i.test(reqLower) ? 4 :
    /(m\.?b\.?a|master'?s|m\.?s\.?|m\.?a\.?)/i.test(reqLower) ? 3 :
    /(bachelor|b\.?s\.?|b\.?a\.?)/i.test(reqLower) ? 2 :
    /(associate|a\.?a\.?|a\.?s\.?)/i.test(reqLower) ? 1 :
    null;

  for (const tier of DEGREE_TOKENS) {
    for (const re of tier.patterns) {
      const m = text.match(re);
      if (m) {
        const snippet = snippetAround(text, m.index ?? 0);
        if (!requiredRank) {
          return { verdict: "verified", resumeSnippet: snippet, notes: null };
        }
        if (tier.rank >= requiredRank) {
          return {
            verdict: "verified",
            resumeSnippet: snippet,
            notes: tier.rank > requiredRank
              ? `Resume degree exceeds JD minimum.`
              : null,
          };
        }
        return {
          verdict: "partial",
          resumeSnippet: snippet,
          notes: `Resume shows a lower degree tier than JD requires.`,
        };
      }
    }
  }
  return {
    verdict: "missing",
    resumeSnippet: null,
    notes: `Resume does not show a matching degree.`,
  };
}

function matchCertification(
  k: Omit<Knockout, "coverage">,
  text: string,
): RawCoverage {
  // Pull the canonical cert token from the requirement (the longest UPPERCASE
  // run is usually the acronym). Fall back to the whole requirement string.
  const acronymMatch = k.requirement.match(/\b[A-Z][A-Z0-9\-/]{1,15}\b/g);
  const tokens = acronymMatch && acronymMatch.length > 0
    ? acronymMatch
    : [k.requirement];

  for (const tok of tokens) {
    if (tok.length < 2) continue;
    const escaped = tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`, "i");
    const m = text.match(re);
    if (m) {
      return {
        verdict: "verified",
        resumeSnippet: snippetAround(text, m.index ?? 0),
        notes: null,
      };
    }
  }
  return {
    verdict: "missing",
    resumeSnippet: null,
    notes: `Resume does not mention "${k.requirement}".`,
  };
}

const WORK_AUTH_PATTERNS = [
  /\bauthori[sz]ed\s+to\s+work\b/i,
  /\bno\s+sponsorship\s+(required|needed)\b/i,
  /\bwithout\s+sponsorship\b/i,
];

function matchWorkAuth(text: string): RawCoverage {
  for (const re of WORK_AUTH_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const snippet = snippetAround(text, m.index ?? 0);
      if (hasNearbyNegation(text, m.index ?? 0)) {
        return {
          verdict: "blocking",
          resumeSnippet: snippet,
          notes: "Resume explicitly negates work authorization.",
        };
      }
      return {
        verdict: "verified",
        resumeSnippet: snippet,
        notes: null,
      };
    }
  }
  return {
    verdict: "missing",
    resumeSnippet: null,
    notes: "Resume does not explicitly state work authorization.",
  };
}

function matchOther(
  k: Omit<Knockout, "coverage">,
  text: string,
): RawCoverage {
  // Best-effort literal substring of the requirement's core nouns. If we can't
  // find good evidence, mark as cannot_determine so the user/QC loop reviews.
  const words = k.requirement
    .toLowerCase()
    .split(/[\s,;:./]+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
  if (words.length === 0) {
    return { verdict: "cannot_determine", resumeSnippet: null, notes: null };
  }
  const lower = text.toLowerCase();
  const hits = words.filter((w) => lower.includes(w));
  if (hits.length === words.length) {
    const idx = lower.indexOf(hits[0]);
    return {
      verdict: "verified",
      resumeSnippet: snippetAround(text, idx),
      notes: `All ${hits.length} core terms present.`,
    };
  }
  if (hits.length >= Math.ceil(words.length / 2)) {
    const idx = lower.indexOf(hits[0]);
    return {
      verdict: "partial",
      resumeSnippet: snippetAround(text, idx),
      notes: `${hits.length}/${words.length} core terms present.`,
    };
  }
  return {
    verdict: "missing",
    resumeSnippet: null,
    notes: `${hits.length}/${words.length} core terms present.`,
  };
}

const STOPWORDS = new Set([
  "with",
  "from",
  "this",
  "that",
  "have",
  "will",
  "must",
  "able",
  "their",
  "which",
  "year",
  "years",
  "experience",
  "required",
  "requirements",
]);

function snippetAround(text: string, idx: number, span = 80): string {
  const start = Math.max(0, idx - span);
  const end = Math.min(text.length, idx + span);
  const raw = text.slice(start, end).replace(/\s+/g, " ").trim();
  return (start > 0 ? "…" : "") + raw + (end < text.length ? "…" : "");
}

function hasNearbyNegation(text: string, idx: number): boolean {
  const window = text
    .slice(Math.max(0, idx - 48), Math.min(text.length, idx + 32))
    .replace(/\s+/g, " ")
    .toLowerCase();
  return (
    /\b(not|never|without|lack(?:s|ing)?|no|non)\b/.test(window) ||
    /\b(do|does|did|can|cannot|can't|will)\s+not\b/.test(window)
  );
}

function stableId(category: KnockoutCategory, requirement: string): string {
  const slug = requirement
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `${category}_${slug}`;
}

/**
 * End-to-end: detect knockouts from JD, then deterministically score
 * coverage against the resume markdown. Returns the full report ready to
 * cache on the application row.
 */
export async function runKnockoutScan(opts: {
  jdText: string;
  jdAnalysis: JdAnalysis;
  resumeMarkdown: string | null;
  resumeVersionId: string | null;
  /**
   * Concatenated content of relevant KB facts. Used as fallback evidence
   * when no resume exists yet — lets the user see whether the KB grounds
   * each knockout, so they know what to add before generating drafts.
   * Optional: omit when the caller doesn't have KB context handy (e.g.
   * the QC loop, which always has a resume).
   */
  kbContext?: string | null;
  applicationId?: string;
}): Promise<KnockoutReport> {
  const { knockouts: raw, costUsd } = await detectKnockoutsFromJd({
    jdText: opts.jdText,
    jdAnalysis: opts.jdAnalysis,
    applicationId: opts.applicationId,
  });
  const knockouts = checkKnockoutCoverage(raw, {
    resumeMarkdown: opts.resumeMarkdown ?? "",
    kbContext: opts.kbContext ?? "",
  });
  return {
    knockouts,
    missingCount: knockouts.filter((k) => k.coverage.verdict === "missing").length,
    partialCount: knockouts.filter((k) => k.coverage.verdict === "partial").length,
    verifiedCount: knockouts.filter((k) => k.coverage.verdict === "verified").length,
    blockingCount: knockouts.filter((k) => k.coverage.verdict === "blocking").length,
    cannotDetermineCount: knockouts.filter((k) => k.coverage.verdict === "cannot_determine").length,
    resumeVersionId: opts.resumeVersionId,
    costUsd,
  };
}

/**
 * Convert a knockout report into QC revision feedback items. Missing or
 * blocking knockouts are HIGH priority and prefixed [KNOCKOUT] so the writer
 * recognizes them as filter-level concerns (not stylistic). These items are
 * inserted at the TOP of the revision payload by the QC loop — above
 * recruiter sim, role title, and ATS keyword items.
 */
export function knockoutReportToFeedbackItems(
  report: KnockoutReport,
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
  for (const k of report.knockouts) {
    if (k.coverage.verdict === "verified") continue;
    if (k.coverage.verdict === "cannot_determine") continue;
    const v = k.coverage.verdict;
    const severity =
      v === "blocking" ? "CRITICAL" : v === "missing" ? "HIGH" : "PARTIAL";
    items.push({
      priority: "high",
      doc: "resume",
      location: null,
      issue: `[KNOCKOUT — ${severity}] ${k.requirement}. JD evidence: "${k.jdEvidenceQuote.slice(0, 160)}". Resume status: ${k.coverage.notes ?? v}.`,
      suggestion: suggestionFor(k),
    });
  }
  return items;
}

function suggestionFor(k: Knockout): string {
  switch (k.category) {
    case "citizenship":
      return `Add an explicit line near the top (Summary or a dedicated "Clearances & Eligibility" block): "U.S. citizen." If KB doesn't support it, do NOT fabricate — flag to the user instead.`;
    case "clearance":
      return `Add a "Clearances" line near the top stating the level + status, e.g. "Public Trust Clearance - High Risk Tier (previously held 2008-2025; reinstatement-eligible)". Use "previously held" unless KB explicitly says the clearance is currently active. Match or exceed the JD's required level. Never overstate.`;
    case "experience_years":
      return `Surface a verbatim "${k.scalarMinimum}+ years" (or higher) claim in the Summary against the JD-named domain. KB facts must support the number. Use 17 years only for total federal IT/SSA experience; use 9+ years for leadership/management/supervisory/GS-13/14 experience. If KB doesn't support meeting the floor, flag to the user.`;
    case "degree":
      return `Confirm the Education section shows a degree meeting or exceeding the JD requirement, with both the degree abbreviation (e.g. M.B.A., B.S.) and field. Add field-of-study qualifier if missing.`;
    case "certification":
      return `Add the literal certification token to the "Certifications" line (both acronym and spelled-out form). If KB doesn't show the cert as held, flag to the user — do not fabricate.`;
    case "work_authorization":
      return `Add a single line: "Authorized to work in the U.S. without sponsorship." Only include if true per KB.`;
    case "other":
      return `Address the requirement explicitly with a literal claim near the top of the resume. If KB doesn't support it, flag to the user.`;
  }
}
