import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  console.log("\n=== Application versions ===");
  const v = await sql`
    SELECT id, iteration, is_final,
      (qc_a_score->>'overall')::int as a,
      (qc_b_score->>'overall')::int as b,
      (screener_score->>'overall')::int as s,
      length(coalesce(resume_markdown,'')) as resume_len,
      length(coalesce(cover_letter_markdown,'')) as cover_len,
      created_at
    FROM application_versions
    WHERE application_id = 'NQP2fHmUoerjbEEvsuXrw'
    ORDER BY iteration ASC
  `;
  console.table(v);

  console.log("\n=== All QC agent_runs ===");
  const runs = await sql`
    SELECT agent_name, status, error,
      input_tokens, output_tokens, cost_usd,
      EXTRACT(EPOCH FROM (completed_at - started_at))::int as duration_s,
      started_at
    FROM agent_runs
    WHERE agent_name LIKE 'qc_%' OR agent_name LIKE 'screener%' OR agent_name LIKE 'writer_%revise%'
    ORDER BY started_at DESC
    LIMIT 20
  `;
  console.table(runs);

  console.log("\n=== qc_reviews summary ===");
  const reviews = await sql`
    SELECT reviewer, overall_score,
      jsonb_array_length(coalesce(critical_issues,'[]'::jsonb)) as critical,
      jsonb_array_length(coalesce(important_improvements,'[]'::jsonb)) as important,
      jsonb_array_length(coalesce(minor_suggestions,'[]'::jsonb)) as minor
    FROM qc_reviews
    ORDER BY created_at DESC
    LIMIT 9
  `;
  console.table(reviews);
}
main().catch((e) => { console.error(e); process.exit(1); });
