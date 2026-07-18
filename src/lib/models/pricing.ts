// Per-million-token USD rates. Review and update against provider pricing
// pages periodically — these are approximations as of 2026 Q2.
//
// Sources (last verified 2026-05):
//   Anthropic:  https://www.anthropic.com/pricing
//   OpenAI:     https://openai.com/api/pricing/
//   Google:     https://ai.google.dev/pricing
//   xAI:        https://docs.x.ai/docs/models

export type ModelPricing = {
  inputPerMillion: number;
  cachedInputPerMillion?: number;
  outputPerMillion: number;
};

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // ----- Anthropic -----
  "claude-opus-4-7": {
    inputPerMillion: 15,
    cachedInputPerMillion: 1.5,
    outputPerMillion: 75,
  },
  "claude-sonnet-4-6": {
    inputPerMillion: 3,
    cachedInputPerMillion: 0.3,
    outputPerMillion: 15,
  },
  "claude-haiku-4-5": {
    inputPerMillion: 1,
    cachedInputPerMillion: 0.1,
    outputPerMillion: 5,
  },

  // ----- OpenAI (embeddings only for now) -----
  "text-embedding-3-large": {
    inputPerMillion: 0.13,
    outputPerMillion: 0,
  },
  "text-embedding-3-small": {
    inputPerMillion: 0.02,
    outputPerMillion: 0,
  },

  // ----- Google -----
  "gemini-2.5-pro": {
    inputPerMillion: 1.25,
    outputPerMillion: 10,
  },
  "gemini-2.5-flash": {
    inputPerMillion: 0.3,
    outputPerMillion: 2.5,
  },

  // ----- xAI -----
  "grok-4-latest": {
    inputPerMillion: 3,
    cachedInputPerMillion: 0.75,
    outputPerMillion: 15,
  },
  "grok-4-fast-reasoning": {
    inputPerMillion: 0.2,
    cachedInputPerMillion: 0.05,
    outputPerMillion: 0.5,
  },
  "grok-4": {
    inputPerMillion: 3,
    outputPerMillion: 15,
  },
};

/**
 * Anthropic charges a small premium on cache *writes* (the first call that
 * populates the cache): ~1.25× the normal input rate. Cache *reads* are
 * billed at `cachedInputPerMillion` (~0.10× normal). Token totals reported
 * by the AI SDK split as:
 *   inputTokens = freshInput + cacheReadTokens + cacheWriteTokens
 * so subtract both classes to get the truly fresh (full-price) portion.
 */
const CACHE_WRITE_PREMIUM = 1.25;

export function computeCostUsd(
  model: string,
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    cacheCreationTokens?: number;
  },
): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    console.warn(`[pricing] no pricing entry for model "${model}" — returning 0`);
    return 0;
  }
  const input = usage.inputTokens ?? 0;
  const cacheReads = usage.cachedInputTokens ?? 0;
  const cacheWrites = usage.cacheCreationTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const billableFresh = Math.max(0, input - cacheReads - cacheWrites);
  const cost =
    (billableFresh / 1_000_000) * pricing.inputPerMillion +
    (cacheReads / 1_000_000) *
      (pricing.cachedInputPerMillion ?? pricing.inputPerMillion) +
    (cacheWrites / 1_000_000) * pricing.inputPerMillion * CACHE_WRITE_PREMIUM +
    (output / 1_000_000) * pricing.outputPerMillion;
  return Math.round(cost * 1_000_000) / 1_000_000; // 6 decimal places
}
