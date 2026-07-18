import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });

import { neon } from "@neondatabase/serverless";
import { retrieveVoiceChunks } from "@/lib/agents/retriever";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  console.log("\n=== All voice documents in KB ===\n");
  const docs = await sql`
    SELECT id, name, metadata->>'kind' AS kind, byte_size,
      (SELECT count(*)::int FROM kb_chunks WHERE kb_chunks.document_id = kb_documents.id) AS chunks
    FROM kb_documents
    WHERE metadata->>'kind' = 'voice'
    ORDER BY uploaded_at DESC
  ` as Array<{ id: string; name: string; kind: string; byte_size: number; chunks: number }>;
  for (const d of docs) {
    console.log(`  ${d.name}  (${d.chunks} chunks, ${d.byte_size ? `${(d.byte_size / 1024).toFixed(1)}KB` : "—"})`);
  }
  const totalChunks = docs.reduce((sum, d) => sum + d.chunks, 0);
  console.log(`\nTotal voice chunks: ${totalChunks} across ${docs.length} documents.\n`);

  console.log("=== Word counts ===\n");
  const wordCounts = await sql`
    SELECT kb_documents.name, kb_chunks.chunk_index,
      array_length(regexp_split_to_array(kb_chunks.content, '\\s+'), 1) AS words,
      length(kb_chunks.content) AS chars
    FROM kb_chunks
    INNER JOIN kb_documents ON kb_chunks.document_id = kb_documents.id
    WHERE kb_documents.metadata->>'kind' = 'voice'
    ORDER BY kb_documents.uploaded_at DESC, kb_chunks.chunk_index ASC
  ` as Array<{ name: string; chunk_index: number; words: number; chars: number }>;
  let totalWords = 0;
  for (const w of wordCounts) {
    console.log(`  ${w.name} [${w.chunk_index}]  ${w.words} words / ${w.chars} chars`);
    totalWords += w.words;
  }
  console.log(`\nTotal voice corpus: ~${totalWords} words.\n`);

  console.log("=== Retrieval probe: how voice chunks match different JD types ===\n");
  const probes = [
    "Federal AI services delivery executive presenting to senior leadership",
    "Senior product manager driving cross-functional alignment at a consumer tech company",
    "Staff software engineer designing distributed payment systems",
    "Director of operations leading a large team through a major transition",
  ];
  for (const q of probes) {
    const { chunks } = await retrieveVoiceChunks({ query: q, topK: 3 });
    const top = chunks[0];
    console.log(`Query: "${q}"`);
    console.log(
      `  Top match: sim=${top?.similarity.toFixed(3) ?? "n/a"} — ${top?.documentName ?? "(no match)"}`,
    );
    if (chunks.length > 0) {
      console.log(`  ${chunks.length} chunks retrieved (similarity range: ${chunks[chunks.length - 1].similarity.toFixed(3)}–${top!.similarity.toFixed(3)})`);
    }
    console.log("");
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
