/**
 * ATS (Applicant Tracking System) keyword simulator.
 *
 * Most ATS layers are dumb keyword matchers — they tokenize, lowercase, and
 * check whether the JD's must-have phrases (or their content words) appear
 * in the resume text. They don't do semantic similarity. So a resume that
 * scores well with a human reader can still die at the ATS layer if it
 * paraphrases JD keywords instead of echoing them.
 *
 * This module simulates that layer: deterministic regex/string ops, no LLM,
 * zero cost, sub-50ms latency. Returns per-keyword coverage so the user can
 * fix gaps before exporting.
 */

export type AtsCoverageVerdict = "verbatim" | "partial" | "missing";

export type AtsCoverage = {
  phrase: string;
  verdict: AtsCoverageVerdict;
  /** Number of content (non-stopword) words from the phrase found in the resume. */
  matchedContentWords: number;
  /** Total content words in the phrase. */
  totalContentWords: number;
  /** First snippet from the resume that mentions the phrase or its content words. */
  matchSnippet: string | null;
};

export type AtsCoverageReport = {
  /** Per-skill coverage for the JD's must-haves. */
  mustHave: AtsCoverage[];
  /** Per-skill coverage for the JD's nice-to-haves. */
  niceToHave: AtsCoverage[];
  /** Per-phrase coverage for the JD's exact "keyLanguagePatterns". */
  keyLanguagePatterns: AtsCoverage[];
  /** Counts for must-have. */
  verbatimCount: number;
  partialCount: number;
  missingCount: number;
  /** Overall 0-100 score weighted on must-haves: verbatim=1, partial=0.5, missing=0. */
  overallScore: number;
};

const STOPWORDS = new Set([
  "a", "an", "and", "any", "are", "as", "at", "be", "by", "for", "from",
  "in", "is", "it", "its", "of", "on", "or", "that", "the", "to", "was",
  "with", "your", "you", "we", "us", "our", "their", "they", "them",
  "this", "these", "those", "but", "if", "so", "than", "then", "such",
]);

/** Tokenize text into lowercase content words. Preserves &, +, hyphenated terms. */
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\w&+/\-\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function contentWords(tokens: string[]): string[] {
  return tokens.filter((t) => !STOPWORDS.has(t) && t.length > 1);
}

