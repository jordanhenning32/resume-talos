import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });

import { neon } from "@neondatabase/serverless";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { kbChunks, kbDocuments, kbFacts } from "@/db/schema";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  console.log("=== First 300 chars of each voice doc ===\n");
  const rows = await sql`
    SELECT kb_documents.name, kb_chunks.chunk_index, kb_chunks.content
    FROM kb_chunks
    INNER JOIN kb_documents ON kb_chunks.document_id = kb_documents.id
    WHERE kb_documents.metadata->>'kind' = 'voice'
    ORDER BY kb_documents.uploaded_at DESC, kb_chunks.chunk_index ASC
  ` as Array<{ name: string; chunk_index: number; content: string }>;
  for (const r of rows) {
    console.log(`--- ${r.name} [chunk ${r.chunk_index}] ---`);
    console.log(r.content.slice(0, 350).replace(/\s+/g, " ").trim() + (r.content.length > 350 ? "…" : ""));
    console.log();
  }

  console.log("=== Removing synthetic test sample ===");
  const synthetic = await db()
    .select({ id: kbDocuments.id, name: kbDocuments.name })
    .from(kbDocuments)
    .where(eq(kbDocuments.name, "Jordan voice sample — operational craft"));
  for (const d of synthetic) {
    await db().delete(kbFacts).where(eq(kbFacts.documentId, d.id));
    await db().delete(kbDocuments).where(eq(kbDocuments.id, d.id));
    console.log(`  deleted: ${d.name} (${d.id})`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
