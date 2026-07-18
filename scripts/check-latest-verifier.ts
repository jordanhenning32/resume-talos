import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`
    SELECT version_number, iteration, verifier_passed, verifier_issues
    FROM application_versions
    WHERE application_id = 'NQP2fHmUoerjbEEvsuXrw'
    ORDER BY version_number DESC, iteration DESC
    LIMIT 1
  ` as Array<{
    version_number: number;
    iteration: number;
    verifier_passed: string;
    verifier_issues: Array<{ claim: string; reason: string; severity: string }> | null;
  }>;
  const row = rows[0];
  console.log(`v${row.version_number}.${row.iteration} passed=${row.verifier_passed} issues=${row.verifier_issues?.length ?? 0}\n`);
  for (const i of row.verifier_issues ?? []) {
    console.log(`[${i.severity}] "${i.claim.slice(0, 160)}"`);
    console.log(`   → ${i.reason.slice(0, 320)}\n`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
