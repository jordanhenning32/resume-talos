import { google } from "@ai-sdk/google";
import { generateText, type LanguageModelUsage } from "ai";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { agentRuns, type NewAgentRun } from "@/db/schema";
import { computeCostUsd } from "@/lib/models/pricing";
import { env } from "@/lib/env";
import {
  createProviderAbort,
  providerCallTimeoutMs,
  toProviderError,
} from "@/lib/models/timeout";

export const ToneProfileSchema = z.object({
  formality: z
    .number()
    .min(0)
    .max(1)
    .describe(
      "0 = casual/conversational (think: early-stage SaaS), 0.5 = standard professional, 1 = formal/buttoned-up (think: federal prime, big-4 consulting).",
    ),
  technicalDensity: z
    .number()
    .min(0)
    .max(1)
    .describe(
      "0 = avoid jargon, 0.5 = moderate domain language, 1 = heavy technical specificity expected (engineering/research orgs).",
    ),
  missionEmphasis: z
    .enum(["low", "medium", "high"])
    .describe(
      "How much the cover letter should weave in mission alignment. high = mission-driven orgs (nonprofits, defense, civic tech). low = transactional employers.",
    ),
  energyLevel: z
    .enum(["low", "medium", "high"])
    .describe(
      "Tonal energy. high = ambitious/founder-y. medium = standard exec. low = measured/understated.",
    ),
  notes: z
    .string()
    .nullish()
    .describe(
      "1-3 sentence freeform notes for the cover-letter writer — anything specific about how to speak to this company (vocabulary they use, themes to lean into / avoid).",
    ),
});

export const FindingsSchema = z.object({
  overview: z
    .string()
    .describe("1-3 sentences explaining what the company does and at what scale."),
  mission: z
    .string()
    .nullish()
    .describe("Their stated mission/purpose if discoverable. Use their wording where possible."),
  values: z
    .array(z.string())
    .nullish()
    .describe("Stated company values, principles, or operating beliefs."),
  culture: z
    .string()
    .nullish()
    .describe(
      "1-3 sentences synthesizing what working there is reportedly like.",
    ),
  recentNews: z
    .array(
      z.object({
        title: z.string(),
        url: z.string().nullish(),
        summary: z.string().nullish(),
        date: z.string().nullish(),
      }),
    )
    .nullish()
    .describe(
      "Material news from the last ~12 months: funding, leadership changes, product launches, contract wins/losses, layoffs, M&A.",
    ),
  productsServices: z
    .array(z.string())
    .nullish()
    .describe("Their core offerings / what they sell."),
  leadership: z
    .array(z.string())
    .nullish()
    .describe("Notable leadership. Title + name."),
});

export const MarketResearchSchema = z.object({
  findings: FindingsSchema,
  toneProfile: ToneProfileSchema,
  sources: z
    .array(
      z.object({
        url: z.string(),
        title: z.string().nullish(),
      }),
    )
    .nullish()
    .describe("Web sources cited by the underlying research."),
});

export type MarketResearchResult = z.infer<typeof MarketResearchSchema>;

const STAGE_1_SYSTEM = `You are the Market Research agent for Resume Talos. Your job is to thoroughly research a company so a cover letter writer can ground in real, current details rather than generic flattery.

Use Google Search aggressively. Read the company's own site, recent press, leadership interviews, and credible third-party coverage. Skip generic content marketing fluff.

Output a thorough but compact research brief, structured under these sections (use markdown headings):
- ## Overview
- ## Mission
- ## Values
- ## Culture
- ## Recent news (last ~12 months) — bullet list with dates
- ## Products and services
- ## Notable leadership
- ## Cover letter tone notes — formality (0-1), technical density (0-1), mission emphasis (low/medium/high), energy level (low/medium/high), plus 1-3 sentences of free-form notes about how to speak to this company

End with a "## Sources" list of the URLs you actually used.

Be honest. If something isn't discoverable, say so. Don't fabricate values or culture from thin air.`;

const STAGE_2_SYSTEM = `You are extracting structured JSON from a market-research brief produced by another agent. Be faithful to the source — do not invent details that aren't in the brief. If the brief is missing a field, use null / empty array per the schema.`;

