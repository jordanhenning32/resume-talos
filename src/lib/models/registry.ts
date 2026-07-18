import { env } from "@/lib/env";

export type AgentRole =
  | "writer_resume"
  | "writer_cover_letter"
  | "jd_analyzer"
  | "orchestrator"
  | "reviewer_a"
  | "reviewer_b"
  | "screener"
  | "researcher"
  | "verifier"
  | "fit_score"
  | "retriever"
  | "knockout_detector"
  | "questionnaire_helper"
  | "verifier_fix_suggester";

export type Provider = "anthropic" | "openai" | "google" | "xai";

export type ModelChoice = {
  provider: Provider;
  model: string;
};

function inferProvider(modelName: string): Provider {
  if (modelName.startsWith("claude")) return "anthropic";
  if (modelName.startsWith("gemini")) return "google";
  if (modelName.startsWith("grok")) return "xai";
  if (modelName.startsWith("gpt") || modelName.startsWith("text-embedding"))
    return "openai";
  throw new Error(`Unknown provider for model: ${modelName}`);
}

export function modelFor(role: AgentRole): ModelChoice {
  const e = env();
  const name = (() => {
    switch (role) {
      case "writer_resume":
      case "writer_cover_letter":
      case "orchestrator":
        return e.MODEL_WRITER;
      case "jd_analyzer":
        return e.MODEL_JD_ANALYZER;
      case "reviewer_a":
        return e.MODEL_REVIEWER_A;
      case "reviewer_b":
        return e.MODEL_REVIEWER_B;
      case "screener":
      case "questionnaire_helper":
      case "verifier_fix_suggester":
        return e.MODEL_SCREENER;
      case "researcher":
        return e.MODEL_RESEARCH;
      case "verifier":
        return e.MODEL_VERIFIER;
      case "fit_score":
      case "retriever":
      case "knockout_detector":
        return e.MODEL_FIT_SCORE;
    }
  })();
  return { provider: inferProvider(name), model: name };
}
