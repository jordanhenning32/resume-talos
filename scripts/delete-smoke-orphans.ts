import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env" });
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    DELETE FROM applications
    WHERE role = 'SMOKE TEST — DELETE ME' OR company = 'SMOKE TEST'
    RETURNING id, role, company
  `) as Array<{ id: string; role: string; company: string }>;
  console.log(`Deleted ${rows.length} smoke-test orphan(s):`);
  for (const r of rows) console.log(`  ${r.id}  ${r.role} @ ${r.company}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
