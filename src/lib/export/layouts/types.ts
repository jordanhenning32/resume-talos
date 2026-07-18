import type { ParsedResume } from "../parse-resume";

export type LayoutId = "classic" | "executive" | "modern-two-column";

export type LayoutDescriptor = {
  id: LayoutId;
  name: string;
  blurb: string;
  badge: string;
  tags: string[];
};

export const LAYOUTS: LayoutDescriptor[] = [
  {
    id: "classic",
    name: "Classic",
    blurb:
      "Single-column, conservative serif. 99% ATS-safe. The right call for federal primes and traditional services firms.",
    badge: "ATS-safe",
    tags: ["serif", "single-column", "conservative", "federal-friendly"],
  },
  {
    id: "executive",
    name: "Executive",
    blurb:
      "Single-column with elevated typography — sans-serif body, rule-lined section headers, dates flush right. Sized for senior/VP roles.",
    badge: "Senior / VP",
    tags: ["sans-serif", "single-column", "executive", "polished"],
  },
  {
    id: "modern-two-column",
    name: "Modern Two-Column",
    blurb:
      "Skills + certs + education in a left sidebar; experience in the main column. Visual standout for commercial / tech-services roles. Slight ATS risk.",
    badge: "Visual",
    tags: ["sans-serif", "two-column", "modern", "commercial"],
  },
];

export type ResumeInput = {
  resume: ParsedResume;
  /** Optional: raw markdown for fallback rendering. */
  rawMarkdown?: string;
};

/**
 * PDF document metadata to bake into the rendered <Document>. Workday +
 * Taleo (and others) read Title/Author/Subject when populating the
 * candidate profile, so we set them deliberately rather than letting the
 * PDF library default them.
 */
export type PdfDocumentMeta = {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
};
