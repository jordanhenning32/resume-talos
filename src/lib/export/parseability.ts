import { extractText } from "unpdf";
import { parseResumeMarkdown } from "./parse-resume";
import type { LayoutId } from "./layouts/types";

export type ParseabilityArtifactKind =
  | "section_out_of_order"
  | "date_text_collision"
  | "skill_cluster_in_experience"
  | "low_content_coverage"
  | "empty_extraction"
  | "missing_canonical_section"
  | "non_canonical_section_header"
  | "page_overflow";

export type ParseabilityArtifact = {
  kind: ParseabilityArtifactKind;
  detail: string;
  sample?: string;
};

export type ParseabilityVerdict = "clean" | "warning" | "broken";

export type ParseabilityReport = {
  layoutId: LayoutId;
  pageCount: number;
  extractedTextLength: number;
  contentCoverage: number; // 0..1 — fraction of source tokens that appear in extracted text
  missingTokens: string[]; // sample of meaningful tokens NOT in extracted text (up to 20)
  sectionOrder: {
    sourceOrder: string[];
    extractedOrder: string[];
    inOrder: boolean;
  };
  artifacts: ParseabilityArtifact[];
  verdict: ParseabilityVerdict;
  notes: string[];
};

const COVERAGE_CLEAN_THRESHOLD = 0.95;
const COVERAGE_WARNING_THRESHOLD = 0.85;
const MIN_TOKEN_LENGTH = 4;

const SECTION_HEADER_REGEX = /^##\s+(.+?)\s*$/gm;

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "their",
  "those",
  "into",
  "over",
  "than",
  "have",
  "will",
  "must",
  "must-haves",
  "must-have",
  "more",
  "less",
  "across",
  "while",
  "where",
  "when",
  "which",
  "after",
  "during",
  "between",
  "above",
  "below",
  "https",
  "http",
  "www",
  "com",
  "org",
  "html",
]);

