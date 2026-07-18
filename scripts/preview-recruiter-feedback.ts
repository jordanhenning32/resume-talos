import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });

import { neon } from "@neondatabase/serverless";
import {
  recruiterSimToFeedbackItems,
  type RecruiterSimulation,
} from "@/lib/agents/recruiter-simulator";

const APP_ID = "NQP2fHmUoerjbEEvsuXrw";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    SELECT recruiter_screener_result, recruiter_screener_at
    FROM applications
    WHERE id = ${APP_ID}
    LIMIT 1
  `) as Array<{
    recruiter_screener_result: RecruiterSimulation | null;
    recruiter_screener_at: Date | null;
  }>;
  const row = rows[0];
  if (!row?.recruiter_screener_result) {
    throw new Error(
      "No recruiter sim result on GDIT app. Run scripts/smoke-recruiter-sim.ts first.",
    );
  }
  const sim = row.recruiter_screener_result;

  console.log(`\n=== Recruiter sim result for GDIT (current cached) ===\n`);
  console.log(`Advance: ${sim.advanceScore}/100  (${sim.recommendation})\n`);
  console.log(`Top concerns:`);
  for (const c of sim.topConcerns) console.log(`  · ${c}`);
  console.log();

  const items = recruiterSimToFeedbackItems(sim);

  console.log(
    `=== Feedback items the writer would receive on next QC iteration ===\n`,
  );
  console.log(
    `${items.length} items (${items.filter((i) => i.priority === "high").length} high, ${items.filter((i) => i.priority === "medium").length} medium)\n`,
  );
  for (const it of items) {
    console.log(`[${it.priority.toUpperCase().padEnd(6)}] (${it.doc.padEnd(13)}) ${it.issue.slice(0, 220)}`);
    console.log(`         → ${it.suggestion.slice(0, 240)}\n`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
