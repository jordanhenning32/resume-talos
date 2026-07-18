import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
import { detectKbGaps } from "@/lib/agents/kb-gap-detector";
import { getApplicationById } from "@/lib/applications/create";
import type { JdAnalysis } from "@/lib/agents/jd-analyzer";

async function main() {
  const app = await getApplicationById("NQP2fHmUoerjbEEvsuXrw");
  if (!app?.jdAnalysis) throw new Error("no jd analysis");
  const a = app.jdAnalysis as unknown as JdAnalysis;

  console.log(`\n=== Re-running gap detection on GDIT JD with query expansion ===\n`);
  const t0 = Date.now();
  const report = await detectKbGaps({
    mustHaveSkills: a.mustHaveSkills,
    niceToHaveSkills: a.niceToHaveSkills,
    context: { roleTitle: a.roleTitle, companyName: a.companyName ?? undefined },
    applicationId: app.id,
  });
  const t1 = Date.now();

  console.log(`Run: ${((t1 - t0) / 1000).toFixed(1)}s, $${report.embedCostUsd.toFixed(5)}`);
  console.log(`Must-have: ${report.wellCoveredMustHaveCount} solid, ${report.thinMustHaveCount} thin, ${report.missingMustHaveCount} missing\n`);
  for (const c of report.mustHave) {
    const verdict = c.verdict.padEnd(13);
    console.log(`  [${verdict}] ${c.strongMatches.toString().padStart(2)} matches  best=${c.bestSimilarity.toFixed(3)}  ${c.skill}`);
  }
  console.log();
  console.log(`Nice-to-have:`);
  for (const c of report.niceToHave) {
    const verdict = c.verdict.padEnd(13);
    console.log(`  [${verdict}] ${c.strongMatches.toString().padStart(2)} matches  best=${c.bestSimilarity.toFixed(3)}  ${c.skill}`);
  }
  if (report.missingMustHaveCount > 0) {
    throw new Error(`Expected no missing must-have skills, got ${report.missingMustHaveCount}.`);
  }
  console.log(`\nPASS gap expansion covered all ${report.mustHave.length} must-have skills.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
