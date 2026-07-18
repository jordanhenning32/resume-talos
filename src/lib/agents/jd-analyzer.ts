import { z } from "zod";
import { callObject } from "@/lib/models/call";

export const SeniorityLevel = z.enum([
  "intern",
  "entry",
  "mid",
  "senior",
  "staff_principal",
  "manager",
  "senior_manager",
  "director",
  "vp",
  "c_level",
  "unspecified",
]);
export type SeniorityLevel = z.infer<typeof SeniorityLevel>;

export const JdAnalysisSchema = z.object({
  companyName: z
    .string()
    .nullish()
    .describe("Company / hiring org name if discoverable in the JD. Null if unclear."),
  roleTitle: z
    .string()
    .describe("The role title as written in the JD (e.g. 'VP, Federal Services Delivery')."),
  seniorityLevel: SeniorityLevel.describe(
    "Best-fit seniority bucket inferred from the title + responsibilities + reporting structure described.",
  ),
  teamFunction: z
    .string()
    .nullish()
    .describe(
      "The functional area / team (e.g. 'Federal Services Delivery', 'Engineering — Platform', 'Growth Marketing'). Null if not stated.",
    ),
  locationMode: z
    .enum(["remote", "hybrid", "onsite", "unspecified"])
    .describe("Work location mode if specified in the JD."),
  primaryLocation: z
    .string()
    .nullish()
    .describe("Primary city / region if specified. Null if remote-only or unspecified."),
  mustHaveSkills: z
    .array(z.string())
    .describe(
      "Hard requirements explicitly listed or implied as deal-breakers. Use 2-6 word phrases (e.g. 'multi-year federal program management', 'P&L ownership'). Aim for 10-15 entries for a well-written JD; cap yourself at 20.",
    ),
  niceToHaveSkills: z
    .array(z.string())
    .describe(
      "Preferred / bonus / nice-to-have skills. Same phrasing convention. Aim for 5-10 entries; cap yourself at 15.",
    ),
  experienceYears: z
    .object({
      min: z.number().nullish(),
      max: z.number().nullish(),
      domain: z.string().nullish().describe("Domain the experience requirement applies to, if any."),
    })
    .describe("Explicit years-of-experience requirements, if mentioned."),
  successSignals: z
    .array(z.string())
    .describe(
      "Phrases or behaviors the JD says will make someone successful in the role. These are the implicit cultural/performance markers — usually different from skills. e.g. 'comfortable presenting to C-suite', 'thrives in 0-to-1 ambiguity', 'leads by influence not authority'. Aim for up to 10 entries.",
    ),
  keyLanguagePatterns: z
    .array(z.string())
    .describe(
      "Distinctive vocabulary the JD uses that an AI screener may key on. Capture EXACT wording from the JD where possible — verbatim phrases the resume can naturally echo. e.g. 'federal civilian agency', 'cross-functional alignment', 'multi-cloud posture'. Aim for up to 15 entries.",
    ),
  responsibilities: z
    .array(z.string())
    .describe(
      "The 5-10 most important responsibilities described in the JD. Short imperative phrases (e.g. 'Own portfolio P&L for federal services delivery'). Aim for up to 15 entries.",
    ),
  redFlags: z
    .array(z.string())
    .describe(
      "Anything in the JD that's a yellow/red flag for the candidate side — unrealistic scope, vague mission, missing comp, demanded hours, recent layoffs hinted at, etc. Empty array if nothing notable. Aim for up to 8 entries.",
    ),
  compensationSignal: z
    .string()
    .nullish()
    .describe("Compensation info if explicitly stated (range, equity, etc.). Null otherwise."),
  oneSentenceSummary: z
    .string()
    .describe(
      "One sentence (target 40-280 characters) that captures what this role IS — what someone hired into it will do.",
    ),
});

export type JdAnalysis = z.infer<typeof JdAnalysisSchema>;

const SYSTEM_PROMPT = `You are the JD Analyzer for Resume Talos, a multi-agent system that produces tailored resumes and cover letters.

Your job: read a raw job description and extract a strict, structured analysis that downstream agents (fit scorer, retriever, writer, reviewer) will key on.

Hard rules:
- Do not invent. Only extract what the JD says or strongly implies.
- Prefer JD's exact wording for keyLanguagePatterns — that's the signal a writer will echo back.
- Distinguish hard requirements from preferences. If unclear, err toward niceToHave.
- For seniority, use both title and described responsibilities. A "Senior Manager" with director-level scope reports as director. A "Director" with IC scope reports as senior.
- For redFlags, surface things the candidate would want to know: vague mission, unreasonable scope, missing comp, hour expectations, "wear many hats" warning signs.
- If a field has no signal in the JD, use the null / empty-array escape per the schema. Don't pad.`;

export async function analyzeJobDescription(opts: {
  jdText: string;
  applicationId?: string;
}): Promise<{ analysis: JdAnalysis; costUsd: number; runId: string }> {
  const result = await callObject<JdAnalysis>({
    role: "jd_analyzer",
    agentName: "jd_analyzer",
    applicationId: opts.applicationId,
    system: SYSTEM_PROMPT,
    prompt: `Job description follows. Extract the structured analysis.

---
${opts.jdText}
---`,
    schema: JdAnalysisSchema,
    maxOutputTokens: 12000,
  });
  return { analysis: result.object, costUsd: result.costUsd, runId: result.runId };
}