/** Normalized resume text for verbatim phrase search. */
function normalizeForPhraseSearch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’“”]/g, "'") // smart quotes → apostrophe
    .replace(/[^\w&+/\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strict verbatim phrase match (after normalization). */
function isVerbatim(normalizedResume: string, phrase: string): boolean {
  const normPhrase = normalizeForPhraseSearch(phrase);
  if (normPhrase.length < 3) return false;
  return normalizedResume.includes(normPhrase);
}

/** Pull a snippet around the first match of any matching content word. */
function findSnippet(
  rawResume: string,
  phrase: string,
  matchedWords: string[],
): string | null {
  if (matchedWords.length === 0) return null;
  // Try to find the literal phrase first
  const normPhrase = normalizeForPhraseSearch(phrase);
  const normResume = normalizeForPhraseSearch(rawResume);
  let idx = normResume.indexOf(normPhrase);
  let matchLength = normPhrase.length;
  if (idx < 0) {
    // Fall back to first matched content word
    for (const w of matchedWords) {
      const re = new RegExp(`\\b${escapeRegex(w)}\\b`, "i");
      const m = re.exec(rawResume);
      if (m) {
        idx = m.index;
        matchLength = m[0].length;
        // Use raw resume idx instead since regex hit on raw text
        return extractSnippet(rawResume, idx, matchLength);
      }
    }
    return null;
  }
  // Map normalized idx back to raw — approximation: just use the same offset
  // (acceptable for snippet purposes since we collapse whitespace consistently)
  return extractSnippet(rawResume, idx, matchLength);
}

function extractSnippet(text: string, start: number, length: number): string {
  const before = Math.max(0, start - 40);
  const end = Math.min(text.length, start + length + 40);
  let snippet = text.slice(before, end).replace(/\s+/g, " ").trim();
  if (before > 0) snippet = "…" + snippet;
  if (end < text.length) snippet = snippet + "…";
  return snippet;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scoreOne(rawResume: string, phrase: string): AtsCoverage {
  const normResume = normalizeForPhraseSearch(rawResume);
  const resumeTokens = new Set(tokenize(rawResume));
  const phraseContent = contentWords(tokenize(phrase));
  const totalContentWords = phraseContent.length;

  // Pass 1: exact phrase match
  if (isVerbatim(normResume, phrase)) {
    const matched = phraseContent.filter((w) => resumeTokens.has(w));
    return {
      phrase,
      verdict: "verbatim",
      matchedContentWords: matched.length || totalContentWords,
      totalContentWords,
      matchSnippet: findSnippet(rawResume, phrase, matched),
    };
  }

  // Pass 2: content-word overlap
  const matched = phraseContent.filter((w) => resumeTokens.has(w));
  const ratio = totalContentWords > 0 ? matched.length / totalContentWords : 0;
  // Treat ≥60% content-word coverage as partial. Single-content-word phrases
  // need that one word found verbatim — handled above as verbatim, so here a
  // 1-word phrase with no hit just falls to missing.
  const verdict: AtsCoverageVerdict =
    ratio >= 0.6 && totalContentWords >= 2 ? "partial" : "missing";

  return {
    phrase,
    verdict,
    matchedContentWords: matched.length,
    totalContentWords,
    matchSnippet: verdict === "partial" ? findSnippet(rawResume, phrase, matched) : null,
  };
}

/**
 * Convert an ATS coverage report into consolidated-feedback items the QC
 * revision loop can pass to the writer. Missing must-haves become HIGH-
 * priority items, partials MEDIUM. The wording explicitly defers to KB
 * grounding so the writer can't satisfy ATS by fabricating.
 *
 * The `doc` parameter tags every item and tailors the suggestion text:
 * resume suggestions point at bullets/skills lines; cover-letter suggestions
 * point at narrative integration (no keyword-stuffing in prose).
 */
export function atsReportToFeedbackItems(
  report: AtsCoverageReport,
  doc: "resume" | "cover_letter" = "resume",
  opts?: {
    /**
     * Combined per-phrase coverage across BOTH docs. When supplied, items
     * for phrases missing from BOTH the resume AND the cover letter get a
     * "[MISSING FROM BOTH DOCS]" prefix so the writer sees the structural
     * red flag, not just a generic "missing from this doc" line.
     */
    combined?: CombinedPhraseCoverage[];
  },
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

  const docLabel = doc === "resume" ? "resume" : "cover letter";
  const integrateAdvice =
    doc === "resume"
      ? "Include the literal phrase in a bullet or skills line"
      : "Work the literal phrase naturally into the body paragraph or hook (NOT keyword stuffing — it must read as prose)";

  // Build a lookup: phrase → "missing from both" boolean.
  const missingFromBoth = new Map<string, boolean>();
  if (opts?.combined) {
    for (const c of opts.combined) {
      missingFromBoth.set(
        c.phrase,
        c.resume === "missing" && c.coverLetter === "missing",
      );
    }
  }

  for (const c of report.mustHave) {
    if (c.verdict === "missing") {
      if (isLikelyUnsupportedTargetPlatform(c.phrase)) continue;
      const both = missingFromBoth.get(c.phrase) === true;
      const prefix = both ? "[MISSING FROM BOTH DOCS] " : "";
      items.push({
        priority: "high",
        doc,
        location: null,
        issue: `${prefix}ATS scan: must-have keyphrase "${c.phrase}" does not appear in the ${docLabel}.`,
        suggestion: `${integrateAdvice} for "${c.phrase}" (or a close lexical variant) ONLY if a KB fact supports the underlying claim. ATS scanners do mechanical substring matching — paraphrases that lose the keyword don't score. If no KB grounding exists for this phrase, skip; do not fabricate.${both ? " This phrase is missing from BOTH the resume AND the cover letter — strongest red flag for AI screening." : ""}`,
      });
    } else if (c.verdict === "partial") {
      if (isLikelyUnsupportedTargetPlatform(c.phrase)) continue;
      items.push({
        priority: "medium",
        doc,
        location: null,
        issue: `ATS scan: partial match on "${c.phrase}" in the ${docLabel} (${c.matchedContentWords}/${c.totalContentWords} content words present).`,
        suggestion: `Tighten the wording toward the literal JD phrase "${c.phrase}" if a KB fact supports it. Keep KB-grounding intact — never fabricate to satisfy ATS.`,
      });
    }
  }

  // Key-language patterns are JD-specific phrasings (often acronyms, vehicle
  // names, etc.). Missing ones get medium; partials get low — the writer
  // shouldn't keyword-stuff but should echo where natural.
  for (const c of report.keyLanguagePatterns) {
    if (c.verdict === "missing") {
      if (isLikelyUnsupportedTargetPlatform(c.phrase)) continue;
      const both = missingFromBoth.get(c.phrase) === true;
      const prefix = both ? "[MISSING FROM BOTH DOCS] " : "";
      items.push({
        priority: "medium",
        doc,
        location: null,
        issue: `${prefix}ATS scan: JD key-language phrase "${c.phrase}" does not appear in the ${docLabel}.`,
        suggestion: `If a KB fact supports it, ${doc === "resume" ? 'work the literal phrase "' + c.phrase + '" into a bullet or the skills line' : 'mention "' + c.phrase + '" naturally if it strengthens the narrative'}. Skip if no grounding exists.`,
      });
    }
  }

  return items;
}

export function isLikelyUnsupportedTargetPlatform(phrase: string): boolean {
  return /\b(NG911|CAD|RMS|COP|MNS|OT)\b|operational technology|software\/hardware/i.test(
    phrase,
  );
}

// ---------------------------------------------------------------------------
// Role-title-in-Summary check
// ---------------------------------------------------------------------------

export type RoleTitleVerdict = "verbatim" | "partial" | "missing" | "no_summary";

export type RoleTitleCoverage = {
  jdTitle: string;
  hasSummary: boolean;
  /** Summary section text (first 300 chars), or null if no Summary section detected. */
  summarySnippet: string | null;
  verdict: RoleTitleVerdict;
  /** Content words from the JD title found in the Summary. */
  matchedContentWords: number;
  totalContentWords: number;
};

/**
 * Pull the Summary section from a resume markdown. Tolerant of common header
 * variations: "Summary", "Professional Summary", "Profile", "Executive Summary".
 * Returns null if no recognized Summary header is found.
 */
function extractSummarySection(resumeMarkdown: string): string | null {
  // Look for headers like "## Summary" or "### Professional Summary" — at the
  // start of a line, after some whitespace.
  const headerRe =
    /^[#]{1,6}\s+(executive\s+summary|professional\s+summary|profile|summary)\s*$/im;
  const match = headerRe.exec(resumeMarkdown);
  if (!match) return null;
  const start = match.index + match[0].length;
  // Find the next top-level-ish header (## or higher) after the Summary
  const remaining = resumeMarkdown.slice(start);
  const nextHeaderRe = /^[#]{1,6}\s+\S/m;
  const nextMatch = nextHeaderRe.exec(remaining);
  const end = nextMatch ? nextMatch.index : remaining.length;
  return remaining.slice(0, end).trim();
}

export function checkRoleTitleInSummary(opts: {
  resumeMarkdown: string;
  jdRoleTitle: string;
}): RoleTitleCoverage {
  const summary = extractSummarySection(opts.resumeMarkdown);
  if (!summary || summary.length === 0) {
    return {
      jdTitle: opts.jdRoleTitle,
      hasSummary: false,
      summarySnippet: null,
      verdict: "no_summary",
      matchedContentWords: 0,
      totalContentWords: 0,
    };
  }

  // Verbatim phrase check first (most common case)
  const normSummary = normalizeForPhraseSearch(summary);
  if (isVerbatim(normSummary, opts.jdRoleTitle)) {
    const titleWords = contentWords(tokenize(opts.jdRoleTitle));
    return {
      jdTitle: opts.jdRoleTitle,
      hasSummary: true,
      summarySnippet: summary.slice(0, 300),
      verdict: "verbatim",
      matchedContentWords: titleWords.length,
      totalContentWords: titleWords.length,
    };
  }

  // Content-word overlap
  const summaryTokens = new Set(tokenize(summary));
  const titleContent = contentWords(tokenize(opts.jdRoleTitle));
  const matched = titleContent.filter((w) => summaryTokens.has(w));
  const ratio =
    titleContent.length > 0 ? matched.length / titleContent.length : 0;

  // Tight thresholds for role title — it's a structural rule:
  // ≥85% match counts as close-enough; 50-85% = partial; <50% = missing.
  let verdict: RoleTitleVerdict;
  if (ratio >= 0.85) verdict = "verbatim";
  else if (ratio >= 0.5) verdict = "partial";
  else verdict = "missing";

  return {
    jdTitle: opts.jdRoleTitle,
    hasSummary: true,
    summarySnippet: summary.slice(0, 300),
    verdict,
    matchedContentWords: matched.length,
    totalContentWords: titleContent.length,
  };
}

/**
 * Convert a RoleTitleCoverage finding to a writer feedback item. Returns
 * null when verdict is verbatim (nothing to fix).
 */
export function roleTitleFeedbackItem(
  coverage: RoleTitleCoverage,
):
  | {
      priority: "high" | "medium" | "low";
      doc: "resume" | "cover_letter" | "both";
      location: string | null;
      issue: string;
      suggestion: string;
    }
  | null {
  if (coverage.verdict === "verbatim") return null;

  if (coverage.verdict === "no_summary") {
    return {
      priority: "high",
      doc: "resume",
      location: "Summary section",
      issue: `[STRUCTURE] The resume has no Summary section. ATS scanners and human reviewers expect one.`,
      suggestion: `Add a Summary section near the top of the resume. The first 1-2 sentences should include the JD's literal role title ("${coverage.jdTitle}") if KB supports it.`,
    };
  }

  if (coverage.verdict === "missing") {
    return {
      priority: "high",
      doc: "resume",
      location: "Summary section",
      issue: `[STRUCTURE] The JD's role title "${coverage.jdTitle}" does not appear in the resume's Summary section (only ${coverage.matchedContentWords}/${coverage.totalContentWords} content words matched).`,
      suggestion: `Most ATS layers weight the Summary section heavily. Re-word the Summary's opening so it contains the JD's literal role title "${coverage.jdTitle}" or a very close variant. Only do this if a KB fact supports the candidate operating at that level — never inflate.`,
    };
  }

  // partial
  return {
    priority: "medium",
    doc: "resume",
    location: "Summary section",
    issue: `[STRUCTURE] The Summary partially matches the JD title "${coverage.jdTitle}" (${coverage.matchedContentWords}/${coverage.totalContentWords} content words). Missing tokens may matter to keyword ATS.`,
    suggestion: `Tighten the Summary's opening to include more of the JD's literal title wording. Aim for the title to appear close to verbatim in the first sentence if KB grounding allows.`,
  };
}

// ---------------------------------------------------------------------------
// Merged view across resume + cover letter
// ---------------------------------------------------------------------------

export type CombinedPhraseCoverage = {
  phrase: string;
  category: "must_have" | "nice_to_have" | "key_language";
  resume: AtsCoverageVerdict;
  coverLetter: AtsCoverageVerdict;
};

export type CombinedAtsReport = {
  resume: AtsCoverageReport;
  coverLetter: AtsCoverageReport;
  combined: CombinedPhraseCoverage[];
  /** Score for resume-only ATS scan. */
  resumeScore: number;
  /** Score for cover-letter-only ATS scan. */
  coverLetterScore: number;
  /**
   * Weighted blended score: resumes carry the keyword load (70%), cover
   * letters are bonus signal (30%). This is the headline number to surface.
   */
  blendedScore: number;
  /** Count of must-haves missing from BOTH docs (the worst case). */
  missingFromBothCount: number;
  /** Role-title-in-Summary check (most ATS weights Summary heavily). */
  roleTitleCoverage: RoleTitleCoverage;
};

function indexByPhrase(coverages: AtsCoverage[]): Map<string, AtsCoverage> {
  const m = new Map<string, AtsCoverage>();
  for (const c of coverages) m.set(c.phrase, c);
  return m;
}

export function combineAtsReports(opts: {
  resumeMarkdown: string;
  coverLetterMarkdown: string;
  mustHaveSkills: string[];
  niceToHaveSkills?: string[];
  keyLanguagePatterns?: string[];
  jdRoleTitle?: string;
}): CombinedAtsReport {
  const resume = simulateAtsScan({
    resumeMarkdown: opts.resumeMarkdown,
    mustHaveSkills: opts.mustHaveSkills,
    niceToHaveSkills: opts.niceToHaveSkills,
    keyLanguagePatterns: opts.keyLanguagePatterns,
  });
  // Cover letter scans use the SAME phrase lists. We re-use the existing
  // scanner with the cover letter markdown as input.
  const coverLetter = simulateAtsScan({
    resumeMarkdown: opts.coverLetterMarkdown,
    mustHaveSkills: opts.mustHaveSkills,
    niceToHaveSkills: opts.niceToHaveSkills,
    keyLanguagePatterns: opts.keyLanguagePatterns,
  });

  const resumeMustHave = indexByPhrase(resume.mustHave);
  const coverMustHave = indexByPhrase(coverLetter.mustHave);
  const resumeNice = indexByPhrase(resume.niceToHave);
  const coverNice = indexByPhrase(coverLetter.niceToHave);
  const resumeKey = indexByPhrase(resume.keyLanguagePatterns);
  const coverKey = indexByPhrase(coverLetter.keyLanguagePatterns);

  const combined: CombinedPhraseCoverage[] = [];
  for (const p of opts.mustHaveSkills) {
    combined.push({
      phrase: p,
      category: "must_have",
      resume: resumeMustHave.get(p)?.verdict ?? "missing",
      coverLetter: coverMustHave.get(p)?.verdict ?? "missing",
    });
  }
  for (const p of opts.niceToHaveSkills ?? []) {
    combined.push({
      phrase: p,
      category: "nice_to_have",
      resume: resumeNice.get(p)?.verdict ?? "missing",
      coverLetter: coverNice.get(p)?.verdict ?? "missing",
    });
  }
  for (const p of opts.keyLanguagePatterns ?? []) {
    combined.push({
      phrase: p,
      category: "key_language",
      resume: resumeKey.get(p)?.verdict ?? "missing",
      coverLetter: coverKey.get(p)?.verdict ?? "missing",
    });
  }

  // Blended score: 0.7 * resume + 0.3 * coverLetter (resume carries weight).
  const blendedScore = Math.round(
    0.7 * resume.overallScore + 0.3 * coverLetter.overallScore,
  );

  // Must-haves missing from BOTH docs = worst-case red flags.
  const missingFromBothCount = combined.filter(
    (c) =>
      c.category === "must_have" &&
      c.resume === "missing" &&
      c.coverLetter === "missing",
  ).length;

  const roleTitleCoverage = checkRoleTitleInSummary({
    resumeMarkdown: opts.resumeMarkdown,
    jdRoleTitle: opts.jdRoleTitle ?? "",
  });

  return {
    resume,
    coverLetter,
    combined,
    resumeScore: resume.overallScore,
    coverLetterScore: coverLetter.overallScore,
    blendedScore,
    missingFromBothCount,
    roleTitleCoverage,
  };
}

export function simulateAtsScan(opts: {
  resumeMarkdown: string;
  mustHaveSkills: string[];
  niceToHaveSkills?: string[];
  keyLanguagePatterns?: string[];
}): AtsCoverageReport {
  const resume = opts.resumeMarkdown ?? "";
  const mustHave = (opts.mustHaveSkills ?? []).map((p) => scoreOne(resume, p));
  const niceToHave = (opts.niceToHaveSkills ?? []).map((p) => scoreOne(resume, p));
  const keyLanguagePatterns = (opts.keyLanguagePatterns ?? []).map((p) =>
    scoreOne(resume, p),
  );

  const verbatimCount = mustHave.filter((c) => c.verdict === "verbatim").length;
  const partialCount = mustHave.filter((c) => c.verdict === "partial").length;
  const missingCount = mustHave.filter((c) => c.verdict === "missing").length;

  const total = mustHave.length;
  const weightedHits = verbatimCount + 0.5 * partialCount;
  const overallScore =
    total > 0 ? Math.round((weightedHits / total) * 100) : 100;

  return {
    mustHave,
    niceToHave,
    keyLanguagePatterns,
    verbatimCount,
    partialCount,
    missingCount,
    overallScore,
  };
}
