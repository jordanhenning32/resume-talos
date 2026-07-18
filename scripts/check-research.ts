import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  console.log("\n=== Applications ===");
  const apps = await sql`
    SELECT id, company, status, fit_approved, variant, market_research_id, market_research_approved
    FROM applications
  `;
  console.table(apps);

  console.log("\n=== Market research rows ===");
  const mr = await sql`
    SELECT id, company_slug, company_name, user_approved,
      (findings IS NOT NULL) as has_findings,
      (tone_profile IS NOT NULL) as has_tone,
      jsonb_array_length(coalesce(sources, '[]'::jsonb)) as source_count,
      length(coalesce(raw_markdown, '')) as raw_len,
      created_at
    FROM market_research
    ORDER BY created_at DESC
  `;
  console.table(mr);

  console.log("\n=== Recent agent_runs for market research ===");
  const runs = await sql`
    SELECT agent_name, status, error, input_tokens, output_tokens, cost_usd,
      EXTRACT(EPOCH FROM (completed_at - started_at))::int as duration_s,
      started_at
    FROM agent_runs
    WHERE agent_name LIKE 'market_research%'
    ORDER BY started_at DESC
    LIMIT 10
  `;
  console.table(runs);
}
main().catch((e) => { console.error(e); process.exit(1); });
