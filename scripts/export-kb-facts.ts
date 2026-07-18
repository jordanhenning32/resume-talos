/**
 * READ-ONLY export of all live KB facts, grouped by type. Makes NO writes.
 * Used to ground resume generation in the actual RAG content.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env", override: true });

import { asc } from "drizzle-orm";
import { db } from "@/db";
import { kbFacts } from "@/db/schema";

async function main() {
  const facts = await db()
    .select({
      id: kbFacts.id,
      factType: kbFacts.factType,
      content: kbFacts.content,
      metadata: kbFacts.metadata,
      pinned: kbFacts.pinned,
      userAdded: kbFacts.userAdded,
    })
    .from(kbFacts)
    .orderBy(asc(kbFacts.factType));

  const byType: Record<string, string[]> = {};
  for (const f of facts) {
    const flags = [f.pinned === "true" ? "PINNED" : "", f.userAdded === "true" ? "USER" : ""]
      .filter(Boolean)
      .join(",");
    (byType[f.factType] ??= []).push(`${flags ? `(${flags}) ` : ""}${f.content}`);
  }

  for (const type of Object.keys(byType).sort()) {
    console.log(`\n########## ${type.toUpperCase()} (${byType[type].length}) ##########`);
    for (const line of byType[type]) console.log(`- ${line}`);
  }
  console.log(`\n===== TOTAL FACTS: ${facts.length} =====`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
