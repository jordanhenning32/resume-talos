export type SetupCheck = {
  key: string;
  label: string;
  ok: boolean;
  hint?: string;
};

export function setupStatus(): SetupCheck[] {
  const keys = [
    { key: "DATABASE_URL", label: "Neon Postgres URL", hint: "https://console.neon.tech/" },
    { key: "ANTHROPIC_API_KEY", label: "Anthropic (Claude)" },
    { key: "OPENAI_API_KEY", label: "OpenAI (embeddings)" },
    { key: "GOOGLE_GENERATIVE_AI_API_KEY", label: "Google (Gemini)" },
    { key: "XAI_API_KEY", label: "xAI (Grok)" },
  ];
  return keys.map((k) => ({
    key: k.key,
    label: k.label,
    ok: Boolean(process.env[k.key]),
    hint: k.hint,
  }));
}

export function isFullyConfigured(): boolean {
  return setupStatus().every((c) => c.ok);
}
