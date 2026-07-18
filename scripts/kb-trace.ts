// Trace where each suspicious / off-list fact actually came from.
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { neon } from "@neondatabase/serverless";

const ALLOWED_COMPANIES_LC = new Set([
  "u.s. army",
  "us army",
  "mtd products",
  "social security administration",
  "ssa",
  "quadratic digital",
]);

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  const sql = neon(process.env.DATABASE_URL);

  console.log("\n=== Documents in KB ===");
  const docs = await sql`
    SELECT id, name, source_path FROM kb_documents ORDER BY uploaded_at DESC
  `;
  console.table(docs);

  console.log("\n=== Off-list companies in role facts (with source doc) ===");
  const offList = await sql`
    SELECT
      d.name as source_doc,
      f.metadata->>'company' as company,
      f.metadata->>'role' as role,
      f.content,
      f.id as fact_id,
      f.document_id
    FROM kb_facts f
    LEFT JOIN kb_documents d ON d.id = f.document_id
    WHERE f.fact_type = 'role'
      AND f.metadata->>'company' IS NOT NULL
    ORDER BY f.metadata->>'company'
  `;
  for (const row of offList as Array<{
    source_doc: string | null;
    company: string;
    role: string | null;
    content: string;
    fact_id: string;
  }>) {
    const lc = (row.company ?? "").toLowerCase();
    const ok = Array.from(ALLOWED_COMPANIES_LC).some((c) => lc.includes(c) || c.includes(lc));
    const marker = ok ? "✓" : "✗";
    console.log(`${marker} [${row.source_doc ?? "(no source)"}] ${row.company} — ${row.role ?? ""}`);
    console.log(`    fact_id=${row.fact_id}`);
    if (!ok) console.log(`    content: ${row.content.slice(0, 140)}`);
  }

  console.log("\n=== Education facts (with source) ===");
  const edu = await sql`
    SELECT
      d.name as source_doc,
      f.content,
      f.id as fact_id
    FROM kb_facts f
    LEFT JOIN kb_documents d ON d.id = f.document_id
    WHERE f.fact_type = 'education'
  `;
  for (const row of edu as Array<{ source_doc: string | null; content: string; fact_id: string }>) {
    console.log(`  [${row.source_doc ?? "(no source)"}] ${row.content}`);
    console.log(`    fact_id=${row.fact_id}`);
  }

  console.log("\n=== Facts mentioning 'Memphis' anywhere ===");
  const memphis = await sql`
    SELECT
      d.name as source_doc,
      f.fact_type,
      f.content,
      f.id as fact_id
    FROM kb_facts f
    LEFT JOIN kb_documents d ON d.id = f.document_id
    WHERE f.content ILIKE '%memphis%' OR f.evidence_quote ILIKE '%memphis%'
  `;
  for (const row of memphis as Array<{
    source_doc: string | null;
    fact_type: string;
    content: string;
    fact_id: string;
  }>) {
    console.log(`  [${row.source_doc ?? "?"}] (${row.fact_type}) ${row.content.slice(0, 150)}`);
    console.log(`    fact_id=${row.fact_id}`);
  }

  console.log("\n=== Facts mentioning 'Acumen' anywhere ===");
  const acumen = await sql`
    SELECT
      d.name as source_doc,
      f.fact_type,
      f.content,
      f.id as fact_id
    FROM kb_facts f
    LEFT JOIN kb_documents d ON d.id = f.document_id
    WHERE f.content ILIKE '%acumen%' OR f.evidence_quote ILIKE '%acumen%'
  `;
  for (const row of acumen as Array<{
    source_doc: string | null;
    fact_type: string;
    content: string;
    fact_id: string;
  }>) {
    console.log(`  [${row.source_doc ?? "?"}] (${row.fact_type}) ${row.content.slice(0, 150)}`);
    console.log(`    fact_id=${row.fact_id}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
