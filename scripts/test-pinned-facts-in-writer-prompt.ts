import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env", override: true });

import { getPinnedFacts } from "@/lib/agents/retriever";
import { renderPinnedFactsBlock } from "@/lib/agents/resume-writer";

const PINNED_FACT_IDS = [
  "v1O3hdCcPewlwYJ4N6Zqh",
  "K-kTU3yyhi4hVsyxWwuS7",
  "candidate-fac-ppm-it-lapsed",
];

async function main() {
  const facts = await getPinnedFacts();
  const block = renderPinnedFactsBlock(facts);
  for (const id of PINNED_FACT_IDS) {
    if (!block.includes(id)) {
      throw new Error(`Pinned block missing ${id}:\n${block}`);
    }
  }
  for (const fact of facts) {
    if (!block.includes(fact.content.slice(0, Math.min(20, fact.content.length)))) {
      throw new Error(`Pinned block missing content for ${fact.id}`);
    }
  }
  console.log(`PASS pinned writer prompt includes ${PINNED_FACT_IDS.length} required IDs.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
