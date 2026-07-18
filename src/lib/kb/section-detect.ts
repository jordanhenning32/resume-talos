export type SectionContext = {
  company: string;
  role?: string;
  startDate?: string;
  endDate?: string;
  charStart: number;
  charEnd: number;
};

type Line = {
  text: string;
  start: number;
  end: number;
};

const DATE_RANGE_RE =
  /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?(\d{4})\s*(?:-|to|\u2013|\u2014)\s*((?:present|current)|(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?\d{4})/i;
const SEP_RE = /\s*(?:\||\u00b7)\s*/;
const MONTHS: Record<string, string> = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12",
};

export function detectResumeSections(text: string): SectionContext[] {
  const lines = toLines(text);
  const sections: SectionContext[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const clean = stripMarkdown(line.text);
    if (!clean) continue;

    const oneLine = parseSeparatedHeader(clean);
    if (oneLine) {
      sections.push({ ...oneLine, charStart: line.start, charEnd: text.length });
      continue;
    }

    const markdownHeading = line.text.match(/^#{2,4}\s+(.+)$/);
    if (markdownHeading) {
      const title = markdownHeading[1].trim();
      const nearbyDate = findDate(lines, i + 1, 3);
      if (!nearbyDate) continue;
      const parsedTitle = parseRoleCompany(title) ?? parseSeparatedTitle(title);
      sections.push({
        company: parsedTitle?.company ?? title,
        role: parsedTitle?.role,
        startDate: nearbyDate.startDate,
        endDate: nearbyDate.endDate,
        charStart: line.start,
        charEnd: text.length,
      });
      continue;
    }

    const roleCompany = parseRoleCompany(clean);
    if (roleCompany) {
      const nearbyDate = findDate(lines, i + 1, 1);
      if (!nearbyDate) continue;
      sections.push({
        ...roleCompany,
        startDate: nearbyDate.startDate,
        endDate: nearbyDate.endDate,
        charStart: line.start,
        charEnd: text.length,
      });
    }
  }

  const deduped = dedupe(sections.filter(isPlausibleSection)).sort(
    (a, b) => a.charStart - b.charStart,
  );
  for (let i = 0; i < deduped.length; i++) {
    deduped[i].charEnd = deduped[i + 1]?.charStart ?? text.length;
  }
  return deduped;
}

function toLines(text: string): Line[] {
  const out: Line[] = [];
  let cursor = 0;
  for (const raw of text.split(/\n/)) {
    const start = cursor;
    const end = start + raw.length;
    out.push({ text: raw.trim(), start, end });
    cursor = end + 1;
  }
  return out;
}

function stripMarkdown(line: string): string {
  return line.replace(/^#{1,6}\s+/, "").replace(/\*\*/g, "").trim();
}

function parseSeparatedHeader(line: string): Omit<SectionContext, "charStart" | "charEnd"> | null {
  const parts = line.split(SEP_RE).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 3) return null;
  const date = parseDateRange(parts[2]);
  if (!date) return null;
  const title = parseSeparatedTitle(line) ?? { company: parts[0], role: parts[1] };
  return {
    company: title?.company ?? parts[0],
    role: title?.role ?? parts[1],
    startDate: date.startDate,
    endDate: date.endDate,
  };
}

function parseSeparatedTitle(title: string): { company: string; role?: string } | null {
  const parts = title.split(SEP_RE).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  if (isStateCode(parts[1]) || isCityState(parts[1])) return null;
  if (parts.length >= 3 && DATE_RANGE_RE.test(parts[2])) {
    return inferSeparatedRoleCompany(parts[0], parts[1]);
  }
  return { role: parts[0], company: parts[1] };
}

function inferSeparatedRoleCompany(first: string, second: string): { company: string; role?: string } {
  const firstLooksRole = looksLikeRoleTitle(first);
  const secondLooksRole = looksLikeRoleTitle(second);
  if (firstLooksRole && !secondLooksRole) return { role: first, company: second };
  if (secondLooksRole && !firstLooksRole) return { role: second, company: first };
  return { role: first, company: second };
}

function looksLikeRoleTitle(value: string): boolean {
  return /\b(chief|director|manager|lead|specialist|engineer|developer|analyst|architect|officer|consultant|president|owner|product|program|project|designer|administrator)\b/i.test(
    value,
  );
}

function parseRoleCompany(line: string): { company: string; role?: string } | null {
  const at = line.match(/^(.{2,100}?)\s+at\s+(.{2,100}?)$/i);
  if (at) return { role: at[1].trim(), company: at[2].trim() };

  const comma = line.match(/^(.{2,100}?),\s+(.{2,100}?)$/);
  if (comma && isStateCode(comma[2].trim())) return null;
  if (comma) return { role: comma[1].trim(), company: comma[2].trim() };

  return null;
}

function findDate(
  lines: Line[],
  startIndex: number,
  maxDistance: number,
): { startDate?: string; endDate?: string } | null {
  const max = Math.min(lines.length - 1, startIndex + maxDistance - 1);
  for (let i = startIndex; i <= max; i++) {
    const parsed = parseDateRange(lines[i].text);
    if (parsed) return parsed;
  }
  return null;
}

function parseDateRange(line: string): { startDate?: string; endDate?: string } | null {
  const match = line.match(DATE_RANGE_RE);
  if (!match) return null;
  const end = match[3];
  return {
    startDate: normalizeDate(match[2], match[1]),
    endDate: end.toLowerCase().startsWith("present") || end.toLowerCase().startsWith("current")
      ? "present"
      : normalizeDate(end.match(/\d{4}/)?.[0], end.match(/[A-Za-z]+\.?/)?.[0]),
  };
}

function normalizeDate(year: string | undefined, month: string | undefined): string | undefined {
  if (!year) return undefined;
  const monthKey = month?.replace(/\./g, "").trim().toLowerCase();
  const monthNumber = monthKey ? MONTHS[monthKey] : undefined;
  return monthNumber ? `${year}-${monthNumber}` : year;
}

export function isPlausibleSection(section: Pick<SectionContext, "company" | "role">): boolean {
  return isPlausibleSectionValue(section.company) && (
    section.role === undefined || isPlausibleSectionValue(section.role)
  );
}

function isPlausibleSectionValue(value: string): boolean {
  const clean = value.trim();
  return clean.length >= 2 && !/[.:]$/.test(clean) && !/[:\u2013\u2014]/.test(clean);
}

function isStateCode(value: string): boolean {
  return /^[A-Z]{2}$/.test(value.trim());
}

function isCityState(value: string): boolean {
  return /^[A-Z][A-Za-z .'-]+,\s*[A-Z]{2}$/.test(value.trim());
}

function dedupe(sections: SectionContext[]): SectionContext[] {
  const seen = new Set<string>();
  const out: SectionContext[] = [];
  for (const section of sections) {
    const key = [
      section.company.toLowerCase(),
      section.role?.toLowerCase() ?? "",
      section.startDate ?? "",
      section.endDate ?? "",
      section.charStart,
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(section);
  }
  return out;
}
