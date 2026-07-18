/**
 * Correct combat-tour count/location in the live KB.
 *
 * Ground truth (candidate correction, 2026-06-19):
 * - Served one combat tour in Iraq with the 101st Airborne Division.
 * - Bronze Star and Purple Heart remain valid.
 *
 * This updates stale source/chunk text and stale fact evidence so writers do
 * not regenerate "three combat tours" or Afghanistan claims.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env", override: true });

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { kbChunks, kbDocuments, kbFacts } from "@/db/schema";
import { contentHash } from "@/lib/kb/dedup";
import { embedText } from "@/lib/models/embed";

const STAMP = "2026-06-19";

const GUARDRAIL = {
  content:
    "MILITARY TOUR FACT: Jordan Henning served one combat tour in Iraq with the 101st Airborne Division and earned the Bronze Star and Purple Heart. Use this scope for military-service summaries.",
  evidence:
    "Candidate correction (2026-06-19): Jordan Henning served one combat tour in Iraq.",
  metadata: {
    company: "U.S. Army",
    role: "Infantry Soldier",
    startDate: "2001",
    endDate: "2009",
    source: "candidate-correction",
    combatTourGuardrail: "true",
    correctedAt: STAMP,
    tags: ["military-service", "combat-tour", "iraq", "bronze-star", "purple-heart"],
  },
};

async function main() {
  const backup = await collectBackupRows();
  mkdirSync(".pipeline", { recursive: true });
  const backupPath = uniqueBackupPath(`.pipeline/combat-tour-correction-backup-${STAMP}.json`);
  writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.log(`Backed up correction scope to ${backupPath}`);

  const docsUpdated = await correctDocuments();
  const chunksUpdated = await correctChunks();
  const factsUpdated = await correctFacts();
  const guardrailId = await upsertGuardrail();
  const verification = await verify();

  console.log(
    `Updated docs=${docsUpdated}, chunks=${chunksUpdated}, facts=${factsUpdated}, guardrail=${guardrailId}`,
  );
  console.table([verification]);
}

async function collectBackupRows() {
  const [docs, chunks, facts, guardrails] = await Promise.all([
    db()
      .select({
        id: kbDocuments.id,
        name: kbDocuments.name,
        rawContent: kbDocuments.rawContent,
        contentHash: kbDocuments.contentHash,
        byteSize: kbDocuments.byteSize,
        metadata: kbDocuments.metadata,
        uploadedAt: kbDocuments.uploadedAt,
      })
      .from(kbDocuments)
      .where(staleDocText()),
    db()
      .select({
        id: kbChunks.id,
        documentId: kbChunks.documentId,
        chunkIndex: kbChunks.chunkIndex,
        content: kbChunks.content,
        tokenCount: kbChunks.tokenCount,
        metadata: kbChunks.metadata,
        createdAt: kbChunks.createdAt,
      })
      .from(kbChunks)
      .where(staleChunkText()),
    db()
      .select({
        id: kbFacts.id,
        documentId: kbFacts.documentId,
        factType: kbFacts.factType,
        content: kbFacts.content,
        evidenceQuote: kbFacts.evidenceQuote,
        metadata: kbFacts.metadata,
        userAdded: kbFacts.userAdded,
        pinned: kbFacts.pinned,
        createdAt: kbFacts.createdAt,
        updatedAt: kbFacts.updatedAt,
      })
      .from(kbFacts)
      .where(staleFactText()),
    db()
      .select({
        id: kbFacts.id,
        content: kbFacts.content,
        evidenceQuote: kbFacts.evidenceQuote,
        metadata: kbFacts.metadata,
      })
      .from(kbFacts)
      .where(sql`${kbFacts.metadata}->>'combatTourGuardrail' = 'true'`),
  ]);
  return { createdAt: new Date().toISOString(), docs, chunks, facts, guardrails };
}

async function correctDocuments() {
  const docs = await db().select().from(kbDocuments).where(staleDocText());
  let updated = 0;
  for (const doc of docs) {
    const next = fixTourClaims(doc.rawContent);
    if (next === doc.rawContent) continue;
    const nextHash = contentHash(next);
    const [collision] = await db()
      .select({ id: kbDocuments.id, name: kbDocuments.name })
      .from(kbDocuments)
      .where(eq(kbDocuments.contentHash, nextHash))
      .limit(1);
    if (collision && collision.id !== doc.id) {
      throw new Error(
        `Corrected document hash would collide with ${collision.id} (${collision.name})`,
      );
    }
    await db()
      .update(kbDocuments)
      .set({
        rawContent: next,
        contentHash: nextHash,
        byteSize: Buffer.byteLength(next, "utf8"),
        metadata: sql`coalesce(${kbDocuments.metadata}, '{}'::jsonb) || ${JSON.stringify({
          combatTourSourceCorrected: "true",
          correctedAt: STAMP,
        })}::jsonb`,
      })
      .where(eq(kbDocuments.id, doc.id));
    updated++;
  }
  return updated;
}

async function correctChunks() {
  const chunks = await db().select().from(kbChunks).where(staleChunkText());
  let updated = 0;
  for (const chunk of chunks) {
    const next = fixTourClaims(chunk.content);
    if (next === chunk.content) continue;
    const { embedding } = await embedText(next);
    await db()
      .update(kbChunks)
      .set({
        content: next,
        tokenCount: Math.ceil(next.length / 4),
        embedding,
        metadata: sql`coalesce(${kbChunks.metadata}, '{}'::jsonb) || ${JSON.stringify({
          combatTourSourceCorrected: "true",
          correctedAt: STAMP,
        })}::jsonb`,
      })
      .where(eq(kbChunks.id, chunk.id));
    updated++;
  }
  return updated;
}

async function correctFacts() {
  const facts = await db()
    .select({
      id: kbFacts.id,
      content: kbFacts.content,
      evidenceQuote: kbFacts.evidenceQuote,
    })
    .from(kbFacts)
    .where(staleFactText());

  let updated = 0;
  for (const fact of facts) {
    const nextContent = fixTourClaims(fact.content);
    const nextEvidence = fact.evidenceQuote ? fixTourClaims(fact.evidenceQuote) : null;
    if (nextContent === fact.content && nextEvidence === fact.evidenceQuote) continue;
    const { embedding } = await embedText(nextContent);
    await db()
      .update(kbFacts)
      .set({
        content: nextContent,
        evidenceQuote: nextEvidence,
        embedding,
        metadata: sql`coalesce(${kbFacts.metadata}, '{}'::jsonb) || ${JSON.stringify({
          combatTourCorrected: "true",
          combatTourCorrectedAt: STAMP,
          combatTourContentRaw: fact.content,
          combatTourEvidenceRaw: fact.evidenceQuote,
        })}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(kbFacts.id, fact.id));
    updated++;
  }
  return updated;
}

async function upsertGuardrail() {
  const [existing] = await db()
    .select({ id: kbFacts.id })
    .from(kbFacts)
    .where(sql`${kbFacts.metadata}->>'combatTourGuardrail' = 'true'`)
    .limit(1);
  const { embedding } = await embedText(GUARDRAIL.content);
  const values = {
    documentId: null,
    factType: "context" as const,
    content: GUARDRAIL.content,
    evidenceQuote: GUARDRAIL.evidence,
    metadata: GUARDRAIL.metadata,
    embedding,
    userAdded: "true",
    pinned: "true",
    updatedAt: new Date(),
  };
  if (existing) {
    await db().update(kbFacts).set(values).where(eq(kbFacts.id, existing.id));
    return existing.id;
  }
  const [inserted] = await db()
    .insert(kbFacts)
    .values(values)
    .returning({ id: kbFacts.id });
  return inserted.id;
}

async function verify() {
  const [staleDocs, staleChunks, staleFacts, guardrails, correctFacts] = await Promise.all([
    countDocuments(staleDocText()),
    countChunks(staleChunkText()),
    countFacts(staleFactText()),
    countFacts(sql`${kbFacts.metadata}->>'combatTourGuardrail' = 'true'
      AND ${kbFacts.pinned} = 'true'`),
    countFacts(sql`(${kbFacts.content} ILIKE '%one combat tour in Iraq%'
      OR ${kbFacts.evidenceQuote} ILIKE '%one combat tour in Iraq%')`),
  ]);
  return {
    stale_source_docs: staleDocs,
    stale_chunks: staleChunks,
    stale_fact_content_or_evidence: staleFacts,
    pinned_guardrails: guardrails,
    one_combat_tour_facts: correctFacts,
  };
}

function staleDocText() {
  return sql`(${kbDocuments.rawContent} ILIKE '%three combat tour%'
    OR ${kbDocuments.rawContent} ILIKE '%three tours%'
    OR ${kbDocuments.rawContent} ILIKE '%Afghanistan%'
    OR ${kbDocuments.rawContent} ILIKE '%combat tours%')`;
}

function staleChunkText() {
  return sql`(${kbChunks.content} ILIKE '%three combat tour%'
    OR ${kbChunks.content} ILIKE '%three tours%'
    OR ${kbChunks.content} ILIKE '%Afghanistan%'
    OR ${kbChunks.content} ILIKE '%combat tours%')`;
}

function staleFactText() {
  return sql`(${kbFacts.content} ILIKE '%three combat tour%'
    OR ${kbFacts.content} ILIKE '%three tours%'
    OR ${kbFacts.content} ILIKE '%Afghanistan%'
    OR ${kbFacts.content} ILIKE '%combat tours%'
    OR ${kbFacts.evidenceQuote} ILIKE '%three combat tour%'
    OR ${kbFacts.evidenceQuote} ILIKE '%three tours%'
    OR ${kbFacts.evidenceQuote} ILIKE '%Afghanistan%'
    OR ${kbFacts.evidenceQuote} ILIKE '%combat tours%')`;
}

function fixTourClaims(value: string): string {
  return value
    .replace(/over three combat tours\s*\(Iraq (?:and|&) Afghanistan\)/gi, "one combat tour in Iraq")
    .replace(/completed three combat tours\s*\(Iraq (?:and|&) Afghanistan\)/gi, "completed one combat tour in Iraq")
    .replace(/three combat tours with the 101st Airborne/gi, "one combat tour in Iraq with the 101st Airborne")
    .replace(/three tours with the 101st Airborne/gi, "one combat tour in Iraq with the 101st Airborne")
    .replace(/three combat tours in Iraq (?:and|&) Afghanistan/gi, "one combat tour in Iraq")
    .replace(/three tours in Iraq (?:and|&) Afghanistan/gi, "one combat tour in Iraq")
    .replace(/three tours total/gi, "one combat tour in Iraq")
    .replace(/three combat tours/gi, "one combat tour in Iraq")
    .replace(/three tours/gi, "one combat tour in Iraq")
    .replace(/Iraq\s*&\s*Afghanistan/gi, "Iraq")
    .replace(/Iraq\s+and\s+Afghanistan/gi, "Iraq")
    .replace(/\bin Iraq in Iraq\b/gi, "in Iraq");
}

async function countDocuments(where: ReturnType<typeof sql>) {
  const [row] = await db()
    .select({ value: sql<number>`count(*)::int` })
    .from(kbDocuments)
    .where(where);
  return Number(row?.value ?? 0);
}

async function countChunks(where: ReturnType<typeof sql>) {
  const [row] = await db()
    .select({ value: sql<number>`count(*)::int` })
    .from(kbChunks)
    .where(where);
  return Number(row?.value ?? 0);
}

async function countFacts(where: ReturnType<typeof sql>) {
  const [row] = await db()
    .select({ value: sql<number>`count(*)::int` })
    .from(kbFacts)
    .where(where);
  return Number(row?.value ?? 0);
}

function uniqueBackupPath(basePath: string): string {
  if (!existsSync(basePath)) return basePath;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return basePath.replace(/\.json$/, `-${stamp}.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
