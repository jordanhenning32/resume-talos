import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  console.log("\n=== Facts mentioning Futures Bot ===");
  const rows = await sql`
    SELECT id, fact_type, content, metadata->>'company' as company
    FROM kb_facts
    WHERE content ILIKE '%futures bot%'
       OR content ILIKE '%futures-bot%'
       OR evidence_quote ILIKE '%futures bot%'
    ORDER BY fact_type, content
  `;
  for (const r of rows as Array<{ id: string; fact_type: string; content: string; company: string | null }>) {
    const flag = r.company && /quadratic/i.test(r.company) ? "  ✗ WRONG COMPANY" : "";
    console.log(`[${r.id}] (${r.fact_type}) company=${r.company ?? "—"}${flag}`);
    console.log(`  ${r.content.slice(0, 180)}`);
    console.log("");
  }
  console.log(`Total: ${rows.length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
