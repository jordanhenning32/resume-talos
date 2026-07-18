import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
import { anthropic } from "@ai-sdk/anthropic";
import { generateText, generateObject } from "ai";
import { z } from "zod";

async function main() {
  console.log("--- generateText opus-4-7 ---");
  try {
    const r = await generateText({
      model: anthropic("claude-opus-4-7"),
      prompt: "Say pong.",
      maxOutputTokens: 32,
    });
    console.log("ok text:", r.text);
  } catch (e) {
    const err = e as { statusCode?: number; message?: string; url?: string };
    console.error("FAIL text:", err.statusCode, err.message?.slice(0, 200), "url=", err.url);
  }

  console.log("\n--- generateObject opus-4-7 (tiny schema) ---");
  try {
    const r = await generateObject({
      model: anthropic("claude-opus-4-7"),
      schema: z.object({ name: z.string(), age: z.number() }),
      prompt: "Return { name: 'x', age: 1 }",
      maxOutputTokens: 64,
    });
    console.log("ok obj:", r.object);
  } catch (e) {
    const err = e as { statusCode?: number; message?: string; url?: string };
    console.error("FAIL obj:", err.statusCode, err.message?.slice(0, 200), "url=", err.url);
  }

  console.log("\n--- generateObject opus-4-7 with structuredOutputMode='jsonTool' fallback ---");
  try {
    const r = await generateObject({
      model: anthropic("claude-opus-4-7"),
      schema: z.object({ name: z.string(), age: z.number() }),
      prompt: "Return { name: 'x', age: 1 }",
      maxOutputTokens: 64,
      providerOptions: {
        anthropic: {
          structuredOutputMode: "jsonTool",
        },
      },
    });
    console.log("ok obj-jsonTool:", r.object);
  } catch (e) {
    const err = e as { statusCode?: number; message?: string; url?: string };
    console.error("FAIL obj-jsonTool:", err.statusCode, err.message?.slice(0, 200), "url=", err.url);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
