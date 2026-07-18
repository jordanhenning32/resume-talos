import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env" });
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`
    SELECT agent_name, application_id, application_version_id,
           status, cost_usd::numeric(10,5) AS cost_usd,
           started_at
    FROM agent_runs
    WHERE started_at > NOW() - INTERVAL '60 minutes'
    ORDER BY started_at DESC
    LIMIT 40
  `;
  console.table(rows);
}
main().catch((e) => { console.error(e); process.exit(1); });
