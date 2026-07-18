import type { LayoutId } from "@/lib/export/layouts/types";

export type AtsVendor =
  | "workday"
  | "greenhouse"
  | "lever"
  | "taleo"
  | "icims"
  | "usajobs"
  | "smartrecruiters"
  | "workable"
  | "ashby"
  | "successfactors"
  | "oracle_hcm"
  | "adp"
  | "bamboohr"
  | "personio"
  | "jobvite"
  | "unknown";

export type AtsRiskLevel = "low" | "medium" | "high" | "critical";

export type VendorWarning = {
  rule: string;
  why: string;
};

export type AtsVendorRules = {
  vendor: AtsVendor;
  displayName: string;
  riskLevel: AtsRiskLevel;
  /** Layouts that this vendor's parser handles cleanly. */
  recommendedLayouts: LayoutId[];
  /** Layouts that empirically scramble in this vendor's parser. */
  discouragedLayouts: LayoutId[];
  warnings: VendorWarning[];
};

export type AtsVendorDetection = {
  vendor: AtsVendor;
  displayName: string;
  matchedDomain: string | null;
  /** "high" = exact domain pattern; "low" = no URL or no recognized pattern. */
  confidence: "high" | "low";
  rules: AtsVendorRules;
};

/**
 * URL signatures for each ATS. Ordered most-specific-first so a sub-pattern
 * doesn't win over a parent pattern (e.g. Oracle's white-labeled Taleo URLs
 * are matched as Oracle HCM before falling through to Taleo).
 */
