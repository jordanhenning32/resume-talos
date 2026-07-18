/**
 * Collapse alias employer labels in kb_facts.metadata.company to one canonical
 * string per employer. Fragmented labels (e.g. "SSA" vs "Social Security
 * Administration") split a single job into multiple canonical-timeline rows
 * and weaken the verifier's company matching, which surfaces as duplicated or
 * mixed-up Experience entries.
 *
 * Reversible: the prior label is preserved in metadata.companyRaw and every
 * change is stamped metadata.companyNormalized = true.
 *
 * Deliberately NOT merged: "U.S. Federal Government" and "VA" (ambiguous /
 * not one of the candidate's known employers) are left for manual review.
 *
 *   pnpm tsx scripts/normalize-company-labels.ts           # dry-run
 *   pnpm tsx scripts/normalize-company-labels.ts --apply
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env", override: true });

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { kbFacts } from "@/db/schema";

const APPLY = process.argv.includes("--apply");

// alias label (lowercased) -> canonical label
const MERGE: Record<string, string> = {
  ssa: "Social Security Administration",
  "social security": "Social Security Administration",
  "office of hearings operations": "Social Security Administration",
  "us army": "U.S. Army",
  "u.s. army": "U.S. Army",
};

async function main() {
  const rows = await db()
    .select({ id: kbFacts.id, company: sql<string>`${kbFacts.metadata}->>'company'` })
    .from(kbFacts)
    .where(sql`${kbFacts.metadata}->>'company' IS NOT NULL`);

  let changed = 0;
  const plan: Record<string, number> = {};
  for (const row of rows) {
    const raw = row.company?.trim();
    if (!raw) continue;
    const canonical = MERGE[raw.toLowerCase()];
    if (!canonical || canonical === raw) continue;
    plan[`${raw} → ${canonical}`] = (plan[`${raw} → ${canonical}`] ?? 0) + 1;
    changed++;
    if (APPLY) {
      const patch = { company: canonical, companyRaw: raw, companyNormalized: true };
      await db()
        .update(kbFacts)
        .set({ metadata: sql`${kbFacts.metadata} || ${JSON.stringify(patch)}::jsonb`, updatedAt: new Date() })
        .where(sql`${kbFacts.id} = ${row.id}`);
    }
  }

  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.table(Object.entries(plan).map(([change, n]) => ({ change, n })));
  console.log(`${APPLY ? "Updated" : "Would update"} ${changed} facts.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
