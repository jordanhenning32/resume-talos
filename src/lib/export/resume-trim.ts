export type ResumeTrimChange =
  | {
      kind: "bullet";
      section: string;
      text: string;
    }
  | {
      kind: "role";
      heading: string;
    }
  | {
      kind: "section";
      heading: string;
    }
  | {
      kind: "summary_sentence";
      text: string;
    };

export type ResumeTrimSummary = {
  removedBullets: number;
  removedRoles: number;
  removedSections: number;
  removedSummarySentences: number;
  wordCountBefore: number;
  wordCountAfter: number;
};

export type ResumeTrimContext = {
  variant: "short" | "long";
  roleTitle?: string | null;
  keywords?: string[];
};

type SectionSpan = {
  heading: string;
  start: number;
  end: number;
};

type RoleSpan = {
  heading: string;
  roleIndex: number;
  start: number;
  end: number;
  bulletCount: number;
};

type BulletLine = {
  lineIndex: number;
  text: string;
  section: string;
  roleIndex: number | null;
  bulletIndex: number;
};

export function summarizeResumeTrimChanges(
  before: string,
  after: string,
  changes: ResumeTrimChange[],
): ResumeTrimSummary {
  return {
    removedBullets: changes.filter((change) => change.kind === "bullet").length,
    removedRoles: changes.filter((change) => change.kind === "role").length,
    removedSections: changes.filter((change) => change.kind === "section").length,
    removedSummarySentences: changes.filter(
      (change) => change.kind === "summary_sentence",
    ).length,
    wordCountBefore: countWords(before),
    wordCountAfter: countWords(after),
  };
}

export function trimResumeMarkdownOneStep(
  markdown: string,
  context: ResumeTrimContext,
): { output: string; change: ResumeTrimChange } | null {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const index = buildMarkdownIndex(lines);
  const keywordTokens = buildKeywordTokens(context);

  const bulletChange = removeLowestValueBullet(lines, index, keywordTokens, context);
  if (bulletChange) return bulletChange;

  const roleChange = removeLowestValueRole(lines, index, keywordTokens);
  if (roleChange) return roleChange;

  const sectionChange = removeLowestValueSection(lines, index, keywordTokens);
  if (sectionChange) return sectionChange;

  return removeSummaryTailSentence(lines, index, keywordTokens);
}

