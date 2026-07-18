import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env", override: true });
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`
    SELECT iteration, verifier_passed,
      jsonb_array_length(coalesce(verifier_issues, '[]'::jsonb)) as issue_count,
      verifier_issues
    FROM application_versions
    WHERE application_id = 'NQP2fHmUoerjbEEvsuXrw'
    ORDER BY iteration DESC
    LIMIT 1
  ` as Array<{ iteration: number; verifier_passed: string; issue_count: number; verifier_issues: Array<{ claim: string; reason: string; severity: string }> | null }>;
  const row = rows[0];
  if (!row) {
    console.log("no version found");
    return;
  }
  console.log(`Iteration: ${row.iteration}`);
  console.log(`Passed: ${row.verifier_passed}`);
  console.log(`Issues: ${row.issue_count}`);
  if (row.verifier_issues) {
    for (const i of row.verifier_issues) {
      console.log(`\n  [${i.severity}] "${i.claim.slice(0, 140)}"`);
      console.log(`     → ${i.reason.slice(0, 200)}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
