import { z } from "zod";
import { callObject } from "@/lib/models/call";
import { factTypeValues } from "@/db/schema";
import type { SectionContext } from "@/lib/kb/section-detect";

const factTypeEnum = z.enum(factTypeValues);

const MetricSchema = z.object({
  label: z.string().describe("e.g. 'revenue impact', 'team size', 'time saved'"),
  value: z.string().describe("e.g. '$2.1M', '12 engineers', '40%', '6 weeks'"),
});

const FactSchema = z.object({
  type: factTypeEnum.describe(
    "achievement: outcome with measurable impact. " +
      "skill: a capability the user demonstrates. " +
      "role: a job/position held. " +
      "education: degree, school, dates. " +
      "certification: credential earned. " +
      "project: discrete initiative led/contributed to. " +
      "story: narrative with context-action-result. " +
      "metric: a standalone number/figure worth retrieving. " +
      "tool: a specific technology/framework/methodology the user has used. " +
      "responsibility: an ongoing scope/duty in a role. " +
      "context: useful background/preferences that don't fit elsewhere.",
  ),
  content: z
    .string()
    .min(8)
    .max(600)
    .describe(
      "A normalized 1-2 sentence summary of the fact. Self-contained — must " +
        "make sense without the surrounding text. No first-person pronouns; " +
        "use a neutral declarative voice (e.g. 'Led migration from X to Y...').",
    ),
  evidenceQuote: z
    .string()
    .min(8)
    .max(500)
    .describe(
      "A verbatim quote from the source chunk that grounds this fact. Do not " +
        "paraphrase — copy exact wording so we can audit later.",
    ),
  company: z
    .string()
    .nullish()
    .describe("Company name if the fact ties to one. Null or omit if not applicable."),
  role: z
    .string()
    .nullish()
    .describe("Role title if applicable. Null or omit if not applicable."),
  startDate: z
    .string()
    .nullish()
    .describe("ISO date or YYYY-MM if known. Null or omit if unknown."),
  endDate: z
    .string()
    .nullish()
    .describe("ISO date, YYYY-MM, or 'present'. Null or omit if unknown."),
  tags: z
    .array(z.string())
    .max(15)
    .nullish()
    .describe("Short topical tags (lowercase, 1-3 words). e.g. ['leadership', 'rag', 'fintech']. Empty array or omit if none."),
  metrics: z
    .array(MetricSchema)
    .max(10)
    .nullish()
    .describe("Numerical impact metrics surfaced in the fact. Empty array or omit if none."),
});

export type ExtractedFact = z.infer<typeof FactSchema>;

const ExtractionResponseSchema = z.object({
  facts: z
    .array(FactSchema)
    .describe(
      "Every fact that can be cleanly extracted from this chunk. Order doesn't matter. " +
        "If the chunk contains no extractable facts (e.g. it's a table of contents, page " +
        "header, or boilerplate), return an empty array. Cap at ~20 facts; for dense " +
        "comma-separated skill lists, group related items into one fact.",
    ),
});

