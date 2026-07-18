import { eq } from "drizzle-orm";
import {
  generateObject,
  generateText,
  type LanguageModelUsage,
  type ModelMessage,
  type SystemModelMessage,
  type UserModelMessage,
} from "ai";
import type { ZodTypeAny } from "zod";
import { db } from "@/db";
import { agentRuns, type NewAgentRun } from "@/db/schema";
import { getLanguageModel } from "./clients";
import { computeCostUsd } from "./pricing";
import { modelFor, type AgentRole } from "./registry";
import { createProviderAbort, toProviderError } from "./timeout";

/**
 * Prompt-cache config for Anthropic. When set, the system prompt and the
 * stable user-prompt prefix are marked with `cacheControl: ephemeral`. On
 * the first call the cache is WRITTEN (premium ~1.25× input price); on
 * subsequent calls within ~5 min that share the same prefix the cache is
 * READ (cheap, ~0.1× input price). Iter 1/2 writer revisions are the
 * primary beneficiaries — same system, same JD analysis, same KB facts.
 */
export type CachedPromptOptions = {
  /** Stable system prompt — cached. */
  system: string;
  /** Stable user-prompt prefix — cached. */
  cachedUser: string;
  /** Dynamic user-prompt suffix — NOT cached (varies per call). */
  dynamicUser: string;
};

export type CallOptions = {
  role: AgentRole;
  /** Used for billing-attribution + UI grouping. */
  applicationId?: string;
  applicationVersionId?: string;
  /** Friendly identifier for the agent_runs row. Defaults to role. */
  agentName?: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
} & (
  | {
      system?: string;
      prompt: string;
      cachedPrompt?: never;
    }
  | {
      system?: never;
      prompt?: never;
      cachedPrompt: CachedPromptOptions;
    }
);

export type TextCallResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  model: string;
  provider: string;
  runId: string;
};

export type ObjectCallResult<T> = Omit<TextCallResult, "text"> & {
  object: T;
};

type NormalizedUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationTokens: number;
};

function normalizeUsage(usage: LanguageModelUsage | undefined): NormalizedUsage {
  if (!usage) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
    };
  }
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheCreationTokens: usage.inputTokenDetails?.cacheWriteTokens ?? 0,
  };
}

const ANTHROPIC_EPHEMERAL = {
  anthropic: { cacheControl: { type: "ephemeral" as const } },
};

/**
 * Build the system + messages payload for a cached call. The system message
 * is sent as a SystemModelMessage with `providerOptions.anthropic.cacheControl`
 * so its content becomes the first cache breakpoint; the user message has a
 * stable cached prefix (second breakpoint) followed by the dynamic suffix.
 */
function buildCachedPayload(opts: CachedPromptOptions): {
  system: SystemModelMessage;
  messages: ModelMessage[];
} {
  const system: SystemModelMessage = {
    role: "system",
    content: opts.system,
    providerOptions: ANTHROPIC_EPHEMERAL,
  };
  const userMessage: UserModelMessage = {
    role: "user",
    content: [
      {
        type: "text",
        text: opts.cachedUser,
        providerOptions: ANTHROPIC_EPHEMERAL,
      },
      {
        type: "text",
        text: opts.dynamicUser,
      },
    ],
  };
  return { system, messages: [userMessage] };
}

async function recordRun(row: NewAgentRun): Promise<string> {
  const [inserted] = await db()
    .insert(agentRuns)
    .values(row)
    .returning({ id: agentRuns.id });
  return inserted.id;
}

async function finalizeRun(
  id: string,
  patch: Partial<NewAgentRun> & { completedAt: Date },
) {
  await db().update(agentRuns).set(patch).where(eq(agentRuns.id, id));
}