export async function validatePdfParseability(opts: {
  pdfBuffer: Buffer;
  sourceMarkdown: string;
  layoutId: LayoutId;
  /**
   * Resume variant — drives the expected page limit. "short" → 1 page,
   * "long" → 2 pages. When omitted we default to 2 (the more permissive
   * limit) so older callers don't suddenly start flagging overflow.
   */
  variant?: "short" | "long";
}): Promise<ParseabilityReport> {
  const extraction = await extractText(new Uint8Array(opts.pdfBuffer), {
    mergePages: true,
  });
  const extractedRaw = Array.isArray(extraction.text)
    ? extraction.text.join("\n")
    : extraction.text;
  const pageCount = extraction.totalPages ?? 0;
  const extracted = normalize(extractedRaw);

  if (!extracted.trim()) {
    return {
      layoutId: opts.layoutId,
      pageCount,
      extractedTextLength: 0,
      contentCoverage: 0,
      missingTokens: [],
      sectionOrder: { sourceOrder: [], extractedOrder: [], inOrder: false },
      artifacts: [
        {
          kind: "empty_extraction",
          detail:
            "unpdf returned zero text from the rendered PDF — the renderer may have produced image-only output, or the file is corrupt.",
        },
      ],
      verdict: "broken",
      notes: ["No text extractable from the rendered PDF."],
    };
  }

  // Content coverage: meaningful tokens from source vs. extracted
  const sourceTokens = uniqueMeaningfulTokens(opts.sourceMarkdown);
  const extractedLower = extracted.toLowerCase();
  const present: string[] = [];
  const missing: string[] = [];
  for (const tok of sourceTokens) {
    if (extractedLower.includes(tok)) present.push(tok);
    else missing.push(tok);
  }
  const contentCoverage =
    sourceTokens.length === 0 ? 1 : present.length / sourceTokens.length;

  // Section order
  const sourceOrder = extractSectionHeadersFromMarkdown(opts.sourceMarkdown);
  const expectedRenderOrder = expectedRenderedSectionOrder(
    opts.sourceMarkdown,
    opts.layoutId,
  );
  const extractedOrder = extractSectionHeadersFromText(extracted, sourceOrder);
  const sectionInOrder = isSubsequenceInOrder(expectedRenderOrder, extractedOrder);

  // Column-merge / layout artifacts
  const artifacts: ParseabilityArtifact[] = [];

  if (contentCoverage < COVERAGE_WARNING_THRESHOLD) {
    artifacts.push({
      kind: "low_content_coverage",
      detail: `Only ${Math.round(contentCoverage * 100)}% of meaningful source tokens appear in the extracted PDF text. Many ATS parsers will miss claims that don't survive extraction.`,
      sample: missing.slice(0, 5).join(", "),
    });
  }

  if (!sectionInOrder && sourceOrder.length >= 2) {
    artifacts.push({
      kind: "section_out_of_order",
      detail: `Section headers appear in a different order than the rendered resume should expose to an ATS parser - common when a parser linearizes a two-column layout column-by-column rather than top-to-bottom.`,
      sample: `Expected: [${expectedRenderOrder.join(" -> ")}]. Extracted: [${extractedOrder.join(" -> ")}].`,
    });
  }

  artifacts.push(...detectDateTextCollisions(extracted));
  artifacts.push(...detectSkillClusterInExperience(extracted));
  artifacts.push(...auditCanonicalSectionHeaders(sourceOrder));

  // Page-overflow check — long variant must fit in 2 pages, short in 1.
  // Many recruiter pipelines auto-reject resumes that exceed the implicit
  // length expectation for the role's seniority.
  const variant = opts.variant ?? "long";
  const maxPages = variant === "short" ? 1 : 2;
  if (pageCount > maxPages) {
    artifacts.push({
      kind: "page_overflow",
      detail: `Resume is ${pageCount} pages - exceeds the ${maxPages}-page target for the ${variant} variant. Some postings allow this, especially federal resumes; otherwise trim bullets, drop lowest-impact roles, or regenerate.`,
      sample: `pages=${pageCount} limit=${maxPages} variant=${variant}`,
    });
  }
  // Note: `detectInlineBulletMarkers` was tried and removed — PDF text
  // extraction always collapses bullets onto adjacent line content, so the
  // signal had ~100% false-positive rate. Two-column merge artifacts are
  // caught instead by section_out_of_order + date_text_collision.

  // Verdict
  let verdict: ParseabilityVerdict = "clean";
  if (artifacts.some((a) => a.kind === "empty_extraction")) {
    verdict = "broken";
  } else if (
    artifacts.some((a) => a.kind === "section_out_of_order") ||
    contentCoverage < COVERAGE_WARNING_THRESHOLD ||
    artifacts.some(
      (a) =>
        a.kind === "missing_canonical_section" &&
        /(Experience|Education)/i.test(a.detail),
    )
  ) {
    verdict = "broken";
  } else if (
    artifacts.length > 0 ||
    contentCoverage < COVERAGE_CLEAN_THRESHOLD
  ) {
    verdict = "warning";
  }

  const notes: string[] = [];
  if (verdict === "clean") {
    notes.push(
      `Extraction looks clean — ${Math.round(contentCoverage * 100)}% content coverage, sections in order, no column-merge artifacts.`,
    );
  } else if (verdict === "warning") {
    notes.push(
      `Extraction has minor concerns. Most ATS will likely still parse this resume, but it's a coin flip for stricter scanners.`,
    );
  } else {
    notes.push(
      `Extraction is degraded — this layout has a meaningful risk of being misread by ATS. Consider a single-column layout.`,
    );
  }

  return {
    layoutId: opts.layoutId,
    pageCount,
    extractedTextLength: extracted.length,
    contentCoverage,
    missingTokens: missing.slice(0, 20),
    sectionOrder: {
      sourceOrder,
      extractedOrder,
      inOrder: sectionInOrder,
    },
    artifacts,
    verdict,
    notes,
  };
}

