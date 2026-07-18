import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { neon } from "@neondatabase/serverless";
import { db } from "@/db";
import { kbChunks, kbDocuments, kbFacts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ingestDocument } from "@/lib/kb/ingest";

const APP_ID = process.argv[2] ?? "NQP2fHmUoerjbEEvsuXrw";

const SAMPLE_TEXT = `As an SSA Branch Chief I owned the full project artifact suite across the
$200M+ Agile IT portfolio. I authored or directly supervised: business cases
with cost-benefit analysis, project charters, requirements traceability
matrices, user stories with INVEST-style acceptance criteria, sprint review
artifacts, OKRs cascaded from agency strategic objectives, release notes,
post-launch RCA reports for incidents over P3 severity, and end-of-life
sunset plans for legacy mainframe systems retired during the cloud
migration. I reviewed and approved roughly 40 artifact packages per quarter
across the four agile teams reporting to me, with a 99% acceptance rate
from the agency PMO.`;

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  console.log(`Ingesting quick-add facts for application ${APP_ID}...`);
  const t0 = Date.now();
  const result = await ingestDocument({
    name: `quick-add-${APP_ID}-${Date.now()}.txt`,
    fileType: "txt",
    buffer: Buffer.from(SAMPLE_TEXT, "utf-8"),
    kind: "facts",
    userFacts: true,
    extraMetadata: {
      source: "quick_add",
      applicationId: APP_ID,
      roleTitle: "Information Technology Specialist (Systems Analysis) / IT Product Manager",
      companyName: "Centers for Medicare & Medicaid Services (CMS)",
    },
  });
  const sec = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\n=== Result (${sec}s) ===`);
  console.log(`Status:           ${result.status}`);
  console.log(`Document id:      ${result.documentId}`);
  console.log(`Chunks:           ${result.chunkCount}`);
  console.log(`Facts kept:       ${result.factCount}`);
  console.log(`Facts duplicate:  ${result.duplicateFactCount}`);
  console.log(`Cost:             $${result.costUsd.toFixed(6)}`);
  if (result.warnings.length) {
    console.log(`Warnings:         ${result.warnings.join(" / ")}`);
  }

  // Re-fetch the doc row to confirm extraMetadata landed correctly
  const [doc] = (await sql`
    SELECT id, name, metadata, byte_size
    FROM kb_documents
    WHERE id = ${result.documentId}
  `) as Array<{
    id: string;
    name: string;
    metadata: unknown;
    byte_size: number;
  }>;
  console.log(`\n=== Persisted doc metadata ===`);
  console.log(JSON.stringify(doc.metadata, null, 2));

  // Show a sample of the inserted facts to verify content
  const facts = (await sql`
    SELECT id, fact_type, content, user_added
    FROM kb_facts
    WHERE document_id = ${result.documentId}
    LIMIT 10
  `) as Array<{ id: string; fact_type: string; content: string; user_added: string }>;
  if (facts.some((f) => f.user_added !== "true")) {
    throw new Error("Quick-add smoke inserted a fact without user_added=true.");
  }
  console.log(`\n=== Sample facts (${facts.length}) ===`);
  for (const f of facts) {
    console.log(`  [${f.fact_type}] ${f.content.slice(0, 200)}`);
  }

  // Cleanup so we don't pollute the KB with the test data
  console.log(`\nCleaning up test doc ${result.documentId}...`);
  await db().delete(kbFacts).where(eq(kbFacts.documentId, result.documentId));
  await db().delete(kbChunks).where(eq(kbChunks.documentId, result.documentId));
  await db().delete(kbDocuments).where(eq(kbDocuments.id, result.documentId));
  const leftovers = (await sql`
    SELECT count(*)::int AS count FROM kb_facts WHERE document_id = ${result.documentId}
  `) as Array<{ count: number }>;
  if ((leftovers[0]?.count ?? 0) !== 0) {
    throw new Error(`Cleanup left ${leftovers[0]?.count} fact(s) for ${result.documentId}.`);
  }
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
