import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  ANTHROPIC_API_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1),
  XAI_API_KEY: z.string().min(1),
  OUTPUT_ROOT: z.string().min(1).default("E:\\resume-talos-output"),
  MODEL_WRITER: z.string().default("claude-opus-4-7"),
  // JD analysis is structured extraction (parse JD → roleTitle, mustHaveSkills,
  // etc.) — Sonnet handles this well without Opus's judgment-heavy strengths.
  MODEL_JD_ANALYZER: z.string().default("claude-sonnet-4-6"),
  MODEL_REVIEWER_A: z.string().default("claude-sonnet-4-6"),
  MODEL_REVIEWER_B: z.string().default("grok-4-latest"),
  MODEL_RESEARCH: z.string().default("gemini-2.5-pro"),
  // Verifier handles two roles: groundedness verification at export time
  // AND KB gap query expansion (kb-gap-detector routes through "verifier").
  // Swapped Haiku → Grok 4 at user request — both produce more nuanced
  // judgment on grounded-vs-fabricated claims and richer skill variants.
  // Tradeoff: ~10× cost (~$0.01 → ~$0.10 per verifier call), similar latency.
  MODEL_VERIFIER: z.string().default("grok-4-latest"),
  MODEL_FIT_SCORE: z.string().default("claude-haiku-4-5"),
  MODEL_SCREENER: z.string().default("claude-sonnet-4-6"),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-large"),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1536),
  // Cross-upload + intra-batch fact dedup threshold (cosine similarity).
  // 0.85 catches obvious semantic duplicates with rephrasing; 0.92+ only
  // catches near-identical wording.
  FACT_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.85),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration:\n${issues}\n\nCopy .env.local.example to .env.local and fill in values.`,
    );
  }
  cached = parsed.data;
  return cached;
}
