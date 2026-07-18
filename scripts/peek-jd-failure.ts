import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env" });
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    SELECT id, application_id, status, error, input_tokens, output_tokens,
           cost_usd, output, started_at, completed_at
    FROM agent_runs
    WHERE agent_name = 'jd_analyzer'
    ORDER BY started_at DESC
    LIMIT 5
  `) as Array<{
    id: string;
    application_id: string | null;
    status: string;
    error: string | null;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
    output: any;
    started_at: string;
    completed_at: string | null;
  }>;
  for (const r of rows) {
    console.log(`\n--- ${r.started_at}  app=${r.application_id}  status=${r.status} ---`);
    console.log(`  tokens: in=${r.input_tokens}  out=${r.output_tokens}  cost=$${r.cost_usd}`);
    if (r.error) {
      console.log(`  ERROR: ${r.error.slice(0, 2000)}`);
    }
    if (r.output) {
      const outStr = JSON.stringify(r.output);
      console.log(`  output (first 400 chars): ${outStr.slice(0, 400)}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
