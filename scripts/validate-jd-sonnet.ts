import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env", override: true });

import { neon } from "@neondatabase/serverless";
import { analyzeJobDescription, type JdAnalysis } from "@/lib/agents/jd-analyzer";

const APP_ID = "NQP2fHmUoerjbEEvsuXrw"; // GDIT

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    SELECT jd_text, jd_analysis FROM applications WHERE id = ${APP_ID}
  `) as Array<{ jd_text: string; jd_analysis: JdAnalysis | null }>;
  const row = rows[0];
  if (!row?.jd_text) throw new Error("no JD text on the application");
  if (!row.jd_analysis) throw new Error("no prior JD analysis on the application");
  const opus = row.jd_analysis;

  console.log(`\n=== Re-running JD analysis on GDIT with the new Sonnet routing ===\n`);
  console.log(`JD length: ${row.jd_text.length} chars`);

  const t0 = Date.now();
  const result = await analyzeJobDescription({
    jdText: row.jd_text,
    applicationId: APP_ID,
  });
  const t1 = Date.now();
  const sonnet = result.analysis;

  console.log(`Sonnet run cost:  $${result.costUsd.toFixed(4)}  in ${((t1 - t0) / 1000).toFixed(1)}s\n`);

  // Cost-of-the-prior-Opus-run lookup for direct comparison
  const opusCost = (await sql`
    SELECT cost_usd, EXTRACT(EPOCH FROM (completed_at - started_at))::int AS secs
    FROM agent_runs
    WHERE application_id = ${APP_ID}
      AND agent_name = 'jd_analyzer'
      AND model = 'claude-opus-4-7'
    ORDER BY started_at DESC LIMIT 1
  `) as Array<{ cost_usd: number; secs: number }>;
  if (opusCost[0]) {
    const drop = (1 - result.costUsd / opusCost[0].cost_usd) * 100;
    console.log(`Prior Opus run:   $${opusCost[0].cost_usd.toFixed(4)}  in ${opusCost[0].secs}s`);
    console.log(`Cost change:      ${drop >= 0 ? "−" : "+"}${Math.abs(drop).toFixed(1)}%\n`);
  }

  console.log("=== Structured-output diff (Opus → Sonnet) ===\n");

  function sameArrayContents(a: string[] = [], b: string[] = []): { added: string[]; removed: string[] } {
    const ASet = new Set(a.map((s) => s.toLowerCase().trim()));
    const BSet = new Set(b.map((s) => s.toLowerCase().trim()));
    const added = b.filter((s) => !ASet.has(s.toLowerCase().trim()));
    const removed = a.filter((s) => !BSet.has(s.toLowerCase().trim()));
    return { added, removed };
  }

  function show(label: string, opusVal: unknown, sonnetVal: unknown) {
    const same = JSON.stringify(opusVal) === JSON.stringify(sonnetVal);
    if (same) {
      console.log(`  ${label}: identical`);
    } else {
      console.log(`  ${label}:`);
      console.log(`    Opus  : ${JSON.stringify(opusVal)}`);
      console.log(`    Sonnet: ${JSON.stringify(sonnetVal)}`);
    }
  }

  show("companyName     ", opus.companyName, sonnet.companyName);
  show("roleTitle       ", opus.roleTitle, sonnet.roleTitle);
  show("seniorityLevel  ", opus.seniorityLevel, sonnet.seniorityLevel);
  show("teamFunction    ", opus.teamFunction, sonnet.teamFunction);
  show("locationMode    ", opus.locationMode, sonnet.locationMode);
  show("experienceYears ", opus.experienceYears, sonnet.experienceYears);

  console.log("");
  for (const field of ["mustHaveSkills", "niceToHaveSkills", "successSignals", "keyLanguagePatterns", "responsibilities", "redFlags"] as const) {
    const diff = sameArrayContents(opus[field] as string[], sonnet[field] as string[]);
    const totalOpus = (opus[field] as string[]).length;
    const totalSonnet = (sonnet[field] as string[]).length;
    console.log(`  ${field.padEnd(22)} Opus=${totalOpus}  Sonnet=${totalSonnet}  added=${diff.added.length}  removed=${diff.removed.length}`);
    if (diff.added.length > 0) console.log(`    + ${diff.added.slice(0, 5).join(" | ")}`);
    if (diff.removed.length > 0) console.log(`    - ${diff.removed.slice(0, 5).join(" | ")}`);
  }

  console.log("\n  oneSentenceSummary:");
  console.log(`    Opus  : ${opus.oneSentenceSummary}`);
  console.log(`    Sonnet: ${sonnet.oneSentenceSummary}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
