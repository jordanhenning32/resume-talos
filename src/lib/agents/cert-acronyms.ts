/**
 * Known cert/acronym pairs. ATS scanners often search for one form or the
 * other — different vendors index different ways. Including BOTH the
 * acronym and the expansion in the resume is the cheapest hedge against
 * scanner variance.
 *
 * Coverage is intentionally focused on the spaces this candidate base
 * actually applies into: federal civilian + DoD, cybersecurity, project
 * management, common cloud certs. Not exhaustive — add more as needed.
 */

export type CertAcronym = {
  acronym: string;
  expansion: string;
  /** Other spellings/abbreviations that should also match the acronym. */
  aliases?: string[];
  category: "federal" | "security" | "pm" | "tech" | "clearance";
  /** Optional short note shown to the writer (when needed for disambiguation). */
  note?: string;
};

export const CERT_ACRONYMS: CertAcronym[] = [
  // Federal compliance / authorization
  {
    acronym: "FedRAMP",
    expansion: "Federal Risk and Authorization Management Program",
    category: "federal",
  },
  {
    acronym: "ATO",
    expansion: "Authority to Operate",
    category: "federal",
  },
  {
    acronym: "ATC",
    expansion: "Authority to Connect",
    category: "federal",
  },
  {
    acronym: "C&A",
    expansion: "Certification and Accreditation",
    aliases: ["C and A"],
    category: "federal",
  },
  {
    acronym: "RMF",
    expansion: "Risk Management Framework",
    category: "federal",
    note: "Refers to NIST 800-37 process.",
  },
  {
    acronym: "FISMA",
    expansion: "Federal Information Security Management Act",
    category: "federal",
  },
  {
    acronym: "NIST",
    expansion: "National Institute of Standards and Technology",
    category: "federal",
  },
  {
    acronym: "POA&M",
    expansion: "Plan of Action and Milestones",
    aliases: ["POAM"],
    category: "federal",
  },
  {
    acronym: "STIG",
    expansion: "Security Technical Implementation Guide",
    category: "federal",
  },
  {
    acronym: "DISA",
    expansion: "Defense Information Systems Agency",
    category: "federal",
  },
  {
    acronym: "ISSO",
    expansion: "Information System Security Officer",
    category: "federal",
  },
  {
    acronym: "ISSM",
    expansion: "Information System Security Manager",
    category: "federal",
  },

  // Federal acquisition / PM
  {
    acronym: "FAC-P/PM",
    expansion: "Federal Acquisition Certification — Program and Project Managers",
    aliases: [
      "FAC P/PM",
      "FAC-P/PM-I",
      "FAC-P/PM-II",
      "FAC-P/PM-III",
      "FAC-P/PM-IT",
      "FAC P/PM IT",
      "FAC/PPM-IT",
      "FAC PPM IT",
    ],
    category: "pm",
  },
  {
    acronym: "FAC-COR",
    expansion: "Federal Acquisition Certification for Contracting Officer's Representatives",
    aliases: ["FAC COR"],
    category: "pm",
  },
  {
    acronym: "DAWIA",
    expansion: "Defense Acquisition Workforce Improvement Act",
    category: "pm",
  },

  // Federal contract vehicles (acronym usually wins, but expansion shows up in some screens)
  {
    acronym: "GSA MAS",
    expansion: "General Services Administration Multiple Award Schedule",
    aliases: ["GSA Schedule"],
    category: "federal",
  },
  {
    acronym: "STARS III",
    expansion: "Streamlined Technology Acquisition Resources for Services III",
    category: "federal",
  },
  {
    acronym: "8(a)",
    expansion: "8(a) Business Development Program",
    aliases: ["8a"],
    category: "federal",
  },
  {
    acronym: "OASIS",
    expansion: "One Acquisition Solution for Integrated Services",
    category: "federal",
  },
  {
    acronym: "SEWP",
    expansion: "Solutions for Enterprise-Wide Procurement",
    category: "federal",
  },
  {
    acronym: "CIO-SP3",
    expansion: "Chief Information Officer — Solutions and Partners 3",
    aliases: ["CIO SP3"],
    category: "federal",
  },

  // Clearances (acronyms are searched both ways)
  {
    acronym: "TS",
    expansion: "Top Secret",
    category: "clearance",
  },
  {
    acronym: "SCI",
    expansion: "Sensitive Compartmented Information",
    category: "clearance",
  },
  {
    acronym: "TS/SCI",
    expansion: "Top Secret with Sensitive Compartmented Information",
    aliases: ["TS-SCI"],
    category: "clearance",
  },
  {
    acronym: "DoD Secret",
    expansion: "Department of Defense Secret clearance",
    category: "clearance",
  },
  {
    acronym: "Public Trust",
    expansion: "Public Trust position designation",
    category: "clearance",
  },

  // Cyber/security certifications
  {
    acronym: "CISSP",
    expansion: "Certified Information Systems Security Professional",
    category: "security",
  },
  {
    acronym: "CISM",
    expansion: "Certified Information Security Manager",
    category: "security",
  },
  {
    acronym: "CISA",
    expansion: "Certified Information Systems Auditor",
    category: "security",
  },
  {
    acronym: "CEH",
    expansion: "Certified Ethical Hacker",
    category: "security",
  },
  {
    acronym: "OSCP",
    expansion: "Offensive Security Certified Professional",
    category: "security",
  },
  {
    acronym: "Security+",
    expansion: "CompTIA Security+",
    category: "security",
  },
  {
    acronym: "CASP+",
    expansion: "CompTIA Advanced Security Practitioner",
    category: "security",
  },

  // PM
  {
    acronym: "PMP",
    expansion: "Project Management Professional",
    category: "pm",
  },
  {
    acronym: "PgMP",
    expansion: "Program Management Professional",
    category: "pm",
  },
  {
    acronym: "PfMP",
    expansion: "Portfolio Management Professional",
    category: "pm",
  },
  {
    acronym: "CSM",
    expansion: "Certified ScrumMaster",
    category: "pm",
  },
  {
    acronym: "CSPO",
    expansion: "Certified Scrum Product Owner",
    category: "pm",
  },
  {
    acronym: "SAFe",
    expansion: "Scaled Agile Framework",
    category: "pm",
  },
  {
    acronym: "ITIL",
    expansion: "Information Technology Infrastructure Library",
    category: "pm",
  },

  // Cloud (high-frequency in tech roles)
  {
    acronym: "AWS SAA",
    expansion: "AWS Certified Solutions Architect — Associate",
    category: "tech",
  },
  {
    acronym: "AWS SAP",
    expansion: "AWS Certified Solutions Architect — Professional",
    category: "tech",
  },
  {
    acronym: "GCP PCA",
    expansion: "Google Cloud Professional Cloud Architect",
    category: "tech",
  },
  {
    acronym: "AZ-104",
    expansion: "Microsoft Azure Administrator",
    category: "tech",
  },
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Match an acronym precisely. Word-boundary aware (preserves "ATO" in "ATOs" but not "RATO"). */
function makeAcronymRegex(form: string): RegExp {
  // Some acronyms contain non-word chars (8(a), C&A, AZ-104). For those,
  // use simple includes() — \b doesn't work cleanly around punctuation.
  return /^[\w-]+$/.test(form)
    ? new RegExp(`\\b${escapeRegex(form)}\\b`, "i")
    : new RegExp(escapeRegex(form), "i");
}

/**
 * Return every CertAcronym whose acronym (or one of its aliases) OR
 * expansion appears in `text`. Used to detect which certs are relevant
 * for a given JD so the writer only sees a focused reference list.
 */
export function findRelevantCerts(text: string): CertAcronym[] {
  const lower = text.toLowerCase();
  return CERT_ACRONYMS.filter((cert) => {
    const acronymHit =
      makeAcronymRegex(cert.acronym).test(text) ||
      (cert.aliases ?? []).some((a) => makeAcronymRegex(a).test(text));
    const expansionHit = lower.includes(cert.expansion.toLowerCase());
    return acronymHit || expansionHit;
  });
}

/**
 * Render a focused CERT REFERENCE block for the writer's prompt. Only
 * includes certs detected in this JD, sorted by category. The writer is
 * told via its system prompt that whenever it mentions one form, it must
 * include the other.
 */
export function renderCertReferenceBlock(certs: CertAcronym[]): string {
  if (certs.length === 0) return "";
  const byCategory = new Map<CertAcronym["category"], CertAcronym[]>();
  for (const c of certs) {
    const arr = byCategory.get(c.category) ?? [];
    arr.push(c);
    byCategory.set(c.category, arr);
  }
  const categoryLabels: Record<CertAcronym["category"], string> = {
    federal: "Federal compliance / vehicles",
    clearance: "Clearances",
    security: "Security certifications",
    pm: "Program / project management",
    tech: "Cloud / tech certifications",
  };
  const lines: string[] = [];
  for (const cat of ["federal", "clearance", "security", "pm", "tech"] as const) {
    const items = byCategory.get(cat);
    if (!items || items.length === 0) continue;
    lines.push(`## ${categoryLabels[cat]}`);
    for (const c of items) {
      const note = c.note ? `  — ${c.note}` : "";
      lines.push(`- **${c.acronym}** = ${c.expansion}${note}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

/**
 * Convenience: scan all the text-bearing fields of a JD analysis to find
 * the certs that this specific JD references. The writer doesn't have raw
 * JD text in its options today, so we use the analyzer's extracted fields
 * which capture the high-value JD vocabulary anyway.
 */
export function findCertsForJd(opts: {
  mustHaveSkills?: string[];
  niceToHaveSkills?: string[];
  keyLanguagePatterns?: string[];
  responsibilities?: string[];
  successSignals?: string[];
  oneSentenceSummary?: string;
  roleTitle?: string;
}): CertAcronym[] {
  const haystack = [
    opts.oneSentenceSummary ?? "",
    opts.roleTitle ?? "",
    ...(opts.mustHaveSkills ?? []),
    ...(opts.niceToHaveSkills ?? []),
    ...(opts.keyLanguagePatterns ?? []),
    ...(opts.responsibilities ?? []),
    ...(opts.successSignals ?? []),
  ].join("\n");
  return findRelevantCerts(haystack);
}
