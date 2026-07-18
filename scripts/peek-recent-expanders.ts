import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env" });
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    SELECT id, application_id, output, started_at
    FROM agent_runs
    WHERE agent_name = 'kb_gap_query_expander'
    ORDER BY started_at DESC
    LIMIT 20
  `) as Array<{ id: string; application_id: string | null; output: any; started_at: string }>;
  for (const r of rows) {
    console.log(`\n=== run ${r.id} (app=${r.application_id ?? "null"}, ${r.started_at}) ===`);
    const exp = r.output?.object?.expansions ?? r.output?.expansions ?? [];
    for (const e of exp) {
      console.log(`  "${e.skill}"`);
      for (const v of e.variants ?? []) console.log(`     → ${v}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
