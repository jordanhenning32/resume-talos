import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { xai } from "@ai-sdk/xai";
import type { EmbeddingModel, LanguageModel } from "ai";
import { env } from "@/lib/env";
import type { ModelChoice, Provider } from "./registry";

export function getLanguageModel(choice: ModelChoice): LanguageModel {
  switch (choice.provider) {
    case "anthropic":
      return anthropic(choice.model);
    case "google":
      return google(choice.model);
    case "openai":
      return openai(choice.model);
    case "xai":
      return xai(choice.model);
    default: {
      const _exhaustive: never = choice.provider;
      throw new Error(`Unsupported provider: ${_exhaustive as Provider}`);
    }
  }
}

export function getEmbeddingModel(): EmbeddingModel {
  const e = env();
  return openai.textEmbeddingModel(e.EMBEDDING_MODEL);
}
