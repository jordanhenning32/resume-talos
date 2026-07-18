import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });

import { neon } from "@neondatabase/serverless";
import { simulateAtsScan } from "@/lib/agents/ats-simulator";
import { getApplicationById } from "@/lib/applications/create";
import type { JdAnalysis } from "@/lib/agents/jd-analyzer";

const APP_ID = "NQP2fHmUoerjbEEvsuXrw";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    SELECT resume_markdown, version_number, iteration
    FROM application_versions
    WHERE application_id = ${APP_ID}
    ORDER BY version_number DESC, iteration DESC
    LIMIT 1
  `) as Array<{ resume_markdown: string; version_number: number; iteration: number }>;
  const v = rows[0];
  if (!v) throw new Error("no version");

  const app = await getApplicationById(APP_ID);
  if (!app?.jdAnalysis) throw new Error("no analysis");
  const a = app.jdAnalysis as unknown as JdAnalysis;

  console.log(`\n=== ATS scan of GDIT v${v.version_number}.${v.iteration} ===\n`);
  const report = simulateAtsScan({
    resumeMarkdown: v.resume_markdown,
    mustHaveSkills: a.mustHaveSkills,
    niceToHaveSkills: a.niceToHaveSkills,
    keyLanguagePatterns: a.keyLanguagePatterns,
  });

  console.log(
    `Overall: ${report.overallScore}/100  (${report.verbatimCount} verbatim, ${report.partialCount} partial, ${report.missingCount} missing)\n`,
  );
  console.log("Must-haves:");
  for (const c of report.mustHave) {
    const badge =
      c.verdict === "verbatim" ? "✓ verbatim"
      : c.verdict === "partial" ? `~ partial (${c.matchedContentWords}/${c.totalContentWords})`
      : "✗ missing";
    console.log(`  ${badge.padEnd(28)} ${c.phrase}`);
    if (c.matchSnippet && c.verdict !== "verbatim") {
      console.log(`      └─ ${c.matchSnippet.slice(0, 110)}`);
    }
  }
  console.log("\nKey language patterns:");
  for (const c of report.keyLanguagePatterns) {
    const badge =
      c.verdict === "verbatim" ? "✓ verbatim"
      : c.verdict === "partial" ? `~ partial (${c.matchedContentWords}/${c.totalContentWords})`
      : "✗ missing";
    console.log(`  ${badge.padEnd(28)} ${c.phrase}`);
  }
  if (report.overallScore <= 0 || report.mustHave.length === 0) {
    throw new Error("Expected a non-empty ATS report with a positive score.");
  }
  console.log(`\nPASS ATS simulator produced score ${report.overallScore}/100.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
