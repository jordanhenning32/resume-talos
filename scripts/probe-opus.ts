import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });

async function tryModel(model: string) {
  const key = process.env.ANTHROPIC_API_KEY!;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 32,
      messages: [{ role: "user", content: "ping" }],
    }),
  });
  const body = await res.text();
  console.log(`[${model}] status=${res.status}  body=${body.slice(0, 250)}`);
}

async function main() {
  await tryModel("claude-opus-4-7");
  await tryModel("claude-haiku-4-5");
  await tryModel("claude-haiku-4-5-20251001");
  await tryModel("claude-sonnet-4-6");
}
main().catch((e) => { console.error(e); process.exit(1); });