function normalize(text: string): string {
  const out = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/­/g, "") // U+00AD soft hyphen
    // Many PDF renderers apply letterspacing/tracking to section headers,
    // producing extractions like "S U M M A R Y" or "S K I L L S". Collapse
    // runs of 3+ single uppercase letters separated by single spaces into
    // a single word. Done before whitespace normalization.
    .replace(/(?:\b[A-Z](?: [A-Z]){2,}\b)/g, (m) => m.replace(/ /g, ""))
    // Line-break hyphenation: "Hen-\nning" or "Hen- ning" → "Henning".
    // Only join when both sides are lowercase letters (common PDF
    // wrap behavior; not a real hyphenated word like "end-of-life").
    .replace(/([a-z])-\s+([a-z])/g, "$1$2")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
  return out;
}

function uniqueMeaningfulTokens(markdown: string): string[] {
  // Strip markdown syntax that won't survive PDF rendering
  const cleaned = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#*_~>-]+/g, " ")
    .replace(/\|/g, " ");

  const tokens = new Set<string>();
  const re = /[A-Za-z][A-Za-z0-9./&+\-]{2,}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const t = m[0].toLowerCase();
    if (t.length < MIN_TOKEN_LENGTH) continue;
    if (STOPWORDS.has(t)) continue;
    // Skip pure numbers
    if (/^\d+$/.test(t)) continue;
    tokens.add(t);
  }
  return Array.from(tokens);
}

/**
 * Section-name strictness audit. ATS parsers (especially Workday + Taleo)
 * key the candidate profile off literal section headers — "Summary",
 * "Experience", "Skills", "Education". Variant names ("Career Highlights",
 * "Tech Toolkit") cause the parser to silently skip the section. We:
 *   1) flag any canonical section that's missing (or only present as a
 *      non-standard variant), and
 *   2) list non-canonical headers as low-severity informational so the
 *      user can decide whether to rename them.
 *
 * Accepted variants per canonical (regex tested case-insensitive against
 * the full header):
 *   Summary       → "Summary", "Professional Summary", "Executive Summary"
 *   Experience    → "Experience", "Professional Experience", "Work Experience"
 *   Skills        → "Skills", "Technical Skills", "Core Competencies", "Core Skills"
 *   Education     → "Education", "Education & Training"
 */
const CANONICAL_SECTIONS: Array<{
  canonical: string;
  variantRegex: RegExp;
}> = [
  { canonical: "Summary", variantRegex: /^(?:professional\s+|executive\s+)?summary$/i },
  {
    canonical: "Experience",
    variantRegex: /^(?:professional\s+|work\s+|relevant\s+)?experience$/i,
  },
  {
    canonical: "Skills",
    variantRegex: /^(?:technical\s+|core\s+)?(?:skills|competencies)$/i,
  },
  {
    canonical: "Education",
    variantRegex: /^education(?:\s*&\s*training)?$/i,
  },
];

/**
 * Other headers we recognize as ATS-friendly even if not strictly canonical.
 * These don't flag the "non_canonical" warning — they're common, expected,
 * and well-keyed by major ATS systems.
 */
const ATS_FRIENDLY_OTHER_HEADERS: RegExp[] = [
  /^certifications?$/i,
  /^licenses?(?:\s*&\s*certifications?)?$/i,
  /^clearances?(?:\s*&\s*certifications?)?$/i,
  /^projects?$/i,
  /^publications?$/i,
  /^awards?(?:\s*&\s*recognition)?$/i,
  /^volunteer(?:\s+experience)?$/i,
  /^languages?$/i,
  /^contact(?:\s+info(?:rmation)?)?$/i,
  /^personal\s+info$/i,
];

