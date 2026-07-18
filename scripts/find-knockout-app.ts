import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env" });
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    SELECT id, role, company, knockout_report
    FROM applications
    WHERE knockout_report IS NOT NULL
    ORDER BY knockout_report_at DESC NULLS LAST
    LIMIT 10
  `) as Array<{ id: string; role: string; company: string; knockout_report: any }>;
  for (const r of rows) {
    const kos = r.knockout_report?.knockouts ?? [];
    console.log(`\n${r.id}  ${r.role} @ ${r.company}  (${kos.length} knockouts)`);
    for (const k of kos.slice(0, 4)) {
      console.log(`  [${k.category}] ${k.requirement?.slice(0, 80)}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