function buildStage2Prompt(companyName: string, rawMarkdown: string) {
  return `Return only valid JSON for this research brief about ${companyName}.

Use this exact shape:
{
  "findings": {
    "overview": "string",
    "mission": "string or null",
    "values": ["string"],
    "culture": "string or null",
    "recentNews": [
      { "title": "string", "url": "string or null", "summary": "string or null", "date": "string or null" }
    ],
    "productsServices": ["string"],
    "leadership": ["string"]
  },
  "toneProfile": {
    "formality": 0.5,
    "technicalDensity": 0.5,
    "missionEmphasis": "low | medium | high",
    "energyLevel": "low | medium | high",
    "notes": "string or null"
  },
  "sources": [
    { "url": "string", "title": "string or null" }
  ]
}

If the brief says a field is not discoverable, use null or [].

Research brief:
---
${rawMarkdown}
---`;
}

async function safeFinalizeRun(
  id: string,
  patch: Partial<NewAgentRun> & { completedAt: Date },
) {
  try {
    await db().update(agentRuns).set(patch).where(eq(agentRuns.id, id));
  } catch (err) {
    console.error(
      `[market_research] failed to finalize agent run ${id}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

function createResearchAbort() {
  return createProviderAbort(
    providerCallTimeoutMs(
      process.env.RESEARCH_PROVIDER_CALL_TIMEOUT_MS ??
        process.env.PROVIDER_CALL_TIMEOUT_MS ??
        process.env.MODEL_CALL_TIMEOUT_MS ??
        "240000",
    ),
  );
}

export async function runMarketResearch(opts: {
  companyName: string;
  applicationId?: string;
}): Promise<{
  result: MarketResearchResult;
  rawMarkdown: string;
  costUsd: number;
  stageRunIds: { stage1: string; stage2: string };
}> {
  const e = env();
  const startedAt = new Date();

  // ─── Stage 1: Gemini with Google Search grounding ───
  const stage1Row: NewAgentRun = {
    applicationId: opts.applicationId,
    agentName: "market_research_stage1",
    provider: "google",
    model: e.MODEL_RESEARCH,
    status: "running",
    input: {
      companyName: opts.companyName,
      system: STAGE_1_SYSTEM,
    },
    startedAt,
  };
  const [stage1Inserted] = await db()
    .insert(agentRuns)
    .values(stage1Row)
    .returning({ id: agentRuns.id });
  const stage1RunId = stage1Inserted.id;

  let rawMarkdown = "";
  let stage1Cost = 0;
  let collectedSources: Array<{ url: string; title?: string | null }> = [];

  const stage1Abort = createResearchAbort();
  try {
    const result = await generateText({
      model: google(e.MODEL_RESEARCH),
      system: STAGE_1_SYSTEM,
      prompt: `Research ${opts.companyName} thoroughly for cover-letter context. Use Google Search.`,
      tools: {
        google_search: google.tools.googleSearch({}),
      },
      maxOutputTokens: 8000,
      abortSignal: stage1Abort.signal,
    });
    rawMarkdown = result.text;

    // Best-effort source extraction from grounding metadata.
    const sources = extractGroundingSources(result);
    collectedSources = sources;

    const usage = result.usage;
    const inputTokens = usage?.inputTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;
    stage1Cost = computeCostUsd(e.MODEL_RESEARCH, { inputTokens, outputTokens });

    await safeFinalizeRun(stage1RunId, {
      status: "completed",
      inputTokens,
      outputTokens,
      costUsd: stage1Cost,
      output: { text: result.text, sources: collectedSources },
      completedAt: new Date(),
    });
  } catch (err) {
    const finalError = toProviderError(
      err,
      stage1Abort.signal,
      stage1Abort.timeoutMs,
    );
    await safeFinalizeRun(stage1RunId, {
      status: "failed",
      error: finalError instanceof Error ? finalError.message : String(finalError),
      completedAt: new Date(),
    });
    throw finalError;
  } finally {
    stage1Abort.clear();
  }

  if (rawMarkdown.trim().length < 100) {
    throw new Error("Market research stage 1 produced empty/short output.");
  }

  // ─── Stage 2: structure-extract via Gemini Flash (cheaper) ───
  const stage2Started = new Date();
  const stage2Row: NewAgentRun = {
    applicationId: opts.applicationId,
    agentName: "market_research_stage2",
    provider: "google",
    model: "gemini-2.5-flash",
    status: "running",
    input: { system: STAGE_2_SYSTEM, briefLength: rawMarkdown.length },
    startedAt: stage2Started,
  };
  const [stage2Inserted] = await db()
    .insert(agentRuns)
    .values(stage2Row)
    .returning({ id: agentRuns.id });
  const stage2RunId = stage2Inserted.id;

  const stage2Abort = createResearchAbort();
  try {
    let extractedObject: MarketResearchResult;
    let usage: LanguageModelUsage | undefined;
    let extractionMode: "model_json" | "markdown_fallback" = "model_json";
    let extractionWarning: string | null = null;
    try {
      const extracted = await generateText({
        model: google("gemini-2.5-flash"),
        system: STAGE_2_SYSTEM,
        prompt: buildStage2Prompt(opts.companyName, rawMarkdown),
        maxOutputTokens: 6000,
        abortSignal: stage2Abort.signal,
      });
      usage = extracted.usage;
      const parsed = parseMarketResearchText(extracted.text, opts.companyName);
      if (parsed) {
        extractedObject = parsed;
      } else {
        extractionMode = "markdown_fallback";
        extractionWarning =
          "Stage 2 returned unparseable JSON; used deterministic markdown fallback.";
        console.warn(
          "[market_research stage 2] generated text was not parseable JSON; using markdown fallback.",
        );
        extractedObject = marketResearchFromBrief(rawMarkdown, opts.companyName);
      }
    } catch (err) {
      const finalError = toProviderError(
        err,
        stage2Abort.signal,
        stage2Abort.timeoutMs,
      );
      extractionMode = "markdown_fallback";
      extractionWarning =
        finalError instanceof Error ? finalError.message : String(finalError);
      console.warn(
        "[market_research stage 2] provider extraction failed; using markdown fallback:",
        extractionWarning,
      );
      usage = (err as { usage?: LanguageModelUsage })?.usage;
      extractedObject = marketResearchFromBrief(rawMarkdown, opts.companyName);
    }

    // Merge in grounding-discovered sources that the extractor may have missed.
    const extractedSources = extractedObject.sources ?? [];
    const mergedSources = mergeSources(extractedSources, collectedSources);
    const finalResult: MarketResearchResult = {
      ...extractedObject,
      sources: mergedSources,
    };

    const inputTokens = usage?.inputTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;
    const stage2Cost = computeCostUsd("gemini-2.5-flash", {
      inputTokens,
      outputTokens,
    });

    await safeFinalizeRun(stage2RunId, {
      status: "completed",
      inputTokens,
      outputTokens,
      costUsd: stage2Cost,
      output: {
        object: finalResult as Record<string, unknown>,
        extractionMode,
        warning: extractionWarning,
      },
      completedAt: new Date(),
    });

    return {
      result: finalResult,
      rawMarkdown,
      costUsd: Math.round((stage1Cost + stage2Cost) * 1_000_000) / 1_000_000,
      stageRunIds: { stage1: stage1RunId, stage2: stage2RunId },
    };
  } catch (err) {
    const finalError = toProviderError(
      err,
      stage2Abort.signal,
      stage2Abort.timeoutMs,
    );
    await safeFinalizeRun(stage2RunId, {
      status: "failed",
      error: finalError instanceof Error ? finalError.message : String(finalError),
      completedAt: new Date(),
    });
    throw finalError;
  } finally {
    stage2Abort.clear();
  }
}

export function marketResearchFromBrief(
  rawMarkdown: string,
  companyName = "the company",
): MarketResearchResult {
  const sections = extractMarkdownSections(rawMarkdown);
  const toneText = sectionText(
    sections,
    "cover letter tone notes",
    "tone notes",
    "tone profile",
  );

  return normalizeMarketResearchValue(
    {
      findings: {
        overview:
          firstUsableParagraph(sectionText(sections, "overview")) ??
          firstUsableParagraph(rawMarkdown) ??
          `Research brief for ${companyName}.`,
        mission: firstUsableParagraph(sectionText(sections, "mission")),
        values: bulletItems(sectionText(sections, "values")).slice(0, 12),
        culture: firstUsableParagraph(sectionText(sections, "culture")),
        recentNews: bulletItems(sectionText(sections, "recent news", "news"))
          .map(newsItemFromBullet)
          .slice(0, 8),
        productsServices: bulletItems(
          sectionText(
            sections,
            "products and services",
            "products",
            "services",
            "offerings",
          ),
        ).slice(0, 12),
        leadership: bulletItems(
          sectionText(sections, "notable leadership", "leadership"),
        ).slice(0, 12),
      },
      toneProfile: toneProfileFromSection(toneText),
      sources: sourcesFromSection(sectionText(sections, "sources")),
    },
    companyName,
  );
}

function extractMarkdownSections(text: string): Map<string, string> {
  const sections = new Map<string, string>();
  let current = "overview";
  let buffer: string[] = [];

  const commit = () => {
    const body = buffer.join("\n").trim();
    if (!body) return;
    const existing = sections.get(current);
    sections.set(current, existing ? `${existing}\n\n${body}` : body);
  };

  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      commit();
      current = normalizeSectionName(heading[1]);
      buffer = [];
      continue;
    }
    buffer.push(line);
  }
  commit();
  return sections;
}

function sectionText(
  sections: Map<string, string>,
  ...names: string[]
): string | null {
  for (const name of names) {
    const normalized = normalizeSectionName(name);
    const direct = sections.get(normalized);
    if (direct) return direct;
    for (const [key, value] of sections) {
      if (key === normalized || key.startsWith(normalized)) return value;
    }
  }
  return null;
}

function normalizeSectionName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstUsableParagraph(text: string | null): string | null {
  if (!text) return null;
  const paragraph = text
    .split(/\n{2,}/)
    .map(cleanMarkdownBlock)
    .map(usableText)
    .find((item): item is string => Boolean(item));
  return paragraph ?? null;
}

function bulletItems(text: string | null): string[] {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const bullets = lines
    .filter((line) => /^\s*(?:[-*\u2022]|\d+[.)])\s+/.test(line))
    .map(cleanMarkdownLine)
    .map(usableText)
    .filter((item): item is string => Boolean(item));
  if (bullets.length > 0) return bullets;

  return text
    .split(/\n{2,}|;\s+/)
    .map(cleanMarkdownBlock)
    .map(usableText)
    .filter((item): item is string => Boolean(item));
}

function cleanMarkdownBlock(text: string): string {
  return text
    .split(/\r?\n/)
    .map(cleanMarkdownLine)
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanMarkdownLine(line: string): string {
  return line
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\s*(?:[-*\u2022]|\d+[.)])\s+/, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function usableText(text: string | null): string | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  if (
    /^(?:none|n\/a|unknown|unclear|not (?:publicly )?(?:available|discoverable|found|disclosed))\.?$/i.test(
      trimmed,
    )
  ) {
    return null;
  }
  return trimmed;
}

function newsItemFromBullet(item: string): NonNullable<
  NonNullable<MarketResearchResult["findings"]["recentNews"]>[number]
> {
  const url = firstUrl(item);
  const title = usableText(
    cleanMarkdownLine(url ? item.replace(url, "") : item),
  );
  return {
    title: title ?? item,
    url,
    summary: null,
    date: extractNewsDate(item),
  };
}

function extractNewsDate(text: string): string | null {
  const match = text.match(
    /\b(?:Q[1-4]\s+20\d{2}|20\d{2}-\d{2}-\d{2}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+20\d{2}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+20\d{2}|20\d{2})\b/i,
  );
  return match?.[0] ?? null;
}

function sourcesFromSection(
  text: string | null,
): Array<{ url: string; title?: string | null }> {
  if (!text) return [];
  const sources: Array<{ url: string; title?: string | null }> = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const markdownLink = line.match(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/i);
    if (markdownLink) {
      sources.push({
        url: trimUrl(markdownLink[2]),
        title: usableText(cleanMarkdownLine(markdownLink[1])),
      });
      continue;
    }

    const url = firstUrl(line);
    if (!url) continue;
    const title = usableText(
      cleanMarkdownLine(line.replace(url, "")).replace(/^[:\-\s]+/, ""),
    );
    sources.push({ url, title });
  }
  return sources;
}

function firstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s)>\]]+/i);
  return match ? trimUrl(match[0]) : null;
}

function trimUrl(url: string): string {
  return url.replace(/[.,;:]+$/g, "");
}

function toneProfileFromSection(
  text: string | null,
): MarketResearchResult["toneProfile"] {
  const body = text ?? "";
  const notes = firstUsableParagraph(body);
  return {
    formality: parseScoreAfterLabel(body, "formality", 0.5),
    technicalDensity: parseScoreAfterLabel(body, "technical density", 0.5),
    missionEmphasis: parseEnumAfterLabel(
      body,
      "mission emphasis",
      ["low", "medium", "high"],
      "medium",
    ),
    energyLevel: parseEnumAfterLabel(
      body,
      "energy level",
      ["low", "medium", "high"],
      "medium",
    ),
    notes: notes ? clipText(notes, 500) : null,
  };
}

function parseScoreAfterLabel(
  text: string,
  label: string,
  fallback: number,
): number {
  const match = text.match(
    new RegExp(`${escapeRegExp(label)}[^0-9]*(0(?:\\.\\d+)?|1(?:\\.0+)?)`, "i"),
  );
  return match ? number01(match[1], fallback) : fallback;
}

function parseEnumAfterLabel<const T extends readonly string[]>(
  text: string,
  label: string,
  allowed: T,
  fallback: T[number],
): T[number] {
  const match = text.match(
    new RegExp(`${escapeRegExp(label)}[^a-z]*(low|medium|high)`, "i"),
  );
  return enumValue(match?.[1], allowed, fallback);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clipText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}.`;
}

export function parseMarketResearchText(
  text: string,
  companyName = "the company",
): MarketResearchResult | null {
  const jsonText = extractJsonObjectText(text);
  if (!jsonText) return null;
  const parsed = parseLooseJson(jsonText);
  if (parsed === null) return null;
  try {
    return normalizeMarketResearchValue(parsed, companyName);
  } catch {
    return null;
  }
}

export async function repairMarketResearchJsonText(
  text: string,
  companyName = "the company",
): Promise<string | null> {
  const parsed = parseMarketResearchText(text, companyName);
  return parsed ? JSON.stringify(parsed) : null;
}

export function normalizeMarketResearchValue(
  value: unknown,
  companyName = "the company",
): MarketResearchResult {
  const root = asRecord(value) ?? {};
  const findingsRaw = asRecord(root.findings) ?? root;
  const toneRaw =
    asRecord(root.toneProfile) ??
    asRecord(root.tone_profile) ??
    asRecord(findingsRaw.toneProfile) ??
    asRecord(findingsRaw.tone_profile) ??
    {};

  const normalized: MarketResearchResult = {
    findings: {
      overview:
        stringOrNull(findingsRaw.overview) ??
        stringOrNull(findingsRaw.summary) ??
        `Research brief for ${companyName}.`,
      mission: stringOrNull(findingsRaw.mission),
      values: stringArrayOrNull(findingsRaw.values),
      culture: stringOrNull(findingsRaw.culture),
      recentNews: newsArrayOrNull(
        findingsRaw.recentNews ?? findingsRaw.recent_news ?? findingsRaw.news,
      ),
      productsServices: stringArrayOrNull(
        findingsRaw.productsServices ??
          findingsRaw.products_services ??
          findingsRaw.offerings,
      ),
      leadership: stringArrayOrNull(findingsRaw.leadership),
    },
    toneProfile: {
      formality: number01(toneRaw.formality, 0.5),
      technicalDensity: number01(
        toneRaw.technicalDensity ?? toneRaw.technical_density,
        0.5,
      ),
      missionEmphasis: enumValue(
        toneRaw.missionEmphasis ?? toneRaw.mission_emphasis,
        ["low", "medium", "high"],
        "medium",
      ),
      energyLevel: enumValue(
        toneRaw.energyLevel ?? toneRaw.energy_level,
        ["low", "medium", "high"],
        "medium",
      ),
      notes: stringOrNull(toneRaw.notes),
    },
    sources: sourceArrayOrNull(root.sources ?? findingsRaw.sources) ?? [],
  };

  return MarketResearchSchema.parse(normalized);
}

function extractJsonObjectText(text: string): string | null {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = withoutFence.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < withoutFence.length; i++) {
    const char = withoutFence[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) return withoutFence.slice(start, i + 1);
    }
  }
  return null;
}

function parseLooseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    try {
      return JSON.parse(text.replace(/,\s*([}\]])/g, "$1"));
    } catch {
      return null;
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function stringArrayOrNull(value: unknown): string[] | null {
  if (value == null) return null;
  if (typeof value === "string") {
    return value
      .split(/\n|;|\u2022|(?:^|\s)-\s/g)
      .map((part) => part.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(value)) return null;
  const items = value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      const record = asRecord(item);
      return stringOrNull(record?.name) ?? stringOrNull(record?.title) ?? null;
    })
    .filter((item): item is string => Boolean(item));
  return items;
}

function newsArrayOrNull(value: unknown): MarketResearchResult["findings"]["recentNews"] {
  if (value == null) return null;
  if (!Array.isArray(value)) {
    const text = stringOrNull(value);
    return text ? [{ title: text, url: null, summary: null, date: null }] : null;
  }
  return value
    .map((item) => {
      if (typeof item === "string") {
        return { title: item, url: null, summary: null, date: null };
      }
      const record = asRecord(item);
      if (!record) return null;
      const title =
        stringOrNull(record.title) ??
        stringOrNull(record.headline) ??
        stringOrNull(record.summary);
      if (!title) return null;
      return {
        title,
        url: stringOrNull(record.url) ?? stringOrNull(record.uri),
        summary: stringOrNull(record.summary),
        date: stringOrNull(record.date),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function sourceArrayOrNull(value: unknown): Array<{ url: string; title?: string | null }> | null {
  if (value == null) return null;
  const raw = Array.isArray(value) ? value : [value];
  const sources = raw
    .map((item): { url: string; title: string | null } | null => {
      if (typeof item === "string") {
        const url = item.trim();
        return url ? { url, title: null } : null;
      }
      const record = asRecord(item);
      if (!record) return null;
      const url =
        stringOrNull(record.url) ??
        stringOrNull(record.uri) ??
        stringOrNull(record.href);
      if (!url) return null;
      return {
        url,
        title: stringOrNull(record.title) ?? stringOrNull(record.name),
      };
    })
    .filter((item): item is { url: string; title: string | null } => Boolean(item));
  return sources;
}

function number01(value: unknown, fallback: number): number {
  const raw = typeof value === "string" ? Number(value) : value;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.max(0, Math.min(1, raw));
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function extractGroundingSources(
  result: unknown,
): Array<{ url: string; title?: string | null }> {
  const sources: Array<{ url: string; title?: string | null }> = [];
  // Sources may live on result.sources or in providerMetadata.google.groundingMetadata
  // depending on AI SDK version. Pull what we can find.
  const direct = (result as unknown as { sources?: Array<{ url?: string; title?: string }> })
    .sources;
  if (direct) {
    for (const s of direct) {
      if (s.url) sources.push({ url: s.url, title: s.title ?? null });
    }
  }
  const pm = (result as unknown as { providerMetadata?: Record<string, unknown> })
    .providerMetadata;
  const googleMeta = (pm?.google as Record<string, unknown> | undefined)?.groundingMetadata as
    | { groundingChunks?: Array<{ web?: { uri?: string; title?: string } }> }
    | undefined;
  if (googleMeta?.groundingChunks) {
    for (const c of googleMeta.groundingChunks) {
      if (c.web?.uri) {
        sources.push({ url: c.web.uri, title: c.web.title ?? null });
      }
    }
  }
  // De-dupe by URL.
  const seen = new Set<string>();
  return sources.filter((s) => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });
}

function mergeSources(
  a: Array<{ url: string; title?: string | null }>,
  b: Array<{ url: string; title?: string | null }>,
): Array<{ url: string; title?: string | null }> {
  const seen = new Set<string>();
  const out: Array<{ url: string; title?: string | null }> = [];
  for (const s of [...a, ...b]) {
    if (seen.has(s.url)) continue;
    seen.add(s.url);
    out.push(s);
  }
  return out.slice(0, 20);
}
