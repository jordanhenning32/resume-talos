// Audit script: prints fact pairs above a similarity threshold so we can
// tune DEFAULT_FACT_SIMILARITY_THRESHOLD against real data.
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { neon } from "@neondatabase/serverless";

const THRESHOLD = Number(process.argv[2] ?? "0.75");

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  const sql = neon(process.env.DATABASE_URL);

  // Find pairs from different documents with the same fact_type above threshold.
  const rows = await sql`
    SELECT
      a.id as a_id, a.content as a_content, a.document_id as a_doc,
      b.id as b_id, b.content as b_content, b.document_id as b_doc,
      a.fact_type,
      1 - (a.embedding <=> b.embedding) as similarity
    FROM kb_facts a
    JOIN kb_facts b
      ON a.fact_type = b.fact_type
     AND a.id < b.id
     AND a.document_id <> b.document_id
    WHERE 1 - (a.embedding <=> b.embedding) > ${THRESHOLD}
    ORDER BY similarity DESC
    LIMIT 30
  `;

  console.log(`Found ${rows.length} cross-document fact pairs above ${THRESHOLD}:\n`);
  for (const r of rows as Array<{
    similarity: number;
    fact_type: string;
    a_content: string;
    b_content: string;
  }>) {
    console.log(`[${r.similarity.toFixed(4)}] ${r.fact_type}`);
    console.log(`  A: ${r.a_content}`);
    console.log(`  B: ${r.b_content}`);
    console.log("");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
