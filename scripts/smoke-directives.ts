import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env" });

import { getWriterDirectives } from "@/lib/settings";

async function main() {
  const d = await getWriterDirectives();
  console.log("=== Persisted writer directives ===\n");
  console.log(`Personal site: ${d.personalSite?.url}`);
  console.log(`Contact phone:    ${d.contact?.phone}`);
  console.log(`Contact location: ${d.contact?.location}`);
  console.log(`Contact email:    ${d.contact?.email}`);
  console.log("\nGlobal rules:");
  for (const r of d.globalRules) console.log(`  - ${r}`);
  if (!d.personalSite?.url || !d.contact?.email || d.globalRules.length === 0) {
    throw new Error("Writer directives are missing required persisted fields.");
  }
  console.log(`\nPASS writer directives loaded ${d.globalRules.length} global rules.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
