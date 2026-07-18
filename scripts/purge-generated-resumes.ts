/**
 * Purge the system-GENERATED résumé documents from the KB (the inflation
 * "feedback loop" residue) and their drifted machine-extracted facts — while
 * KEEPING the facts we already hand-corrected (verified ground truth) and any
 * user-added facts. Everything is backed up to .pipeline first.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env", override: true });
import { writeFileSync } from "fs";
import { neon } from "@neondatabase/serverless";

const DOC_IDS = [
  "OHUGDyscPFPXMNVd2N3VI", // Jordan-Henning-Resume.pdf
  "TNG13Zkcdn0-1rPJ1sKwI", // Jordan_Henning_Resume-v2.pdf
  "qDsyUxv7iMJIShI0reaoe", // Jordan-Henning-Resume-Federal-IT.pdf
  "m_VkemqbVoHKD3qYi7h2u", // Jordan-Henning-Resume-Program-PM.pdf
  "rjbapeYXtNBR6HHn7VMnH", // Jordan-Henning-Resume-Service-Ops.pdf
];

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  // 1. Backup docs + ALL their facts.
  const docs = await sql`SELECT id, name, file_type, raw_content, metadata, uploaded_at
                         FROM kb_documents WHERE id = ANY(${DOC_IDS}::text[])`;
  const facts = await sql`SELECT id, document_id, fact_type, content, evidence_quote, metadata, user_added, pinned
                          FROM kb_facts WHERE document_id = ANY(${DOC_IDS}::text[])`;
  writeFileSync(
    ".pipeline/generated-resume-purge-backup-2026-06-18.json",
    JSON.stringify({ docs, facts }, null, 2),
  );
  console.log(`Backed up ${docs.length} docs + ${facts.length} facts.`);

  // 2. Delete the drifted (non-corrected, non-user) facts of these docs.
  const deletedFacts = await sql`
    DELETE FROM kb_facts
    WHERE document_id = ANY(${DOC_IDS}::text[])
      AND user_added <> 'true'
      AND COALESCE(metadata->>'spanCorrected','') <> 'true'
      AND COALESCE(metadata->>'portfolioCorrected','') <> 'true'
      AND COALESCE(metadata->>'bioCorrected','') <> 'true'
    RETURNING id`;
  console.log(`Deleted ${deletedFacts.length} drifted résumé-derived facts.`);

  // 3. Delete the document rows (remaining corrected facts -> document_id NULL via FK).
  const keptCorrected = await sql`
    SELECT count(*)::int AS n FROM kb_facts WHERE document_id = ANY(${DOC_IDS}::text[])`;
  const deletedDocs = await sql`
    DELETE FROM kb_documents WHERE id = ANY(${DOC_IDS}::text[]) RETURNING id`;
  console.log(`Preserved ${(keptCorrected[0] as { n: number }).n} corrected facts (now orphaned, retained).`);
  console.log(`Deleted ${deletedDocs.length} generated-résumé documents.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