async function safeFinalizeRun(
  id: string,
  patch: Partial<NewAgentRun> & { completedAt: Date },
) {
  try {
    await finalizeRun(id, patch);
  } catch (err) {
    console.error(
      `[models/call] failed to finalize agent run ${id}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Build the generateText/generateObject input shape. Returns either:
 *   - { system, prompt } for the simple un-cached path, or
 *   - { system: SystemModelMessage, messages: [UserModelMessage] } for the
 *     cached path (system + stable user prefix marked with cacheControl).
 */
function buildCallInput(opts: CallOptions) {
  if (opts.cachedPrompt) {
    const { system, messages } = buildCachedPayload(opts.cachedPrompt);
    return { system, messages };
  }
  return { system: opts.system, prompt: opts.prompt };
}

function inputForAgentRuns(opts: CallOptions): Record<string, unknown> {
  if (opts.cachedPrompt) {
    return {
      system: opts.cachedPrompt.system,
      cachedUser: opts.cachedPrompt.cachedUser,
      dynamicUser: opts.cachedPrompt.dynamicUser,
      cached: true,
    };
  }
  return { system: opts.system, prompt: opts.prompt };
}

export async function callText(opts: CallOptions): Promise<TextCallResult> {
  const choice = modelFor(opts.role);
  const model = getLanguageModel(choice);
  const startedAt = new Date();

  const runId = await recordRun({
    applicationId: opts.applicationId,
    applicationVersionId: opts.applicationVersionId,
    agentName: opts.agentName ?? opts.role,
    provider: choice.provider,
    model: choice.model,
    status: "running",
    input: inputForAgentRuns(opts),
    startedAt,
  });

  const abort = createProviderAbort(opts.timeoutMs);
  try {
    const callInput = buildCallInput(opts);
    const result = await generateText({
      model,
      ...callInput,
      temperature: opts.temperature,
      maxOutputTokens: opts.maxOutputTokens,
      abortSignal: abort.signal,
    });

    const usage = normalizeUsage(result.usage);
    const costUsd = computeCostUsd(choice.model, usage);

    await safeFinalizeRun(runId, {
      status: "completed",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      costUsd,
      output: { text: result.text },
      completedAt: new Date(),
    });

    return {
      text: result.text,
      ...usage,
      costUsd,
      model: choice.model,
      provider: choice.provider,
      runId,
    };
  } catch (err) {
    const finalError = toProviderError(err, abort.signal, abort.timeoutMs);
    await safeFinalizeRun(runId, {
      status: "failed",
      error: finalError instanceof Error ? finalError.message : String(finalError),
      completedAt: new Date(),
    });
    throw finalError;
  } finally {
    abort.clear();
  }
}

export async function callObject<T>(
  opts: CallOptions & { schema: ZodTypeAny },
): Promise<ObjectCallResult<T>> {
  const choice = modelFor(opts.role);
  const model = getLanguageModel(choice);
  const startedAt = new Date();

  const runId = await recordRun({
    applicationId: opts.applicationId,
    applicationVersionId: opts.applicationVersionId,
    agentName: opts.agentName ?? opts.role,
    provider: choice.provider,
    model: choice.model,
    status: "running",
    input: { ...inputForAgentRuns(opts), structured: true },
    startedAt,
  });

  const abort = createProviderAbort(opts.timeoutMs);
  try {
    const callInput = buildCallInput(opts);
    const result = await generateObject({
      model,
      ...callInput,
      schema: opts.schema,
      temperature: opts.temperature,
      maxOutputTokens: opts.maxOutputTokens,
      abortSignal: abort.signal,
      experimental_repairText: async ({ text }) =>
        repairGeneratedObjectJsonText(text),
    });

    const usage = normalizeUsage(result.usage);
    const costUsd = computeCostUsd(choice.model, usage);

    await safeFinalizeRun(runId, {
      status: "completed",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      costUsd,
      output: { object: result.object as Record<string, unknown> },
      completedAt: new Date(),
    });

    return {
      object: result.object as T,
      ...usage,
      costUsd,
      model: choice.model,
      provider: choice.provider,
      runId,
    };
  } catch (err) {
    const finalError = toProviderError(err, abort.signal, abort.timeoutMs);
    await safeFinalizeRun(runId, {
      status: "failed",
      error: finalError instanceof Error ? finalError.message : String(finalError),
      completedAt: new Date(),
    });
    throw finalError;
  } finally {
    abort.clear();
  }
}

export function repairGeneratedObjectJsonText(text: string): string | null {
  const candidate = extractJsonObjectText(text);
  if (!candidate) return null;

  const parsed = parseJsonLoosely(candidate);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const repaired = normalizeGeneratedObject(parsed as Record<string, unknown>);
  if (!repaired.changed) return null;
  return JSON.stringify(repaired.value);
}

function extractJsonObjectText(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced) {
    const fencedObject = extractBalancedJsonObject(fenced);
    if (fencedObject) return fencedObject;
  }
  return extractBalancedJsonObject(text);
}

function extractBalancedJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function parseJsonLoosely(text: string): unknown | null {
  const variants = [
    text,
    text.replace(/,\s*([}\]])/g, "$1"),
  ];
  for (const variant of variants) {
    try {
      return JSON.parse(variant);
    } catch {
      // try next repair variant
    }
  }
  return null;
}

function normalizeGeneratedObject(
  value: Record<string, unknown>,
): { value: Record<string, unknown>; changed: boolean } {
  let changed = false;
  let out = { ...unwrapGeneratedObject(value) };
  changed ||= out !== value;

  if ("markdown" in out && typeof out.markdown !== "string") {
    out.markdown = String(out.markdown ?? "");
    changed = true;
  }

  const citationMax =
    "wordCount" in out || "primaryStoryId" in out
      ? 30
      : "variantTargetWords" in out
        ? 80
        : 80;
  const citationRepair = normalizeStringArray(out.citedFactIds, citationMax);
  if (citationRepair.changed) {
    out.citedFactIds = citationRepair.value;
    changed = true;
  }

  if ("variantTargetWords" in out) {
    const value = intFromUnknown(out.variantTargetWords);
    if (value !== null && value !== out.variantTargetWords) {
      out.variantTargetWords = value;
      changed = true;
    } else if (value === null && typeof out.markdown === "string") {
      out.variantTargetWords = countWords(out.markdown);
      changed = true;
    }
  }

  if ("wordCount" in out) {
    const value = intFromUnknown(out.wordCount);
    if (value !== null && value !== out.wordCount) {
      out.wordCount = value;
      changed = true;
    } else if (value === null && typeof out.markdown === "string") {
      out.wordCount = countWords(out.markdown);
      changed = true;
    }
  }

  for (const key of ["notes", "primaryStoryId"]) {
    if (key in out && out[key] != null && typeof out[key] !== "string") {
      out[key] = String(out[key]);
      changed = true;
    }
  }

  return { value: out, changed };
}

function unwrapGeneratedObject(value: Record<string, unknown>): Record<string, unknown> {
  if ("markdown" in value) return value;
  for (const key of ["object", "output", "result", "resume", "coverLetter"]) {
    const nested = value[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const record = nested as Record<string, unknown>;
      if ("markdown" in record) return record;
    }
  }
  return value;
}

function normalizeStringArray(
  value: unknown,
  maxItems: number,
): { value: string[]; changed: boolean } {
  if (Array.isArray(value)) {
    const normalized = Array.from(
      new Set(value.filter((item): item is string => typeof item === "string")),
    ).slice(0, maxItems);
    return {
      value: normalized,
      changed:
        normalized.length !== value.length ||
        normalized.some((item, index) => item !== value[index]),
    };
  }
  if (typeof value === "string") {
    return {
      value: Array.from(
        new Set(
          value
            .split(/[\s,]+/)
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ).slice(0, maxItems),
      changed: true,
    };
  }
  return { value: [], changed: value !== undefined };
}

function intFromUnknown(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.replace(/[^\d-]/g, ""), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function countWords(markdown: string): number {
  return markdown.trim().split(/\s+/).filter(Boolean).length;
}
