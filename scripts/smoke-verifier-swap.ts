import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env" });

import { detectKbGaps } from "@/lib/agents/kb-gap-detector";
import { neon } from "@neondatabase/serverless";

async function main() {
  // Confirm which model the verifier role currently resolves to so we can
  // be sure the swap took effect before paying for the call.
  const verifierModel = process.env.MODEL_VERIFIER ?? "(default)";
  console.log(`MODEL_VERIFIER env = ${verifierModel}\n`);

  // Exercise the kb_gap_query_expander (routes through "verifier" role).
  // Targets the same skill list we used to diagnose the Pearson app earlier
  // so we can compare variants side-by-side against the Haiku baseline.
  const skills = [
    "bachelor's degree",
    "Jira and Confluence proficiency",
    "executive communication",
    "5+ years program management experience",
    "stakeholder management",
  ];

  const t0 = Date.now();
  const report = await detectKbGaps({
    mustHaveSkills: skills,
    niceToHaveSkills: [],
    context: { roleTitle: "Data Program Manager", companyName: "Pearson" },
  });
  const sec = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`Ran in ${sec}s · embed cost $${report.embedCostUsd.toFixed(4)}\n`);
  for (const c of report.mustHave) {
    console.log(`[${c.verdict}] ${c.skill}  strong=${c.strongMatches}  bestSim=${c.bestSimilarity.toFixed(3)}`);
    for (const s of c.topFactSnippets) {
      console.log(`   - ${s.slice(0, 130)}`);
    }
  }

  // Pull the variants the model actually generated from the most recent
  // expander run.
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    SELECT agent_name, model, status, cost_usd, output, started_at
    FROM agent_runs
    WHERE agent_name = 'kb_gap_query_expander'
    ORDER BY started_at DESC
    LIMIT 1
  `) as Array<{
    agent_name: string;
    model: string;
    status: string;
    cost_usd: number;
    output: any;
    started_at: string;
  }>;
  if (rows[0]) {
    console.log(`\n=== Most-recent kb_gap_query_expander run ===`);
    console.log(`  model: ${rows[0].model}`);
    console.log(`  status: ${rows[0].status}  cost: $${rows[0].cost_usd}`);
    const exp = rows[0].output?.object?.expansions ?? [];
    console.log(`  variants:`);
    for (const e of exp) {
      console.log(`    "${e.skill}"`);
      for (const v of e.variants ?? []) console.log(`       → ${v}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