function buildMarkdownIndex(lines: string[]): {
  sections: SectionSpan[];
  roles: RoleSpan[];
  bullets: BulletLine[];
} {
  const sections: SectionSpan[] = [];
  const roles: RoleSpan[] = [];
  const bullets: BulletLine[] = [];
  let currentSection: SectionSpan | null = null;
  let currentRole: RoleSpan | null = null;
  const roleBulletCounts = new Map<number, number>();

  const closeCurrentRole = (end: number) => {
    if (!currentRole) return;
    currentRole.end = end;
    currentRole.bulletCount = roleBulletCounts.get(currentRole.roleIndex) ?? 0;
    roles.push(currentRole);
    currentRole = null;
  };

  const closeCurrentSection = (end: number) => {
    closeCurrentRole(end);
    if (!currentSection) return;
    currentSection.end = end;
    sections.push(currentSection);
    currentSection = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^##\s+/.test(line)) {
      closeCurrentSection(i);
      currentSection = {
        heading: line.replace(/^##\s+/, "").trim(),
        start: i,
        end: lines.length,
      };
      continue;
    }

    if (/^###\s+/.test(line) && currentSection?.heading === "Experience") {
      closeCurrentRole(i);
      currentRole = {
        heading: line.replace(/^###\s+/, "").trim(),
        roleIndex: roles.length,
        start: i,
        end: lines.length,
        bulletCount: 0,
      };
      continue;
    }

    if (/^[-*\u2022]\s+/.test(line)) {
      const text = line.replace(/^[-*\u2022]\s+/, "").trim();
      const roleIndex = currentRole?.roleIndex ?? null;
      const bulletIndex =
        roleIndex == null
          ? bullets.filter((b) => b.section === currentSection?.heading).length
          : roleBulletCounts.get(roleIndex) ?? 0;
      if (roleIndex != null) {
        roleBulletCounts.set(roleIndex, bulletIndex + 1);
      }
      bullets.push({
        lineIndex: i,
        text,
        section: currentSection?.heading ?? "",
        roleIndex,
        bulletIndex,
      });
    }
  }

  closeCurrentSection(lines.length);
  return { sections, roles, bullets };
}

function removeLowestValueBullet(
  lines: string[],
  index: ReturnType<typeof buildMarkdownIndex>,
  keywordTokens: Set<string>,
  context: ResumeTrimContext,
): { output: string; change: ResumeTrimChange } | null {
  const roleCounts = new Map<number, number>();
  for (const bullet of index.bullets) {
    if (bullet.roleIndex == null) continue;
    roleCounts.set(bullet.roleIndex, (roleCounts.get(bullet.roleIndex) ?? 0) + 1);
  }

  const candidates = index.bullets
    .filter((bullet) => {
      if (isProtectedText(bullet.text)) return false;
      const section = normalizeHeading(bullet.section);
      if (section === "skills" || section === "education") return false;
      if (section === "certifications" || section === "clearances") return false;
      if (bullet.roleIndex == null) return true;

      const minBullets = minBulletsForRole(bullet.roleIndex, context.variant);
      return (roleCounts.get(bullet.roleIndex) ?? 0) > minBullets;
    })
    .map((bullet) => ({
      bullet,
      keepScore: scoreBulletKeepValue(bullet, keywordTokens),
    }))
    .sort((a, b) => a.keepScore - b.keepScore);

  const selected = candidates[0]?.bullet;
  if (!selected) return null;

  const next = removeLineRange(lines, selected.lineIndex, selected.lineIndex + 1);
  return {
    output: cleanupMarkdown(next).join("\n").trim(),
    change: {
      kind: "bullet",
      section: selected.section,
      text: selected.text,
    },
  };
}

function removeLowestValueRole(
  lines: string[],
  index: ReturnType<typeof buildMarkdownIndex>,
  keywordTokens: Set<string>,
): { output: string; change: ResumeTrimChange } | null {
  const candidates = index.roles
    .filter((role) => role.roleIndex >= 3 || (role.roleIndex >= 2 && role.bulletCount === 0))
    .filter((role) => !isProtectedText(lines.slice(role.start, role.end).join(" ")))
    .map((role) => ({
      role,
      keepScore: roleKeepValue(lines.slice(role.start, role.end).join(" "), keywordTokens),
    }))
    .sort((a, b) => a.keepScore - b.keepScore);

  const selected = candidates[0]?.role;
  if (!selected) return null;

  const next = removeLineRange(lines, selected.start, selected.end);
  return {
    output: cleanupMarkdown(next).join("\n").trim(),
    change: {
      kind: "role",
      heading: selected.heading,
    },
  };
}

function removeLowestValueSection(
  lines: string[],
  index: ReturnType<typeof buildMarkdownIndex>,
  keywordTokens: Set<string>,
): { output: string; change: ResumeTrimChange } | null {
  const candidates = index.sections
    .filter((section) => isOptionalSection(section.heading))
    .filter((section) => !isProtectedText(lines.slice(section.start, section.end).join(" ")))
    .map((section) => ({
      section,
      keepScore: sectionKeepValue(
        section.heading,
        lines.slice(section.start, section.end).join(" "),
        keywordTokens,
      ),
    }))
    .sort((a, b) => a.keepScore - b.keepScore);

  const selected = candidates[0]?.section;
  if (!selected) return null;

  const next = removeLineRange(lines, selected.start, selected.end);
  return {
    output: cleanupMarkdown(next).join("\n").trim(),
    change: {
      kind: "section",
      heading: selected.heading,
    },
  };
}

function removeSummaryTailSentence(
  lines: string[],
  index: ReturnType<typeof buildMarkdownIndex>,
  keywordTokens: Set<string>,
): { output: string; change: ResumeTrimChange } | null {
  const summary = index.sections.find(
    (section) => normalizeHeading(section.heading) === "summary",
  );
  if (!summary) return null;

  const bodyStart = summary.start + 1;
  const bodyEnd = summary.end;
  const rawBody = lines.slice(bodyStart, bodyEnd).join(" ").trim();
  const sentences = splitSentences(rawBody);
  if (sentences.length <= 2) return null;

  const candidates = sentences
    .map((sentence, index) => ({ sentence, index }))
    .filter(({ sentence }) => !isProtectedText(sentence))
    .map((item) => ({
      ...item,
      keepScore: textKeepValue(item.sentence, keywordTokens) + (item.index === 0 ? 50 : 0),
    }))
    .sort((a, b) => a.keepScore - b.keepScore);

  const selected = candidates[0];
  if (!selected) return null;

  const remaining = sentences
    .filter((_, i) => i !== selected.index)
    .join(" ")
    .trim();
  const next = [...lines.slice(0, bodyStart), remaining, ...lines.slice(bodyEnd)];
  return {
    output: cleanupMarkdown(next).join("\n").trim(),
    change: {
      kind: "summary_sentence",
      text: selected.sentence,
    },
  };
}

function scoreBulletKeepValue(bullet: BulletLine, keywordTokens: Set<string>): number {
  const section = normalizeHeading(bullet.section);
  let score = textKeepValue(bullet.text, keywordTokens);

  if (section === "experience") {
    score += 45;
    score += Math.max(0, 24 - (bullet.roleIndex ?? 0) * 8);
    if (bullet.bulletIndex === 0) score += 10;
  } else if (section === "projects") {
    score += 20;
  } else if (section === "awards" || section === "publications") {
    score += 12;
  } else {
    score += 8;
  }

  if (wordCount(bullet.text) > 34) score -= 8;
  return score;
}

function textKeepValue(text: string, keywordTokens: Set<string>): number {
  const tokens = tokenize(text);
  let score = 0;
  for (const token of tokens) {
    if (keywordTokens.has(token)) score += 6;
  }
  if (/\d/.test(text)) score += 10;
  if (/\$|%|x\b|times?\b|million|portfolio|clearance|citizen/i.test(text)) {
    score += 8;
  }
  if (wordCount(text) <= 24) score += 4;
  return score;
}

function roleKeepValue(text: string, keywordTokens: Set<string>): number {
  return textKeepValue(text, keywordTokens) + 20;
}

function sectionKeepValue(
  heading: string,
  text: string,
  keywordTokens: Set<string>,
): number {
  const normalized = normalizeHeading(heading);
  const base =
    normalized === "volunteer"
      ? 5
      : normalized === "awards"
        ? 8
        : normalized === "publications"
          ? 10
          : normalized === "projects"
            ? 18
            : 12;
  return base + textKeepValue(text, keywordTokens);
}

function minBulletsForRole(roleIndex: number, variant: "short" | "long"): number {
  if (variant === "short") {
    if (roleIndex === 0) return 2;
    if (roleIndex === 1) return 1;
    return 0;
  }
  if (roleIndex === 0) return 3;
  if (roleIndex === 1) return 2;
  return 1;
}

function isOptionalSection(heading: string): boolean {
  const h = normalizeHeading(heading);
  return (
    h === "projects" ||
    h === "publications" ||
    h === "awards" ||
    h === "volunteer" ||
    h === "languages" ||
    h === "interests"
  );
}

function isProtectedText(text: string): boolean {
  return /\b(citizen|citizenship|clearance|public trust|secret|top secret|ts\/sci|work authorization|authorized to work|green card|permanent resident|degree|b\.a\.|b\.s\.|m\.b\.a\.|certification|certified|fac-p\/pm|pmp|security\+|cissp)\b/i.test(
    text,
  );
}

function buildKeywordTokens(context: ResumeTrimContext): Set<string> {
  const source = [
    context.roleTitle ?? "",
    ...(context.keywords ?? []),
  ].join(" ");
  return new Set(tokenize(source).filter((token) => token.length >= 4));
}

function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z][a-z0-9+./-]{2,}/g);
  if (!matches) return [];
  return matches.filter((token) => !STOPWORDS.has(token));
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function removeLineRange(lines: string[], start: number, end: number): string[] {
  return [...lines.slice(0, start), ...lines.slice(end)];
}

function cleanupMarkdown(lines: string[]): string[] {
  const out: string[] = [];
  let blankRun = 0;
  for (const line of lines) {
    if (line.trim() === "") {
      blankRun++;
      if (blankRun <= 1) out.push("");
      continue;
    }
    blankRun = 0;
    out.push(line.trimEnd());
  }
  while (out.length > 0 && out[0].trim() === "") out.shift();
  while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();
  return out;
}

function countWords(text: string): number {
  return wordCount(text);
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function normalizeHeading(heading: string): string {
  return heading.trim().toLowerCase().replace(/\s*&\s*/g, " and ");
}

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "into",
  "over",
  "that",
  "this",
  "those",
  "their",
  "your",
  "role",
  "manager",
  "specialist",
  "senior",
]);
