import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env", override: true });

import { generateDraftsForApplication } from "@/lib/applications/drafts";
import { runVerifierForApplication } from "@/lib/applications/export";
import { neon } from "@neondatabase/serverless";

const APP_ID = "NQP2fHmUoerjbEEvsuXrw";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  console.log(`\n=== Validating writer fix on application ${APP_ID} ===\n`);

  console.log("Step 1/2 — generating fresh drafts (this will create a new versionNumber)...");
  const t0 = Date.now();
  const draft = await generateDraftsForApplication(APP_ID);
  const t1 = Date.now();
  console.log(
    `  → version ${draft.version.versionNumber}.${draft.version.iteration}  ` +
      `(resume facts=${draft.factsUsedResume}, cover facts=${draft.factsUsedCoverLetter})  ` +
      `cost=$${draft.costUsd.toFixed(3)}  in ${(t1 - t0) / 1000}s`,
  );

  console.log("\nStep 2/2 — running verifier on new draft...");
  const v0 = Date.now();
  const ver = await runVerifierForApplication(APP_ID);
  const v1 = Date.now();
  console.log(
    `  → passed=${ver.passed}  critical=${ver.criticalCount}  warning=${ver.warningCount}  ` +
      `factsLoaded=${ver.factsLoaded}  cost=$${ver.costUsd.toFixed(3)}  in ${(v1 - v0) / 1000}s`,
  );
  console.log(`  summary: ${ver.summary}`);

  console.log("\n=== Verifier issues on new version ===");
  const rows = (await sql`
    SELECT iteration, version_number, verifier_passed, verifier_issues, resume_markdown, cover_letter_markdown
    FROM application_versions
    WHERE application_id = ${APP_ID}
    ORDER BY version_number DESC, iteration DESC
    LIMIT 1
  `) as Array<{
    iteration: number;
    version_number: number;
    verifier_passed: string;
    verifier_issues: Array<{ claim: string; reason: string; severity: string }> | null;
    resume_markdown: string;
    cover_letter_markdown: string;
  }>;
  const row = rows[0];
  if (!row) {
    console.log("(no version found)");
    return;
  }
  console.log(
    `Version: v${row.version_number}.${row.iteration}  passed=${row.verifier_passed}  ` +
      `issues=${row.verifier_issues?.length ?? 0}`,
  );
  for (const i of row.verifier_issues ?? []) {
    console.log(`\n  [${i.severity}] "${i.claim.slice(0, 180)}"`);
    console.log(`     → ${i.reason.slice(0, 320)}`);
  }

  console.log("\n=== Key claim sweep (for parrot hallucinations) ===");
  const haystack = `${row.resume_markdown}\n\n${row.cover_letter_markdown}`.toLowerCase();
  const probes = [
    "$120m",
    "120m p&l",
    "$30m",
    "30m+ capture",
    "16+ years",
    "16 years",
    "352-person",
    "352 person",
  ];
  for (const p of probes) {
    console.log(`  ${haystack.includes(p) ? "FOUND " : "absent"}  ${p}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