function auditCanonicalSectionHeaders(
  headers: string[],
): ParseabilityArtifact[] {
  const out: ParseabilityArtifact[] = [];

  // Pass 1: which canonical sections are present (by exact OR variant match)?
  for (const { canonical, variantRegex } of CANONICAL_SECTIONS) {
    const matchedHeader = headers.find((h) => variantRegex.test(h.trim()));
    if (!matchedHeader) {
      out.push({
        kind: "missing_canonical_section",
        detail: `Missing canonical "${canonical}" section — Workday/Taleo and most ATS parsers key the candidate profile off this exact heading.`,
        sample: `Add: ## ${canonical}`,
      });
      continue;
    }
    // Header present but not the exact canonical form? Mention but don't bump verdict.
    if (matchedHeader.trim().toLowerCase() !== canonical.toLowerCase()) {
      out.push({
        kind: "non_canonical_section_header",
        detail: `"${matchedHeader}" is recognized as a variant of canonical "${canonical}", but the exact word "${canonical}" is more ATS-safe.`,
        sample: `Consider renaming: ## ${matchedHeader} → ## ${canonical}`,
      });
    }
  }

  // Pass 2: any headers that don't match a canonical, variant, OR known-friendly?
  const allRecognized: RegExp[] = [
    ...CANONICAL_SECTIONS.map((c) => c.variantRegex),
    ...ATS_FRIENDLY_OTHER_HEADERS,
  ];
  for (const h of headers) {
    const trimmed = h.trim();
    if (trimmed.length === 0) continue;
    if (allRecognized.some((re) => re.test(trimmed))) continue;
    out.push({
      kind: "non_canonical_section_header",
      detail: `"${trimmed}" is not a section header that major ATS systems key on. Content inside it may not be associated with a profile field.`,
      sample: `Consider grouping under one of: Summary, Experience, Skills, Education, Certifications, Projects, Awards.`,
    });
  }

  return out;
}

function extractSectionHeadersFromMarkdown(markdown: string): string[] {
  const headers: string[] = [];
  const re = new RegExp(SECTION_HEADER_REGEX.source, "gm");
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    headers.push(m[1].trim());
  }
  return headers;
}

function expectedRenderedSectionOrder(
  markdown: string,
  layoutId: LayoutId,
): string[] {
  const resume = parseResumeMarkdown(markdown);
  const base: string[] = [];
  if (resume.summary) base.push("Summary");
  if (resume.experience.length > 0) base.push("Experience");

  if (layoutId !== "modern-two-column") {
    const order = [...base, ...resume.otherSections.map((s) => s.heading)];
    return order.length > 0 ? order : extractSectionHeadersFromMarkdown(markdown);
  }

  const mainExtras: string[] = [];
  const sidebarSections: string[] = [];
  for (const section of resume.otherSections) {
    const lower = section.heading.toLowerCase();
    if (
      lower.includes("skill") ||
      lower.includes("certif") ||
      lower.includes("educa") ||
      lower.includes("clear") ||
      lower.includes("award")
    ) {
      sidebarSections.push(section.heading);
    } else {
      mainExtras.push(section.heading);
    }
  }

  const order = [...base, ...mainExtras, ...sidebarSections];
  return order.length > 0 ? order : extractSectionHeadersFromMarkdown(markdown);
}

function extractSectionHeadersFromText(text: string, sourceHeaders: string[]): string[] {
  if (sourceHeaders.length === 0) return [];

  const normalizedHeaders = sourceHeaders.map((header) => ({
    header,
    key: canonicalHeaderKey(header),
  }));
  const found = new Map<string, { header: string; index: number; score: number }>();
  const recordFound = (header: string, index: number, score: number) => {
    const previous = found.get(header);
    if (
      !previous ||
      score > previous.score ||
      (score === previous.score && index < previous.index)
    ) {
      found.set(header, { header, index, score });
    }
  };

  for (const { header } of normalizedHeaders) {
    const re = visualHeadingRegex(header);
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const matchedText = match[1] ?? "";
      const matchIndex = match.index + match[0].indexOf(matchedText);
      recordFound(header, matchIndex, 4);
    }
  }

  const lines = text.split("\n");
  let offset = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    const lineStart = offset + line.search(/\S|$/);
    if (trimmed.length > 0) {
      for (const { header, key } of normalizedHeaders) {
        const score = scoreHeadingLineMatch(trimmed, key);
        if (score === 0) continue;
        recordFound(header, lineStart, score);
      }
    }
    offset += line.length + 1;
  }

  const foundHeaders = Array.from(found.values());
  foundHeaders.sort((a, b) => a.index - b.index);
  return foundHeaders.map((f) => f.header);
}

