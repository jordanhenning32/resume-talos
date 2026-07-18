import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env", override: true });

import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { kbFacts } from "@/db/schema";

const PINNED_FACT_IDS = [
  "v1O3hdCcPewlwYJ4N6Zqh",
  "K-kTU3yyhi4hVsyxWwuS7",
  "candidate-fac-ppm-it-lapsed",
];

async function main() {
  const rows = await db()
    .select({ id: kbFacts.id })
    .from(kbFacts)
    .where(inArray(kbFacts.id, PINNED_FACT_IDS));
  const found = new Set(rows.map((r) => r.id));
  const missing = PINNED_FACT_IDS.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new Error(`Pinned fact rows missing: ${missing.join(", ")}`);
  }

  await db()
    .update(kbFacts)
    .set({ pinned: "true", updatedAt: new Date() })
    .where(inArray(kbFacts.id, PINNED_FACT_IDS));
  console.log(`Pinned ${PINNED_FACT_IDS.length} existing KB fact rows.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
