import { embed, embedMany } from "ai";
import { env } from "@/lib/env";
import { getEmbeddingModel } from "./clients";
import { computeCostUsd } from "./pricing";
import { createProviderAbort, toProviderError } from "./timeout";

export type EmbedResult = {
  embedding: number[];
  inputTokens: number;
  costUsd: number;
  model: string;
};

export type EmbedManyResult = {
  embeddings: number[][];
  inputTokens: number;
  costUsd: number;
  model: string;
};

export async function embedText(value: string): Promise<EmbedResult> {
  const e = env();
  const model = getEmbeddingModel();
  const abort = createProviderAbort();
  try {
    const result = await embed({
      model,
      value,
      providerOptions: {
        openai: { dimensions: e.EMBEDDING_DIMENSIONS },
      },
      abortSignal: abort.signal,
    });
    const inputTokens = result.usage?.tokens ?? 0;
    return {
      embedding: result.embedding,
      inputTokens,
      costUsd: computeCostUsd(e.EMBEDDING_MODEL, { inputTokens, outputTokens: 0 }),
      model: e.EMBEDDING_MODEL,
    };
  } catch (err) {
    throw toProviderError(err, abort.signal, abort.timeoutMs);
  } finally {
    abort.clear();
  }
}

export async function embedTexts(values: string[]): Promise<EmbedManyResult> {
  if (values.length === 0) {
    const e = env();
    return { embeddings: [], inputTokens: 0, costUsd: 0, model: e.EMBEDDING_MODEL };
  }
  const e = env();
  const model = getEmbeddingModel();
  const abort = createProviderAbort();
  try {
    const result = await embedMany({
      model,
      values,
      providerOptions: {
        openai: { dimensions: e.EMBEDDING_DIMENSIONS },
      },
      abortSignal: abort.signal,
    });
    const inputTokens = result.usage?.tokens ?? 0;
    return {
      embeddings: result.embeddings,
      inputTokens,
      costUsd: computeCostUsd(e.EMBEDDING_MODEL, { inputTokens, outputTokens: 0 }),
      model: e.EMBEDDING_MODEL,
    };
  } catch (err) {
    throw toProviderError(err, abort.signal, abort.timeoutMs);
  } finally {
    abort.clear();
  }
}
