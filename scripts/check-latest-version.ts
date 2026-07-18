import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    SELECT id, version_number, iteration, is_final,
      (qc_a_score->>'overall') AS qc_a, (qc_b_score->>'overall') AS qc_b,
      (screener_score->>'overall') AS screener, verifier_passed
    FROM application_versions
    WHERE application_id = 'NQP2fHmUoerjbEEvsuXrw'
    ORDER BY version_number DESC, iteration DESC
    LIMIT 3
  `);
  console.table(rows);
}
main().catch(console.error);
