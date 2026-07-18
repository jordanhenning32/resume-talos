import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env", override: true });

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { kbFacts } from "@/db/schema";

const REPORT = ".pipeline/devteam_2026-05-19_backfill-report.md";

async function main() {
  const [totalMissing] = await db()
    .select({ count: sql<number>`count(*)::int` })
    .from(kbFacts)
    .where(sql`${kbFacts.metadata}->>'company' IS NULL`);
  const breakdown = await db()
    .select({
      factType: kbFacts.factType,
      count: sql<number>`count(*)::int`,
    })
    .from(kbFacts)
    .where(sql`${kbFacts.metadata}->>'company' IS NULL`)
    .groupBy(kbFacts.factType)
    .orderBy(kbFacts.factType);

  console.log(`Facts missing metadata.company: ${totalMissing?.count ?? 0}`);
  console.table(breakdown);

  const prior = existsSync(REPORT) ? readFileSync(REPORT, "utf8") : "";
  const label = prior.includes("## BEFORE") ? "AFTER" : "BEFORE";
  const lines = [
    "",
    `## ${label} attribution audit - ${new Date().toISOString()}`,
    "",
    `Facts missing metadata.company: ${totalMissing?.count ?? 0}`,
    "",
    "| fact_type | missing_count |",
    "| --- | ---: |",
    ...breakdown.map((r) => `| ${r.factType} | ${r.count} |`),
    "",
  ];
  appendFileSync(REPORT, `${lines.join("\n")}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
