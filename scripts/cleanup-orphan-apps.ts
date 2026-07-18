// Delete application rows that got stuck mid-pipeline (fit score never landed).
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const orphans = await sql`
    DELETE FROM applications
    WHERE status = 'draft' AND fit_score IS NULL
    RETURNING id, company, role
  ` as Array<{ id: string; company: string; role: string }>;
  console.log(`Removed ${orphans.length} orphaned draft application(s):`);
  for (const o of orphans) {
    console.log(`  - ${o.id}: ${o.role} @ ${o.company}`);
  }
  const remaining = await sql`SELECT count(*)::int as count FROM applications`;
  console.log(`Remaining applications:`, remaining);
}
main().catch((e) => { console.error(e); process.exit(1); });
