import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env", override: true });

import { retrieveGroupedFacts } from "@/lib/agents/retriever";

async function main() {
  try {
    const result = await retrieveGroupedFacts({
      query: "leadership program management stakeholder",
      perTypeK: 5,
      overflow: { enabled: true, topK: 20, similarityFloor: 0.4 },
    });

    for (const group of result.groups) {
      const seen = new Set<string>();
      for (const fact of group.facts) {
        if (seen.has(fact.id)) {
          throw new Error(`duplicate fact id ${fact.id} in ${group.factType}`);
        }
        seen.add(fact.id);
      }
    }

    console.log("PASS");
    process.exit(0);
  } catch (err) {
    console.log(`FAIL: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();
