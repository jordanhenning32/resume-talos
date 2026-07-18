import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { kbFacts } from "@/db/schema";

export type CanonicalCareerRole = {
  company: string;
  role: string;
  startDate: string | null;
  endDate: string | null;
  displayDate: string;
  factIds: string[];
  evidenceQuotes: string[];
};

type RoleFactRow = {
  id: string;
  content: string;
  evidenceQuote: string | null;
  metadata: Record<string, unknown> | null;
};

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * Loads dated role facts and folds duplicates into one authoritative role
 * header option. This block is intentionally independent of semantic
 * retrieval: employment chronology is source-of-truth context, not a
 * relevance-ranked fact that can be dropped when a JD query points elsewhere.
 */
export async function getCanonicalCareerTimeline(): Promise<CanonicalCareerRole[]> {
  const rows = (await db()
    .select({
      id: kbFacts.id,
      content: kbFacts.content,
      evidenceQuote: kbFacts.evidenceQuote,
      metadata: kbFacts.metadata,
    })
    .from(kbFacts)
    .where(
      and(
        eq(kbFacts.factType, "role"),
        sql`${kbFacts.metadata}->>'company' IS NOT NULL`,
        sql`${kbFacts.metadata}->>'role' IS NOT NULL`,
        sql`(${kbFacts.metadata}->>'startDate' IS NOT NULL OR ${kbFacts.metadata}->>'endDate' IS NOT NULL)`,
      ),
    )) as RoleFactRow[];

  const grouped = new Map<string, CanonicalCareerRole>();
  for (const row of rows) {
    const meta = row.metadata ?? {};
    const company = stringValue(meta.company);
    const role = stringValue(meta.role);
    if (!company || !role) continue;

    const startDate = stringValue(meta.startDate);
    const endDate = stringValue(meta.endDate);
    if (!startDate && !endDate) continue;

    const key = `${companyKey(company)}::${titleKey(role)}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        company,
        role,
        startDate,
        endDate,
        displayDate: displayDate(startDate, endDate),
        factIds: [row.id],
        evidenceQuotes: row.evidenceQuote ? [row.evidenceQuote] : [],
      });
      continue;
    }

    existing.startDate = pickEarliestDate(existing.startDate, startDate);
    existing.endDate = pickLatestDate(existing.endDate, endDate);
    existing.displayDate = displayDate(existing.startDate, existing.endDate);
    existing.factIds.push(row.id);
    if (row.evidenceQuote) existing.evidenceQuotes.push(row.evidenceQuote);

    // Prefer the more specific title/company spelling when duplicates differ.
    if (role.length > existing.role.length) existing.role = role;
    if (company.length > existing.company.length) existing.company = company;
  }

  return Array.from(grouped.values()).sort(compareRoles);
}

export function renderCareerTimelineForPrompt(
  roles: CanonicalCareerRole[],
): string {
  if (roles.length === 0) return "";
  const lines: string[] = [];
  lines.push("# CANONICAL CAREER TIMELINE - source of truth for Experience headers");
  lines.push("");
  lines.push(
    "Use ONLY these rows for Experience role headings. Copy the title, company, and dates exactly as shown. Retrieved KB facts may add bullets under the matching company, but they may NOT override these dates.",
  );
  lines.push(
    "Resume heading format: ### <Title> · <Company> · <Dates> using the values from one row below.",
  );
  lines.push("");
  for (const role of roles) {
    lines.push(
      `- [${role.factIds.join(", ")}] ${role.role} | ${role.company} | ${role.displayDate}`,
    );
    const evidence = role.evidenceQuotes[0];
    if (evidence) lines.push(`  Evidence: "${evidence}"`);
  }
  return lines.join("\n");
}

export function sameCompanyName(a: string, b: string): boolean {
  const aKeys = companyKeys(a);
  const bKeys = companyKeys(b);
  for (const key of aKeys) {
    if (bKeys.has(key)) return true;
  }
  return false;
}

export function roleTitlesCompatible(candidate: string, canonical: string): boolean {
  const candidateKey = titleKey(candidate);
  const canonicalKey = titleKey(canonical);
  if (!candidateKey || !canonicalKey) return false;
  if (candidateKey === canonicalKey) return true;

  const shorter =
    candidateKey.length < canonicalKey.length ? candidateKey : canonicalKey;
  const longer =
    candidateKey.length < canonicalKey.length ? canonicalKey : candidateKey;
  if (shorter.length >= 10 && longer.includes(shorter)) return true;

  const candidateWords = titleWords(candidate);
  const canonicalWords = titleWords(canonical);
  return (
    candidateWords.length >= 2 &&
    candidateWords.every((word) => canonicalWords.includes(word))
  );
}

export function datesCompatible(
  candidate: string,
  canonical: CanonicalCareerRole,
): boolean {
  const candidateKey = normalizeDateText(candidate);
  return careerDateVariants(canonical).some(
    (variant) => normalizeDateText(variant) === candidateKey,
  );
}

export function careerDateVariants(role: CanonicalCareerRole): string[] {
  const variants = new Set<string>();
  const start = role.startDate;
  const end = role.endDate;
  const startDisplay = formatDate(start);
  const endDisplay = formatDate(end);

  variants.add(role.displayDate);
  if (startDisplay && endDisplay) {
    variants.add(`${startDisplay} to ${endDisplay}`);
    variants.add(`${startDisplay}-${endDisplay}`);
  }
  if (start && end) {
    variants.add(`${start} to ${end}`);
    variants.add(`${start}-${end}`);
  }
  if (startDisplay && !endDisplay) variants.add(startDisplay);
  if (endDisplay && !startDisplay) variants.add(`through ${endDisplay}`);

  // Accept year-only granularity. A resume that writes "2022–2025" is not
  // inaccurate against a canonical "Jan 2022 to Apr 2025" — it's just less
  // precise. Derive the year variants from the canonical years so a wrong
  // year (e.g. "2020–2025") still fails to match.
  const startYear = yearToken(start);
  const endYear = yearToken(end);
  if (startYear && endYear) {
    variants.add(`${startYear} to ${endYear}`);
    variants.add(`${startYear}-${endYear}`);
  }
  if (startYear && !endYear) variants.add(startYear);
  if (endYear && !startYear) variants.add(`through ${endYear}`);
  return Array.from(variants);
}

function displayDate(startDate: string | null, endDate: string | null): string {
  const start = formatDate(startDate);
  const end = formatDate(endDate);
  if (start && end) return `${start} to ${end}`;
  if (start) return start;
  if (end) return `through ${end}`;
  return "dates unavailable";
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const lower = value.trim().toLowerCase();
  if (["present", "current", "now"].includes(lower)) return "Present";
  const yearMonth = lower.match(/^(\d{4})-(\d{2})$/);
  if (yearMonth) {
    const monthIndex = Number(yearMonth[2]) - 1;
    const month = MONTHS[monthIndex];
    return month ? `${month} ${yearMonth[1]}` : value;
  }
  if (/^\d{4}$/.test(lower)) return lower;
  return value.trim();
}

// Year-only token for a canonical date. Canonical rows store the start/end in
// mixed formats — ISO ("2016-09"), display ("Jan 2022"), or bare year ("2025") —
// so match the first 4-digit run anywhere, not just at the front.
function yearToken(value: string | null): string | null {
  if (!value) return null;
  const lower = value.trim().toLowerCase();
  if (["present", "current", "now"].includes(lower)) return "present";
  const match = lower.match(/(\d{4})/);
  return match ? match[1] : null;
}

function normalizeDateText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, " to ")
    .replace(/\s+-\s+/g, " to ")
    .replace(/\bcurrent\b|\bnow\b/g, "present")
    .replace(/\bjanuary\b/g, "jan")
    .replace(/\bfebruary\b/g, "feb")
    .replace(/\bmarch\b/g, "mar")
    .replace(/\bapril\b/g, "apr")
    .replace(/\bmay\b/g, "may")
    .replace(/\bjune\b/g, "jun")
    .replace(/\bjuly\b/g, "jul")
    .replace(/\baugust\b/g, "aug")
    .replace(/\bseptember\b|\bsept\b/g, "sep")
    .replace(/\boctober\b/g, "oct")
    .replace(/\bnovember\b/g, "nov")
    .replace(/\bdecember\b/g, "dec")
    .replace(/[,()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function pickEarliestDate(
  current: string | null,
  candidate: string | null,
): string | null {
  if (!current) return candidate;
  if (!candidate) return current;
  return dateSortValue(candidate) < dateSortValue(current) ? candidate : current;
}

function pickLatestDate(
  current: string | null,
  candidate: string | null,
): string | null {
  if (!current) return candidate;
  if (!candidate) return current;
  return dateSortValue(candidate) > dateSortValue(current) ? candidate : current;
}

function compareRoles(a: CanonicalCareerRole, b: CanonicalCareerRole): number {
  const aEnd = dateSortValue(a.endDate ?? a.startDate);
  const bEnd = dateSortValue(b.endDate ?? b.startDate);
  if (aEnd !== bEnd) return bEnd - aEnd;
  return dateSortValue(b.startDate) - dateSortValue(a.startDate);
}

function dateSortValue(value: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const lower = value.toLowerCase();
  if (["present", "current", "now"].includes(lower)) return 999912;
  const match = lower.match(/^(\d{4})(?:-(\d{2}))?/);
  if (!match) return Number.NEGATIVE_INFINITY;
  return Number(match[1]) * 100 + Number(match[2] ?? "12");
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function titleWords(value: string): string[] {
  return (value.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (word) => !["and", "the", "of", "for"].includes(word),
  );
}

function titleKey(value: string): string {
  return titleWords(value).join("");
}

function companyKey(value: string): string {
  // Fold known aliases (e.g. "SSA" ≡ "Social Security Administration") to one
  // key so a single job doesn't split into duplicate timeline rows.
  const normalized = normalizeCompany(value);
  return COMPANY_ALIAS_KEYS.get(normalized) ?? normalized;
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
  ["SSA", "Social Security Administration", "Social Security", "Office of Hearings Operations"],
  ["VA", "Department of Veterans Affairs"],
  ["CMS", "Centers for Medicare and Medicaid Services"],
  ["GDIT", "General Dynamics IT"],
  ["MTD", "MTD Products"],
  ["US Army", "U.S. Army"],
];

const COMPANY_ALIAS_KEYS = buildCompanyAliasKeys();

function buildCompanyAliasKeys(): Map<string, string> {
  const out = new Map<string, string>();
  COMPANY_ALIAS_GROUPS.forEach((forms, index) => {
    for (const form of forms) out.set(normalizeCompany(form), `alias:${index}`);
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
  for (const form of value.match(/\b[A-Z0-9]{2,5}\b/g) ?? []) add(form);
  return keys;
}
