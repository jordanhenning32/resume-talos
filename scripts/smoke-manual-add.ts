import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { neon } from "@neondatabase/serverless";
import { db } from "@/db";
import { kbChunks, kbDocuments, kbFacts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ingestDocument } from "@/lib/kb/ingest";

const SAMPLE_TEXT = `Authored the agency-wide observability playbook adopted by every
new Agile IT team standing up at SSA. Defined SLOs and error budgets for
hearings case management, MySSA self-service, and the COVID-19 emergency
upload capability. Pioneered the use of OpenTelemetry traces correlated to
business KPIs, cutting mean time to root cause from 4 hours to under 30
minutes on production incidents above P2.`;

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  console.log("Smoke-testing ingest with NO applicationId (manual_add)...");
  const t0 = Date.now();
  const result = await ingestDocument({
    name: `manual-${Date.now()}.txt`,
    fileType: "txt",
    buffer: Buffer.from(SAMPLE_TEXT, "utf-8"),
    kind: "facts",
    userFacts: true,
    extraMetadata: { source: "manual_add" },
  });
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nstatus=${result.status}  facts=${result.factCount}  chunks=${result.chunkCount}  cost=$${result.costUsd.toFixed(4)}  (${sec}s)`);

  const [doc] = (await sql`
    SELECT id, name, metadata FROM kb_documents WHERE id = ${result.documentId}
  `) as Array<{ id: string; name: string; metadata: unknown }>;
  console.log("Persisted metadata:", JSON.stringify(doc.metadata));

  const facts = (await sql`
    SELECT fact_type, content, user_added FROM kb_facts WHERE document_id = ${result.documentId} LIMIT 5
  `) as Array<{ fact_type: string; content: string; user_added: string }>;
  if (facts.some((f) => f.user_added !== "true")) {
    throw new Error("Manual-add smoke inserted a fact without user_added=true.");
  }
  for (const f of facts) console.log(`  [${f.fact_type}] ${f.content.slice(0, 160)}`);

  await db().delete(kbFacts).where(eq(kbFacts.documentId, result.documentId));
  await db().delete(kbChunks).where(eq(kbChunks.documentId, result.documentId));
  await db().delete(kbDocuments).where(eq(kbDocuments.id, result.documentId));
  const leftovers = (await sql`
    SELECT count(*)::int AS count FROM kb_facts WHERE document_id = ${result.documentId}
  `) as Array<{ count: number }>;
  if ((leftovers[0]?.count ?? 0) !== 0) {
    throw new Error(`Cleanup left ${leftovers[0]?.count} fact(s) for ${result.documentId}.`);
  }
  console.log("Cleaned up test doc.");
}

main().catch((e) => { console.error(e); process.exit(1); });