function canonicalHeaderKey(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function visualHeadingRegex(header: string): RegExp {
  const chars = header
    .toUpperCase()
    .match(/[A-Z0-9]/g);
  if (!chars || chars.length === 0) return /a^/;

  const pattern = chars.map(escapeRegex).join("[^A-Za-z0-9]*");
  return new RegExp(`(?:^|[^A-Za-z0-9])(${pattern})(?=$|[^A-Za-z0-9])`, "g");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scoreHeadingLineMatch(line: string, headerKey: string): number {
  const compact = line.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (compact === headerKey) return 3;

  const words = line.match(/[A-Za-z0-9]+/g) ?? [];
  const firstWord = words[0]?.toLowerCase() ?? "";
  if (firstWord && canonicalHeaderKey(firstWord) === headerKey) {
    return looksLikeHeadingLead(line, words) ? 2 : 0;
  }

  return 0;
}

function looksLikeHeadingLead(line: string, words: string[]): boolean {
  const firstWord = words[0] ?? "";
  if (!firstWord) return false;

  if (line.trim() === firstWord) return true;
  if (firstWord.toUpperCase() === firstWord && firstWord.length > 2) return true;

  return false;
}

function isSubsequenceInOrder(source: string[], extracted: string[]): boolean {
  // Every header that appears in extracted should appear in the same relative
  // order as in source. We accept that extraction may miss some headers
  // (formatting variance), but the ones present must be in order.
  let i = 0;
  for (const h of extracted) {
    while (i < source.length && source[i] !== h) i++;
    if (i >= source.length) return false;
    i++;
  }
  return true;
}

// Two-column layouts often serialize as:
//   "Skills 2024 - Present Python TensorFlow CTO ACME — led growth"
// where a sidebar dates collision shows up as a date pattern immediately
// followed by non-date words without a newline. The signal we look for is
// a YYYY-YYYY or "Mon YYYY - Mon YYYY" pattern directly adjacent to a
// non-date capitalized token on the same line.
const SUSPICIOUS_DATE_COLLISION =
  /(\b\d{4}\s*[–-]\s*(?:Present|Current|\d{4}))\s+[A-Z][A-Za-z]{4,}\s+[A-Z]/;

function detectDateTextCollisions(text: string): ParseabilityArtifact[] {
  const lines = text.split("\n");
  const hits: ParseabilityArtifact[] = [];
  for (const line of lines) {
    if (line.length < 30) continue;
    const m = line.match(SUSPICIOUS_DATE_COLLISION);
    if (m) {
      // Confirm this is a problem: a date directly followed by what looks
      // like a different section's content (uppercase-led tokens that don't
      // form a natural sentence continuation).
      hits.push({
        kind: "date_text_collision",
        detail: `A date range is followed by capitalized tokens with no separator — typical of a two-column layout being read row-by-row.`,
        sample: line.slice(0, 200),
      });
      if (hits.length >= 3) break;
    }
  }
  return hits;
}

// A skill cluster looks like 3+ short comma-separated tokens (often
// title-cased acronyms / proper nouns). The real two-column merge signal
// is a cluster appearing in a paragraph that ALSO has a date range — i.e.
// inside an Experience-block paragraph (which would have role-dates) rather
// than in a standalone Skills section (which doesn't have dates). The
// earlier heuristic (role-verbs alone) tripped on standalone skills lists
// adjacent to experience after newline collapsing.
const SKILL_CLUSTER =
  /(?:[A-Z][A-Za-z+/\-]{1,12}(?:,\s*|\s*·\s*|\s*\|\s*)){3,}[A-Z][A-Za-z+/\-]{1,12}/;
const PARAGRAPH_DATE_RE =
  /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{4}\s*[–-]\s*(?:Present|Current|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{4})/i;

function detectSkillClusterInExperience(text: string): ParseabilityArtifact[] {
  const paragraphs = text.split(/\n\s*\n/);
  const hits: ParseabilityArtifact[] = [];
  for (const p of paragraphs) {
    if (!SKILL_CLUSTER.test(p)) continue;
    if (!PARAGRAPH_DATE_RE.test(p)) continue;
    const skillMatch = p.match(SKILL_CLUSTER);
    if (skillMatch) {
      hits.push({
        kind: "skill_cluster_in_experience",
        detail: `A short comma-separated token cluster (looks like a Skills sidebar) appears in the same paragraph as a role-date range. Two-column layouts can produce this when the parser interleaves sidebar Skills into an Experience block.`,
        sample: skillMatch[0].slice(0, 200),
      });
      if (hits.length >= 2) break;
    }
  }
  return hits;
}

// ─── Auto-fix: deterministic header normalization ──────────────────────

/**
 * Deterministic header rename pairs applied by `normalizeResumeHeaders`.
 * Order matters — earlier patterns win when a header could match multiple.
 * Each pattern is matched case-insensitive against the FULL trimmed header
 * (anchored on both sides with ^/$).
 */
const HEADER_NORMALIZATIONS: Array<{ pattern: RegExp; canonical: string }> = [
  // Summary variants
  { pattern: /^(?:professional|executive|career)\s+summary$/i, canonical: "Summary" },
  { pattern: /^summary\s+of\s+qualifications$/i, canonical: "Summary" },
  // Experience variants
  { pattern: /^(?:professional|work|relevant|career)\s+experience$/i, canonical: "Experience" },
  { pattern: /^employment\s+history$/i, canonical: "Experience" },
  // Skills variants
  { pattern: /^technical\s+skills$/i, canonical: "Skills" },
  { pattern: /^core\s+(?:skills|competencies)$/i, canonical: "Skills" },
  { pattern: /^competencies$/i, canonical: "Skills" },
  { pattern: /^tech\s+toolkit$/i, canonical: "Skills" },
  // Education variants
  { pattern: /^education\s*&\s*training$/i, canonical: "Education" },
  { pattern: /^academic\s+background$/i, canonical: "Education" },
  // Clearances variants ("Clearances & Eligibility", "Clearances & Auth", etc.)
  // → just "Clearances" which IS in the ATS-friendly set.
  { pattern: /^clearances?\s*(?:&|\band\b)\s*(?:eligibility|authoriz\w*|status)$/i, canonical: "Clearances" },
  { pattern: /^(?:security|federal)\s+clearance(?:s)?$/i, canonical: "Clearances" },
  // Certifications variants
  { pattern: /^certifications?\s*(?:&|\band\b)\s*(?:awards?|recognition|honors?)$/i, canonical: "Certifications" },
  { pattern: /^licenses?\s*(?:&|\band\b)\s*certifications?$/i, canonical: "Certifications" },
  { pattern: /^credentials$/i, canonical: "Certifications" },
];

/**
 * Apply deterministic header renames to a resume markdown string. Rewrites
 * any `## Heading` line whose text matches a known non-canonical variant
 * to its canonical equivalent. No LLM — pure string ops, instant, $0.
 *
 * Returns the rewritten markdown PLUS a list of changes applied so the
 * caller can show "renamed 'Tech Toolkit' → 'Skills'" feedback.
 */
export function normalizeResumeHeaders(markdown: string): {
  output: string;
  changes: Array<{ from: string; to: string; lineIndex: number }>;
} {
  const lines = markdown.split("\n");
  const changes: Array<{ from: string; to: string; lineIndex: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(##\s+)(.+?)\s*$/);
    if (!m) continue;
    const prefix = m[1];
    const headerText = m[2].trim();
    for (const { pattern, canonical } of HEADER_NORMALIZATIONS) {
      if (pattern.test(headerText)) {
        if (headerText !== canonical) {
          lines[i] = `${prefix}${canonical}`;
          changes.push({ from: headerText, to: canonical, lineIndex: i });
        }
        break;
      }
    }
  }
  return { output: lines.join("\n"), changes };
}
