import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env", override: true });

async function main() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("no ANTHROPIC_API_KEY");

  const res = await fetch("https://api.anthropic.com/v1/models?limit=50", {
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
  });
  console.log("Status:", res.status);
  const body = await res.text();
  console.log(body.slice(0, 8000));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
