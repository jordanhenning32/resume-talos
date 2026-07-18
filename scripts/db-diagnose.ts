import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });
import { neon } from "@neondatabase/serverless";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  const sql = neon(process.env.DATABASE_URL);

  console.log("\n=== Documents ===");
  const docs = await sql`
    SELECT
      d.id, d.name, d.file_type,
      (SELECT count(*) FROM kb_chunks  WHERE document_id = d.id)::int as chunks,
      (SELECT count(*) FROM kb_facts  WHERE document_id = d.id)::int as facts
    FROM kb_documents d
    ORDER BY d.uploaded_at DESC
  `;
  console.table(docs);

  console.log("\n=== Orphan facts (document_id IS NULL) ===");
  const orphans = await sql`SELECT count(*)::int as count FROM kb_facts WHERE document_id IS NULL`;
  console.log(orphans);

  console.log("\n=== Totals ===");
  const totals = await sql`
    SELECT
      (SELECT count(*) FROM kb_documents)::int as documents,
      (SELECT count(*) FROM kb_chunks)::int    as chunks,
      (SELECT count(*) FROM kb_facts)::int     as facts
  `;
  console.log(totals);
}

main().catch((e) => { console.error(e); process.exit(1); });