const VENDOR_PATTERNS: Array<{ vendor: AtsVendor; patterns: RegExp[] }> = [
  {
    vendor: "workday",
    patterns: [
      /myworkdayjobs\.com/i,
      /\.wd\d+\.myworkdayjobs\.com/i,
      /\bworkday\.com/i,
    ],
  },
  {
    vendor: "greenhouse",
    patterns: [
      /boards\.greenhouse\.io/i,
      /\.greenhouse\.io\/jobs/i,
      /\bgrnh\.se\b/i,
    ],
  },
  {
    vendor: "lever",
    patterns: [/jobs\.lever\.co/i, /\.lever\.co\/postings/i],
  },
  {
    vendor: "ashby",
    patterns: [/jobs\.ashbyhq\.com/i, /\bashbyhq\.com/i],
  },
  {
    vendor: "smartrecruiters",
    patterns: [/jobs\.smartrecruiters\.com/i, /\bsmartrecruiters\.com/i],
  },
  {
    vendor: "workable",
    patterns: [/apply\.workable\.com/i, /\bworkable\.com\/j/i],
  },
  {
    vendor: "usajobs",
    patterns: [/usajobs\.gov/i],
  },
  {
    vendor: "icims",
    patterns: [/\.icims\.com/i, /careers-[a-z0-9-]+\.icims\.com/i],
  },
  {
    vendor: "successfactors",
    patterns: [/successfactors\.com/i, /\bsapsf\.com/i],
  },
  {
    vendor: "oracle_hcm",
    patterns: [
      /oraclecloud\.com\/hcm/i,
      /\.oraclecloud\.com\/job/i,
    ],
  },
  {
    vendor: "taleo",
    patterns: [/\.taleo\.net/i, /\.tal\.net/i, /\btaleo\.com/i],
  },
  {
    vendor: "adp",
    patterns: [/workforcenow\.adp\.com/i, /\.adp\.com\/[a-z]*recruit/i],
  },
  {
    vendor: "bamboohr",
    patterns: [/\.bamboohr\.com\/(?:careers|jobs)/i, /bamboohr\.com\/careers/i],
  },
  {
    vendor: "personio",
    patterns: [/\.personio\.(?:de|com)\/jobs/i, /\bpersonio\.(?:de|com)/i],
  },
  {
    vendor: "jobvite",
    patterns: [/jobs\.jobvite\.com/i, /jobvite\.com\/p\//i],
  },
];

/**
 * Vendor rule sets. Each entry encodes:
 *   - the parser's overall risk level (how often it mangles formatting)
 *   - which of our 3 layouts to recommend / avoid
 *   - 2-7 specific quirks the writer/exporter should respect
 *
 * Sources: vendor docs (where public), recruiter community guides, and
 * known parser behaviors reported by candidates over years. Conservative
 * — when in doubt, prefer single-column.
 */
const VENDOR_RULES: Record<AtsVendor, AtsVendorRules> = {
  workday: {
    vendor: "workday",
    displayName: "Workday",
    riskLevel: "high",
    recommendedLayouts: ["classic", "executive"],
    discouragedLayouts: ["modern-two-column"],
    warnings: [
      {
        rule: "Single column only",
        why: "Workday's parser merges multi-column layouts into a text blob and loses section order.",
      },
      {
        rule: "Standard bullets (• or -)",
        why: "Custom unicode glyphs sometimes drop or substitute as the wrong character.",
      },
      {
        rule: "No tables",
        why: "Tables are flattened into unstructured text; column relationships are lost.",
      },
      {
        rule: "No headers / footers",
        why: "Repeated content can be parsed as duplicate data and downgrade keyword density.",
      },
      {
        rule: "ATS-safe fonts only (Helvetica, Arial, Times)",
        why: "Custom fonts can prevent text extraction entirely on stricter Workday configurations.",
      },
      {
        rule: "Standard section names (Summary, Experience, Education, Skills)",
        why: "Workday's parser keys off these literal headers to populate the candidate profile.",
      },
      {
        rule: "Cover letter handled separately",
        why: "Workday typically has a dedicated cover letter upload; don't expect the cover to be scanned alongside the resume.",
      },
    ],
  },
  taleo: {
    vendor: "taleo",
    displayName: "Taleo (Oracle)",
    riskLevel: "critical",
    recommendedLayouts: ["classic"],
    discouragedLayouts: ["modern-two-column", "executive"],
    warnings: [
      {
        rule: "Plain formatting only",
        why: "Taleo is one of the oldest enterprise ATS parsers still in wide use — it scrambles two-column layouts, tables, and complex headers.",
      },
      {
        rule: "Single column, no sidebars",
        why: "Sidebars get interleaved into experience bullets, producing unreadable candidate profiles.",
      },
      {
        rule: "No headers / footers",
        why: "Repeated content corrupts the parsed candidate record.",
      },
      {
        rule: ".docx often parses better than .pdf",
        why: "Counter-intuitively, Taleo can parse Word documents more reliably than PDFs on older deployments.",
      },
      {
        rule: "≤ 500 KB file size common",
        why: "Many Taleo configurations cap upload sizes at 500 KB–1 MB. The exported resume is well under, but worth knowing.",
      },
      {
        rule: "ATS-safe fonts only",
        why: "Custom font glyphs can drop entirely during text extraction.",
      },
    ],
  },
  successfactors: {
    vendor: "successfactors",
    displayName: "SAP SuccessFactors",
    riskLevel: "high",
    recommendedLayouts: ["classic"],
    discouragedLayouts: ["modern-two-column"],
    warnings: [
      {
        rule: "Single column, no fancy formatting",
        why: "Many SuccessFactors deployments use a Taleo-derived parser that scrambles multi-column layouts.",
      },
      {
        rule: "Avoid headers / footers",
        why: "Repeated content gets parsed as duplicate data.",
      },
      {
        rule: "Standard section names",
        why: "Parser keys on literal Summary / Experience / Education / Skills headers.",
      },
    ],
  },
  oracle_hcm: {
    vendor: "oracle_hcm",
    displayName: "Oracle Cloud HCM",
    riskLevel: "high",
    recommendedLayouts: ["classic"],
    discouragedLayouts: ["modern-two-column"],
    warnings: [
      {
        rule: "Plain formatting only",
        why: "Oracle HCM (and legacy Taleo-derived flows) struggle with complex layouts.",
      },
      {
        rule: "Single column",
        why: "Two-column layouts scramble; sidebar content gets interleaved with experience.",
      },
      {
        rule: "Standard fonts",
        why: "Custom fonts can fail to extract on older Oracle deployments.",
      },
    ],
  },
  usajobs: {
    vendor: "usajobs",
    displayName: "USAJobs (Federal)",
    riskLevel: "critical",
    recommendedLayouts: ["classic"],
    discouragedLayouts: ["modern-two-column"],
    warnings: [
      {
        rule: "Each announcement specifies its own page limit",
        why: "Federal positions typically require detailed work history with hours/week, salary, and supervisor info — pushing length up. Check the announcement; common caps are 2 or 5 pages.",
      },
      {
        rule: "Plain formatting only",
        why: "Federal HR systems are conservative — fancy formatting is a screening risk and can disqualify on certain announcements.",
      },
      {
        rule: "Required federal-specific sections",
        why: "Federal resumes typically need: citizenship status, hours-per-week per role, salary, supervisor contact, security clearance details. Most modern templates omit these.",
      },
      {
        rule: "Series + grade in every federal role",
        why: "If applying as VRA / Schedule A / transition, work history must list job series and grade for each prior federal role.",
      },
      {
        rule: "Resume Builder vs upload",
        why: "Many federal listings prefer the USAJobs Resume Builder (structured form) over an uploaded resume — structured fields map cleanly to the candidate profile.",
      },
    ],
  },
  icims: {
    vendor: "icims",
    displayName: "iCIMS",
    riskLevel: "medium",
    recommendedLayouts: ["classic", "executive"],
    discouragedLayouts: ["modern-two-column"],
    warnings: [
      {
        rule: "Single column preferred",
        why: "iCIMS handles most modern formatting, but two-column layouts can scramble on stricter configurations.",
      },
      {
        rule: "Standard fonts",
        why: "Custom fonts can break text extraction.",
      },
      {
        rule: "PDF preferred over DOCX",
        why: "DOCX parsing varies by iCIMS configuration; PDF is the more reliable format.",
      },
    ],
  },
  adp: {
    vendor: "adp",
    displayName: "ADP Workforce Now",
    riskLevel: "medium",
    recommendedLayouts: ["classic", "executive"],
    discouragedLayouts: ["modern-two-column"],
    warnings: [
      {
        rule: "Single column preferred",
        why: "ADP's parser is decent but column-aware extraction can fail on complex layouts.",
      },
      {
        rule: "PDF preferred",
        why: "DOCX styles can drop during parse.",
      },
    ],
  },
  jobvite: {
    vendor: "jobvite",
    displayName: "Jobvite",
    riskLevel: "medium",
    recommendedLayouts: ["classic", "executive"],
    discouragedLayouts: ["modern-two-column"],
    warnings: [
      {
        rule: "Single column preferred",
        why: "Jobvite parses modern formatting in most cases but two-column layouts can scramble.",
      },
    ],
  },
  greenhouse: {
    vendor: "greenhouse",
    displayName: "Greenhouse",
    riskLevel: "low",
    recommendedLayouts: ["classic", "executive", "modern-two-column"],
    discouragedLayouts: [],
    warnings: [
      {
        rule: "PDF preferred over DOCX",
        why: "Greenhouse's parser handles PDF cleanly; DOCX styles sometimes drop.",
      },
      {
        rule: "Cover letter handled separately",
        why: "Greenhouse usually has a dedicated cover-letter field — the file you upload as the resume is scanned alone.",
      },
      {
        rule: "Image-based PDFs fail",
        why: "Greenhouse does not OCR — make sure the PDF has selectable text (it does, as long as we don't accidentally rasterize).",
      },
    ],
  },
  lever: {
    vendor: "lever",
    displayName: "Lever",
    riskLevel: "low",
    recommendedLayouts: ["classic", "executive", "modern-two-column"],
    discouragedLayouts: [],
    warnings: [
      {
        rule: "PDF, modern formatting OK",
        why: "Lever's parser handles most formatting; stuffed keyword sections trigger downgrade.",
      },
      {
        rule: "Cover letter handled separately",
        why: "Lever typically has a separate cover-letter field; the resume PDF is parsed alone for profile data.",
      },
    ],
  },
  ashby: {
    vendor: "ashby",
    displayName: "Ashby",
    riskLevel: "low",
    recommendedLayouts: ["classic", "executive", "modern-two-column"],
    discouragedLayouts: [],
    warnings: [
      {
        rule: "PDF, AI-friendly parser",
        why: "Ashby uses an LLM-based parser — handles most layouts well; layout choice matters less than content quality.",
      },
    ],
  },
  smartrecruiters: {
    vendor: "smartrecruiters",
    displayName: "SmartRecruiters",
    riskLevel: "low",
    recommendedLayouts: ["classic", "executive", "modern-two-column"],
    discouragedLayouts: [],
    warnings: [
      {
        rule: "PDF, modern formatting OK",
        why: "SmartRecruiters is one of the more modern parsers; handles most formatting cleanly.",
      },
    ],
  },
  workable: {
    vendor: "workable",
    displayName: "Workable",
    riskLevel: "low",
    recommendedLayouts: ["classic", "executive", "modern-two-column"],
    discouragedLayouts: [],
    warnings: [
      {
        rule: "PDF, modern formatting OK",
        why: "Workable's parser is fairly forgiving for modern layouts.",
      },
    ],
  },
  bamboohr: {
    vendor: "bamboohr",
    displayName: "BambooHR",
    riskLevel: "low",
    recommendedLayouts: ["classic", "executive", "modern-two-column"],
    discouragedLayouts: [],
    warnings: [
      {
        rule: "PDF, modern formatting OK",
        why: "BambooHR focuses on small-to-midsize employers; parser is modern and forgiving.",
      },
    ],
  },
  personio: {
    vendor: "personio",
    displayName: "Personio",
    riskLevel: "low",
    recommendedLayouts: ["classic", "executive", "modern-two-column"],
    discouragedLayouts: [],
    warnings: [
      {
        rule: "PDF, modern formatting OK",
        why: "Personio is European-market focused and uses a modern parser.",
      },
    ],
  },
  unknown: {
    vendor: "unknown",
    displayName: "Unknown ATS",
    riskLevel: "medium",
    recommendedLayouts: ["classic", "executive"],
    discouragedLayouts: [],
    warnings: [
      {
        rule: "Default to single-column when unsure",
        why: "Without a recognized vendor signal, the safest assumption is a single-column, standard-formatting resume that any parser can read.",
      },
      {
        rule: "Paste a posting URL on the next application",
        why: "Adding the JD URL lets the system detect the target ATS automatically and surface vendor-specific guidance.",
      },
    ],
  },
};

export function detectAtsVendor(jdUrl: string | null | undefined): AtsVendorDetection {
  const url = (jdUrl ?? "").trim();
  if (!url) {
    return {
      vendor: "unknown",
      displayName: VENDOR_RULES.unknown.displayName,
      matchedDomain: null,
      confidence: "low",
      rules: VENDOR_RULES.unknown,
    };
  }
  for (const { vendor, patterns } of VENDOR_PATTERNS) {
    for (const re of patterns) {
      const m = url.match(re);
      if (m) {
        return {
          vendor,
          displayName: VENDOR_RULES[vendor].displayName,
          matchedDomain: m[0],
          confidence: "high",
          rules: VENDOR_RULES[vendor],
        };
      }
    }
  }
  return {
    vendor: "unknown",
    displayName: VENDOR_RULES.unknown.displayName,
    matchedDomain: extractHost(url),
    confidence: "low",
    rules: VENDOR_RULES.unknown,
  };
}

function extractHost(url: string): string | null {
  try {
    const u = new URL(url);
    return u.host;
  } catch {
    return null;
  }
}

/** Return advice for a chosen layout, given a vendor detection. */
export type LayoutAdvice = {
  recommended: boolean;
  discouraged: boolean;
  reason: string | null;
};

export function adviceForLayout(
  detection: AtsVendorDetection,
  layout: LayoutId,
): LayoutAdvice {
  const rules = detection.rules;
  const recommended = rules.recommendedLayouts.includes(layout);
  const discouraged = rules.discouragedLayouts.includes(layout);
  let reason: string | null = null;
  if (discouraged) {
    const w = rules.warnings.find((w) =>
      /single column|two-column|sidebar/i.test(w.rule + " " + w.why),
    );
    reason = w
      ? `${rules.displayName}: ${w.why}`
      : `${rules.displayName}'s parser is known to mangle this layout. Prefer ${rules.recommendedLayouts.map(layoutLabel).join(" or ")}.`;
  } else if (!recommended && rules.recommendedLayouts.length > 0) {
    reason = `${rules.displayName} hasn't been validated against this layout in the rule set. Safest choice: ${rules.recommendedLayouts.map(layoutLabel).join(" or ")}.`;
  }
  return { recommended, discouraged, reason };
}

function layoutLabel(id: LayoutId): string {
  switch (id) {
    case "classic":
      return "Classic";
    case "executive":
      return "Executive";
    case "modern-two-column":
      return "Modern Two-Column";
  }
}
