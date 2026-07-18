import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env" });

import { neon } from "@neondatabase/serverless";

const APP_ID = process.argv[2] ?? "gu2YHgg3PC2chM9FjPD4f";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    SELECT id, output, started_at
    FROM agent_runs
    WHERE application_id = ${APP_ID}
      AND agent_name = 'kb_gap_query_expander'
    ORDER BY started_at DESC
    LIMIT 1
  `) as Array<{ id: string; output: any; started_at: string }>;

  if (rows.length === 0) {
    console.log("(no kb_gap_query_expander run found for this app)");
    return;
  }
  const out = rows[0].output;
  const expansions = out?.object?.expansions ?? out?.expansions;
  if (!expansions) {
    console.log("Output shape:", JSON.stringify(Object.keys(out ?? {})));
    console.log(JSON.stringify(out, null, 2).slice(0, 2000));
    return;
  }
  for (const e of expansions) {
    console.log(`\n"${e.skill}"`);
    for (const v of e.variants ?? []) {
      console.log(`   → ${v}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
