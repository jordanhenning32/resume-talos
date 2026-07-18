import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  console.log("\n=== Facts mentioning Futures Bot (FULL CONTENT) ===\n");
  const rows = await sql`
    SELECT id, fact_type, content, evidence_quote, metadata
    FROM kb_facts
    WHERE content ILIKE '%futures bot%'
       OR content ILIKE '%futures-bot%'
       OR evidence_quote ILIKE '%futures bot%'
    ORDER BY fact_type, content
  `;
  for (const r of rows as Array<{
    id: string;
    fact_type: string;
    content: string;
    evidence_quote: string | null;
    metadata: Record<string, unknown>;
  }>) {
    console.log(`--- [${r.id}] (${r.fact_type}) ---`);
    console.log(`content: ${r.content}`);
    if (r.evidence_quote) console.log(`evidence: ${r.evidence_quote}`);
    console.log(`metadata: ${JSON.stringify(r.metadata)}`);
    console.log("");
  }
  console.log(`Total: ${rows.length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
