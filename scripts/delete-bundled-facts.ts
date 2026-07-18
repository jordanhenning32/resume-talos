// Delete the two bundled "RFP Factory and Futures Bot" facts that don't
// distinguish ownership. New cleaner facts will be POSTed via /api/kb/facts.
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env", override: true });
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const result = await sql`
    DELETE FROM kb_facts
    WHERE id IN ('T6xiDdhTOUG6lHeWui738', 'MMMitp3mQEE3YQvu6uU5G')
    RETURNING id, content
  ` as Array<{ id: string; content: string }>;
  for (const r of result) {
    console.log(`✗ deleted [${r.id}] ${r.content.slice(0, 160)}`);
  }
  console.log(`Total deleted: ${result.length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
