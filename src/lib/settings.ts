import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";

export type WriterDirectives = {
  personalSite?: {
    url: string;
    label: string;
    placement: {
      resume: string;
      coverLetter: string;
    };
  };
  /**
   * Static contact info that should appear in the resume header AND the
   * cover-letter contact block on every generation. These are not KB facts
   * (they don't change per role) — they're hard requirements the writers
   * must include verbatim.
   */
  contact?: {
    /** Display phone, e.g. "555-555-0100". */
    phone?: string;
    /** Display location, e.g. "York, PA". */
    location?: string;
    /** Display email, e.g. "jordan@jordanhenning.com". */
    email?: string;
  };
  voice: {
    tense: string;
    pronoun: string;
    metricsBias: string;
  };
  globalRules: string[];
};

export const DEFAULT_WRITER_DIRECTIVES: WriterDirectives = {
  personalSite: {
    url: "https://jordanhenning.com",
    label: "jordanhenning.com",
    placement: {
      resume:
        "Include in the resume header contact block, prominently. Format as bare " +
        "'jordanhenning.com' (no protocol), alongside email, phone, and city/state. " +
        "This is a high-signal asset — recruiters should be funneled here for project " +
        "deep-dives and the full portfolio.",
      coverLetter:
        "Reference once in the closing paragraph as a CTA. When a per-application " +
        "token URL is available, prefer the tokened form: " +
        "'View materials tailored to this role at jordanhenning.com/r/{token}'. " +
        "Otherwise fall back to the bare URL.",
    },
  },
  contact: {
    phone: "555-555-0100",
    location: "York, PA",
    email: "jordan@jordanhenning.com",
  },
  voice: {
    tense: "past for prior roles, present for current",
    pronoun: "first-person implicit (resume bullets and cover letter — no leading 'I')",
    metricsBias:
      "lead with quantified outcomes when present in the KB; never invent a number",
  },
  globalRules: [
    "Every factual claim must trace to a KB fact (verifier enforces this).",
    "Never invent dates, metrics, technologies, or organizations.",
    "Match JD vocabulary naturally — no keyword-stuffing.",
    "Bias resume length to one page unless the user picked 'long' variant.",
    "Cover letter targets 250-350 words unless explicitly told otherwise.",
  ],
};

const WRITER_DIRECTIVES_KEY = "writer_directives";

export async function getWriterDirectives(): Promise<WriterDirectives> {
  const [row] = await db()
    .select()
    .from(settings)
    .where(eq(settings.key, WRITER_DIRECTIVES_KEY))
    .limit(1);
  if (!row) return DEFAULT_WRITER_DIRECTIVES;
  // Merge with defaults so newly-added fields (e.g. contact block) get
  // populated for rows that were saved before the field existed. Saved
  // values take precedence for everything already present.
  const saved = row.value as Partial<WriterDirectives>;
  return {
    ...DEFAULT_WRITER_DIRECTIVES,
    ...saved,
    contact: {
      ...DEFAULT_WRITER_DIRECTIVES.contact,
      ...(saved.contact ?? {}),
    },
    voice: {
      ...DEFAULT_WRITER_DIRECTIVES.voice,
      ...(saved.voice ?? {}),
    },
    personalSite: saved.personalSite ?? DEFAULT_WRITER_DIRECTIVES.personalSite,
    globalRules: saved.globalRules ?? DEFAULT_WRITER_DIRECTIVES.globalRules,
  };
}

export async function setWriterDirectives(value: WriterDirectives): Promise<void> {
  await db()
    .insert(settings)
    .values({ key: WRITER_DIRECTIVES_KEY, value })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: new Date() },
    });
}

export async function seedDefaultsIfMissing(): Promise<void> {
  const [existing] = await db()
    .select()
    .from(settings)
    .where(eq(settings.key, WRITER_DIRECTIVES_KEY))
    .limit(1);
  if (existing) return;
  await setWriterDirectives(DEFAULT_WRITER_DIRECTIVES);
}
