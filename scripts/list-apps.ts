import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env", override: true });
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`
    SELECT id, company_slug, role_slug, status, variant, created_at
    FROM applications
    ORDER BY created_at DESC
  `;
  console.table(rows);
}
main().catch((e) => { console.error(e); process.exit(1); });
