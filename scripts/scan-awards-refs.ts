/**
 * READ-ONLY scan of the live KB for Bronze Star / Purple Heart references.
 * Enumerates affected facts, chunks, and documents. Makes NO writes.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env", override: true });

import { type SQLWrapper, sql } from "drizzle-orm";
import { db } from "@/db";
import { kbChunks, kbDocuments, kbFacts } from "@/db/schema";

function awardOn(col: SQLWrapper) {
  return sql`(${col} ILIKE '%bronze star%' OR ${col} ILIKE '%purple heart%')`;
}

async function main() {
  const facts = await db()
    .select({
      id: kbFacts.id,
      factType: kbFacts.factType,
      content: kbFacts.content,
      evidenceQuote: kbFacts.evidenceQuote,
      userAdded: kbFacts.userAdded,
      pinned: kbFacts.pinned,
      metadata: kbFacts.metadata,
    })
    .from(kbFacts)
    .where(sql`${awardOn(kbFacts.content)} OR ${awardOn(kbFacts.evidenceQuote)}`);

  const chunks = await db()
    .select({
      id: kbChunks.id,
      documentId: kbChunks.documentId,
      chunkIndex: kbChunks.chunkIndex,
      content: kbChunks.content,
    })
    .from(kbChunks)
    .where(awardOn(kbChunks.content));

  const docs = await db()
    .select({
      id: kbDocuments.id,
      name: kbDocuments.name,
    })
    .from(kbDocuments)
    .where(awardOn(kbDocuments.rawContent));

  console.log(`\n===== FACTS (${facts.length}) =====`);
  for (const f of facts) {
    const flags = [
      f.userAdded === "true" ? "USER-ADDED" : "",
      f.pinned === "true" ? "PINNED" : "",
      (f.metadata as Record<string, unknown> | null)?.combatTourGuardrail === "true" ? "GUARDRAIL" : "",
    ].filter(Boolean).join(" ");
    console.log(`\n[${f.id}] type=${f.factType} ${flags}`);
    console.log(`  content:  ${f.content}`);
    if (f.evidenceQuote) console.log(`  evidence: ${f.evidenceQuote}`);
  }

  console.log(`\n===== CHUNKS (${chunks.length}) =====`);
  for (const c of chunks) {
    console.log(`\n[${c.id}] doc=${c.documentId} idx=${c.chunkIndex}`);
    console.log(`  ${c.content.slice(0, 300)}`);
  }

  console.log(`\n===== SOURCE DOCUMENTS (${docs.length}) =====`);
  for (const d of docs) {
    console.log(`  [${d.id}] ${d.name}`);
  }

  console.log(`\n===== TOTALS: facts=${facts.length} chunks=${chunks.length} docs=${docs.length} =====`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
