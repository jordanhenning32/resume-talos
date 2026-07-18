/**
 * Parse the resume markdown produced by the Resume Writer into a structured
 * shape that layout renderers can consume. The writer's output is consistent:
 *   # Name
 *   <contact line>
 *
 *   ## Summary
 *   <paragraph>
 *
 *   ## Experience
 *   ### Title · Company · Dates
 *   - bullet
 *   - bullet
 *
 *   ## Skills
 *   <bullets or paragraph>
 *
 *   ## Certifications / Education / etc.
 */

export type ResumeRole = {
  title: string;
  company: string | null;
  dates: string | null;
  bullets: string[];
};

export type ResumeSection = {
  heading: string;
  paragraphs: string[];
  bullets: string[];
};

export type ParsedResume = {
  name: string;
  contactLine: string;
  summary: string | null;
  experience: ResumeRole[];
  /** Sections beyond Experience (Skills, Education, Certifications, etc.) */
  otherSections: ResumeSection[];
};

const ROLE_SEPARATOR_RE = /\s+[·•|]\s+|\s+—\s+|\s+-\s+/;

export function parseResumeMarkdown(markdown: string): ParsedResume {
  const normalized = markdown.replace(/\r\n/g, "\n").trim();
  const lines = normalized.split("\n");

  let name = "Jordan Henning";
  let contactLine = "";
  let summary: string | null = null;
  const experience: ResumeRole[] = [];
  const otherSections: ResumeSection[] = [];

  let currentH2: string | null = null;
  let currentH2Section: ResumeSection | null = null;
  let currentRole: ResumeRole | null = null;
  let currentParagraphBuffer: string[] = [];

  const flushParagraphIntoCurrent = () => {
    if (currentParagraphBuffer.length === 0) return;
    const para = currentParagraphBuffer.join(" ").trim();
    currentParagraphBuffer = [];
    if (!para) return;
    if (currentH2 === "Summary" && summary === null) {
      summary = para;
      return;
    }
    if (currentH2Section) {
      currentH2Section.paragraphs.push(para);
    }
  };

  const flushSection = () => {
    flushParagraphIntoCurrent();
    if (currentRole) {
      experience.push(currentRole);
      currentRole = null;
    }
    if (currentH2Section && currentH2 !== "Experience" && currentH2 !== "Summary") {
      if (
        currentH2Section.paragraphs.length > 0 ||
        currentH2Section.bullets.length > 0
      ) {
        otherSections.push(currentH2Section);
      }
    }
    currentH2Section = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();

    if (line.startsWith("# ") && !line.startsWith("## ")) {
      name = line.replace(/^#\s+/, "").trim();
      // The next non-blank line is typically the contact line.
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === "") j++;
      if (j < lines.length && !lines[j].startsWith("#")) {
        contactLine = lines[j].trim();
        i = j;
      }
      continue;
    }

    if (line.startsWith("## ")) {
      flushSection();
      currentH2 = line.replace(/^##\s+/, "").trim();
      currentH2Section = {
        heading: currentH2,
        paragraphs: [],
        bullets: [],
      };
      continue;
    }

    if (line.startsWith("### ")) {
      // New role within Experience (or similar)
      if (currentH2 === "Experience") {
        flushParagraphIntoCurrent();
        if (currentRole) experience.push(currentRole);
        const headerText = line.replace(/^###\s+/, "").trim();
        currentRole = parseRoleHeader(headerText);
      }
      continue;
    }

    if (line === "") {
      flushParagraphIntoCurrent();
      continue;
    }

    // Bullet
    if (/^[-*•]\s+/.test(line)) {
      const bullet = line.replace(/^[-*•]\s+/, "").trim();
      if (currentRole) {
        currentRole.bullets.push(bullet);
      } else if (currentH2Section) {
        currentH2Section.bullets.push(bullet);
      }
      continue;
    }

    // Plain text — accumulate as paragraph.
    currentParagraphBuffer.push(line);
  }

  flushSection();

  return { name, contactLine, summary, experience, otherSections };
}

function parseRoleHeader(header: string): ResumeRole {
  // Common shapes:
  //   "Chief Growth Officer · Quadratic Digital · Present"
  //   "Branch Chief, Hearings Office IT Oversight · Social Security Administration · Jan 2022 – Apr 2025"
  //   "IT Project Manager — SSA — 2016–2022"
  const parts = header.split(ROLE_SEPARATOR_RE).map((s) => s.trim());
  const [title, company, dates] = [
    parts[0] ?? header,
    parts[1] ?? null,
    parts[2] ?? null,
  ];
  return { title, company, dates, bullets: [] };
}

/**
 * Cover letter is simpler — just split paragraphs.
 */
export function parseCoverLetterMarkdown(markdown: string): {
  greeting: string | null;
  paragraphs: string[];
  signOff: string;
  name: string;
} {
  const normalized = markdown.replace(/\r\n/g, "\n").trim();
  const blocks = normalized
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  let greeting: string | null = null;
  let signOff = "Sincerely,";
  let name = "Jordan Henning";

  if (blocks.length > 0 && /^(Dear|Hello|Hi|Hiring)/i.test(blocks[0])) {
    greeting = blocks.shift() ?? null;
  }

  // Pull off final 1-2 blocks if they look like a signoff.
  if (blocks.length >= 2) {
    const lastTwo = blocks.slice(-2);
    if (/^(Sincerely|Regards|Best|Thank)/i.test(lastTwo[0])) {
      signOff = lastTwo[0];
      name = lastTwo[1];
      blocks.splice(-2, 2);
    } else if (/^(Sincerely|Regards|Best|Thank)/i.test(lastTwo[1])) {
      // Sometimes the model puts "Sincerely, Jordan Henning" as one block at end.
      const finalBlock = blocks.pop()!;
      const lines = finalBlock.split("\n");
      signOff = lines[0] ?? signOff;
      name = lines.slice(1).join(" ").trim() || name;
    }
  } else if (blocks.length === 1 && /Sincerely/i.test(blocks[0])) {
    // Edge case: short letter with signoff inline. Leave as-is.
  }

  return { greeting, paragraphs: blocks, signOff, name };
}
