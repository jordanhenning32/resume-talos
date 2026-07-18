import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  console.log("\n=== Application versions ===");
  const rows = await sql`
    SELECT
      id,
      application_id,
      version_number,
      iteration,
      length(coalesce(resume_markdown, '')) as resume_len,
      length(coalesce(cover_letter_markdown, '')) as cover_len,
      jsonb_array_length(coalesce(cited_fact_ids, '[]'::jsonb)) as cited_count,
      created_at
    FROM application_versions
    ORDER BY created_at DESC
  `;
  console.table(rows);

  console.log("\n=== Recent writer agent_runs ===");
  const runs = await sql`
    SELECT agent_name, status, error,
      input_tokens, output_tokens, cost_usd,
      EXTRACT(EPOCH FROM (completed_at - started_at))::int as duration_s,
      started_at
    FROM agent_runs
    WHERE agent_name LIKE 'writer_%'
    ORDER BY started_at DESC
    LIMIT 8
  `;
  console.table(runs);
}
main().catch((e) => { console.error(e); process.exit(1); });