const SYSTEM_PROMPT = `You are a meticulous factual extractor for Resume Talos, a multi-agent system that drafts grounded resumes and cover letters.

Your job: read one chunk of a user's professional document and emit a strict list of self-contained facts that can later be cited by a resume writer.

Hard rules:
- NEVER invent. NEVER embellish. Only extract what is literally present in the chunk.
- Every fact must include an exact verbatim quote from the chunk as evidence. If you can't ground it in a quote, do not emit it.
- Prefer specificity. "Led 12-engineer team" beats "led a team".
- One fact per record. Don't combine multiple achievements into one "content" field.
- GRANULARITY FOR NAMED TOOLS / TECHNOLOGIES (read carefully):
  When a chunk mentions specific named tools, technologies, frameworks, methodologies, languages, or platforms — even if those names are buried inside a broader workflow or achievement sentence — emit a SEPARATE \`tool\`-type fact for EACH named entity, IN ADDITION to any broader workflow / achievement / responsibility fact. The goal: downstream retrieval needs to find these tools by their canonical name without the broader-claim text drowning the embedding.
  Example input: "Then in my current role at Quadratic Digital, we use a multi-agent AI development system that runs off of User Stories that we submit to Jira."
  Should produce 3 facts:
    1. {type: tool, content: "Uses Jira for user story tracking at Quadratic Digital.", evidenceQuote: "we use a multi-agent AI development system that runs off of User Stories that we submit to Jira", company: "Quadratic Digital"}
    2. {type: project, content: "Operates a multi-agent AI development system at Quadratic Digital that consumes user stories as inputs.", evidenceQuote: "...multi-agent AI development system that runs off of User Stories that we submit to Jira", company: "Quadratic Digital"}
    3. {type: skill, content: "Writes hyper-detailed user stories optimized for AI agent consumption (no interpretation gaps).", evidenceQuote: "These user stories has to be even more detailed than normal because you do not want to leave any interpretation up to the machine", company: "Quadratic Digital"}
  Apply this rule for: programming languages (Python, R, SQL), data tools (Tableau, Power BI, Looker, Snowflake, BigQuery), PM tools (Jira, Confluence, Asana, Smartsheet, MS Project, Trello), cloud platforms (AWS, GCP, Azure), AI / ML frameworks (LangChain, PyTorch, TensorFlow), federal vehicles (GSA MAS, OASIS+, STARS III, 8(a)), methodologies (Agile, Scrum, Kanban, SAFe, ITIL), certifications referenced as competencies (PMP, CISSP, ITIL), and any other identifiably-named product or framework.
- Skip duplicates within the chunk.
- Skip boilerplate (page numbers, "Page 1 of 5", contact-info-only chunks, table of contents, formatting artifacts).
- For dates, prefer ISO (YYYY or YYYY-MM). Use "present" for current roles.
- For metrics, extract numbers exactly as written. Preserve units.
- Keep content normalized to neutral declarative voice — no "I", no first person.
- When a SECTION CONTEXT block is present, every fact MUST set company to the specified company value unless the chunk explicitly attributes the fact to a different employer.
- If a chunk has zero extractable facts, return facts: [].`;

export type ExtractFactsOptions = {
  chunkText: string;
  chunkIndex: number;
  documentName: string;
  applicationId?: string;
  sectionContext?: SectionContext;
};

export async function extractFactsFromChunk(opts: ExtractFactsOptions) {
  const sectionBlock = opts.sectionContext
    ? `\n# SECTION CONTEXT\nThis chunk is from a resume section labeled:\nCompany: ${opts.sectionContext.company}\nRole: ${opts.sectionContext.role ?? "(unknown)"}\nDates: ${opts.sectionContext.startDate ?? "?"}-${opts.sectionContext.endDate ?? "?"}\nEvery fact extracted from this chunk MUST set company to "${opts.sectionContext.company}" unless the chunk explicitly attributes that fact to a different employer.\n`
    : "";
  const basePrompt = `Document: ${opts.documentName}
Chunk #${opts.chunkIndex}
${sectionBlock}

---
${opts.chunkText}
---

Extract every distinct fact from this chunk per the rules. If the chunk has no extractable facts, return facts: [].`;

  // One retry on schema failure with a strong reminder.
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await callObject<z.infer<typeof ExtractionResponseSchema>>({
        role: "writer_resume",
        agentName: attempt === 0 ? "fact_extractor" : "fact_extractor_retry",
        applicationId: opts.applicationId,
        system: SYSTEM_PROMPT,
        prompt:
          attempt === 0
            ? basePrompt
            : `${basePrompt}\n\nPREVIOUS ATTEMPT FAILED SCHEMA VALIDATION. Emit valid JSON matching the schema exactly. tags and metrics must be arrays (use [] if empty). Optional fields may be null or omitted but not other types. Cap at 15 facts — group related items.`,
        schema: ExtractionResponseSchema,
        maxOutputTokens: 12_000,
      });

      const normalized = result.object.facts.map((f) => ({
        ...f,
        company: f.company ?? opts.sectionContext?.company,
        role: f.role ?? opts.sectionContext?.role,
        startDate: f.startDate ?? opts.sectionContext?.startDate,
        endDate: f.endDate ?? opts.sectionContext?.endDate,
        tags: f.tags ?? [],
        metrics: f.metrics ?? [],
      }));
      return { facts: normalized, runId: result.runId, costUsd: result.costUsd };
    } catch (err) {
      lastErr = err;
      console.warn(
        `[fact_extractor] chunk ${opts.chunkIndex} attempt ${attempt + 1} failed:`,
        err instanceof Error ? err.message : err,
      );
      const text = (err as { text?: unknown })?.text;
      if (typeof text === "string") {
        console.warn(`[fact_extractor] raw model output (first 800 chars): ${text.slice(0, 800)}`);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
