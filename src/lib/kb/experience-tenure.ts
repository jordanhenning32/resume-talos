import type { VerifierOutput } from "@/lib/agents/verifier";

export const TOTAL_EXPERIENCE_YEARS = 17;
export const LEADERSHIP_EXPERIENCE_YEARS = 9;

const LEADERSHIP_PATTERNS = [
  /\bleadership\b/i,
  /\bleader\b/i,
  /\bleading\b/i,
  /\bexecutive\b/i,
  /\bsupervisory\b/i,
  /\bsupervisor\b/i,
  /\bgs-1[34]\b/i,
  /\bmanager-of-managers\b/i,
  /\bdirect reports\b/i,
  /\bpeople management\b/i,
  /\bteam management\b/i,
  /\bmanagement experience\b/i,
  /\bmanag(?:ed|ing)\s+(?:teams|staff|people|direct reports)\b/i,
] as const;

export function renderExperienceTenureRulesForPrompt(): string {
  return [
    "# CANONICAL EXPERIENCE TENURE RULES - do not stretch these numbers",
    "",
    `- Total federal IT / SSA experience: ${TOTAL_EXPERIENCE_YEARS} years.`,
    `- Federal IT leadership / GS-13-GS-14 equivalent leadership: ${LEADERSHIP_EXPERIENCE_YEARS}+ years.`,
    `- Correct phrasing: "${TOTAL_EXPERIENCE_YEARS} years total federal IT experience, including ${LEADERSHIP_EXPERIENCE_YEARS}+ years in federal IT leadership."`,
    `- Correct phrasing: "${LEADERSHIP_EXPERIENCE_YEARS}+ years federal IT leadership."`,
    `- Forbidden phrasing: "${TOTAL_EXPERIENCE_YEARS}+ years federal IT leadership", "${TOTAL_EXPERIENCE_YEARS}+ years leadership", "${TOTAL_EXPERIENCE_YEARS}-year arc leading...", or any wording that attaches ${TOTAL_EXPERIENCE_YEARS}+ years to leadership, management, supervisory, executive, or GS-13/14 experience.`,
  ].join("\n");
}

export function checkExperienceTenureClaims(
  markdown: string,
  doc: "resume" | "cover_letter",
): VerifierOutput["issuesFound"] {
  const issues: VerifierOutput["issuesFound"] = [];
  const text = markdown.replace(/\r\n/g, "\n");
  const yearRe = /\b(\d{1,2})(?:\s*\+?\s*years?|-year)\b/gi;

  for (const match of text.matchAll(yearRe)) {
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value <= LEADERSHIP_EXPERIENCE_YEARS) {
      continue;
    }
    const index = match.index ?? 0;
    const context = contextAround(text, index, 160);
    const lower = context.toLowerCase();
    if (!LEADERSHIP_PATTERNS.some((pattern) => pattern.test(lower))) continue;
    if (hasCorrectLeadershipQualifier(lower)) continue;

    issues.push({
      doc,
      severity: "critical",
      quote: context,
      location: doc === "resume" ? "Experience/Summary" : "Cover letter",
      reason: `Unsupported because: ${value}+ years may describe total federal IT/SSA experience, but KB caps federal IT leadership at ${LEADERSHIP_EXPERIENCE_YEARS}+ years. Rewrite as "${TOTAL_EXPERIENCE_YEARS} years total federal IT experience, including ${LEADERSHIP_EXPERIENCE_YEARS}+ years in leadership" or just "${LEADERSHIP_EXPERIENCE_YEARS}+ years federal IT leadership."`,
    });
  }

  return issues;
}

function hasCorrectLeadershipQualifier(context: string): boolean {
  const seventeenAttachedToLeadership =
    /\b17(?:\s*\+?\s*years?|-year)\b(?:(?!\b(?:including|with)\b).){0,80}\b(leading|leadership|management|manager|managing|supervisory|executive)\b/i;
  if (seventeenAttachedToLeadership.test(context)) return false;

  const nineYearLeadership =
    /\b9\s*\+?\s*years?\b.{0,100}\b(leadership|management|manager|supervisory|gs-13|gs-14)\b/i;
  const leadershipNineYear =
    /\b(leadership|management|manager|supervisory|gs-13|gs-14)\b.{0,100}\b9\s*\+?\s*years?\b/i;
  const seventeenTotal =
    /\b17(?:\s*\+?\s*years?|-year)\b.{0,100}\b(total|overall|federal it experience|federal it delivery|ssa experience|benefits domain)\b/i;
  const totalSeventeen =
    /\b(total|overall)\b.{0,40}\b17(?:\s*\+?\s*years?|-year)\b/i;
  const seventeenIncludingNineLeadership =
    /\b17(?:\s*\+?\s*years?|-year)\b.{0,140}\b(including|with)\b.{0,80}\b9\s*\+?\s*years?\b.{0,80}\b(leadership|management|manager|supervisory|gs-13|gs-14)\b/i;
  return (
    (nineYearLeadership.test(context) || leadershipNineYear.test(context)) &&
    (seventeenTotal.test(context) ||
      totalSeventeen.test(context) ||
      seventeenIncludingNineLeadership.test(context))
  );
}

function contextAround(text: string, index: number, span: number): string {
  const sentenceStart = text.lastIndexOf(".", index);
  const newlineStart = text.lastIndexOf("\n", index);
  const start = Math.max(0, sentenceStart + 1, newlineStart + 1, index - span);
  const nextPeriod = text.indexOf(".", index);
  const nextNewline = text.indexOf("\n", index);
  const candidates = [nextPeriod, nextNewline]
    .filter((value) => value >= 0)
    .map((value) => value + 1);
  const end = Math.min(
    text.length,
    candidates.length > 0 ? Math.min(...candidates) : index + span,
  );
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}
