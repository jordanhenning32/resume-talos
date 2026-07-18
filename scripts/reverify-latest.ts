import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env", override: true });

import { neon } from "@neondatabase/serverless";
import { runVerifierForApplication } from "@/lib/applications/export";

const APP_ID = "NQP2fHmUoerjbEEvsuXrw";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  console.log("\n=== Re-verifying GDIT latest version with tightened prompt ===\n");
  const r = await runVerifierForApplication(APP_ID);
  console.log(
    `passed=${r.passed}  critical=${r.criticalCount}  warning=${r.warningCount}  $${r.costUsd.toFixed(4)}`,
  );
  console.log(`summary: ${r.summary}\n`);

  // Print the actual stored issues for inspection
  const rows = (await sql`
    SELECT version_number, iteration, verifier_passed, verifier_issues
    FROM application_versions
    WHERE application_id = ${APP_ID}
    ORDER BY version_number DESC, iteration DESC
    LIMIT 1
  `) as Array<{
    version_number: number;
    iteration: number;
    verifier_passed: string;
    verifier_issues: Array<{ claim: string; reason: string; severity: string }> | null;
  }>;
  const row = rows[0];
  console.log(`v${row.version_number}.${row.iteration}  passed=${row.verifier_passed}  issues=${row.verifier_issues?.length ?? 0}`);
  for (const i of row.verifier_issues ?? []) {
    console.log(`\n[${i.severity}] "${i.claim.slice(0, 180)}"`);
    console.log(`   → ${i.reason.slice(0, 320)}`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
