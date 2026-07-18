import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env" });
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`
    SELECT id, company, jd_url
    FROM applications
    WHERE jd_url IS NOT NULL AND jd_url <> ''
    ORDER BY created_at DESC
    LIMIT 20
  ` as Array<{ id: string; company: string; jd_url: string }>;
  console.table(rows);
}
main().catch((e) => { console.error(e); process.exit(1); });
