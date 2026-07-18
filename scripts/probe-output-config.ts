import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });

async function main() {
  const key = process.env.ANTHROPIC_API_KEY!;
  const body = {
    model: "claude-opus-4-7",
    max_tokens: 256,
    messages: [{ role: "user", content: "Return a small object with name='x' and age=1" }],
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: { name: { type: "string" }, age: { type: "number" } },
          required: ["name", "age"],
          additionalProperties: false,
        },
      },
    },
  };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  console.log("status:", res.status);
  const text = await res.text();
  console.log(text.slice(0, 800));
}
main().catch((e) => { console.error(e); process.exit(1); });
