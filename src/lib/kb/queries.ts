import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { kbChunks, kbDocuments, kbFacts } from "@/db/schema";

export const KB_DOCUMENT_LIST_LIMIT = 100;
export const KB_DOCUMENT_DETAIL_FACT_LIMIT = 500;
export const KB_DOCUMENT_DETAIL_CHUNK_LIMIT = 300;

export type KbStats = {
  documents: number;
  chunks: number;
  facts: number;
};

export async function getKbStats(): Promise<KbStats> {
  const [docCount, chunkCount, factCount] = await Promise.all([
    db()
      .select({ count: sql<number>`count(*)::int` })
      .from(kbDocuments),
    db()
      .select({ count: sql<number>`count(*)::int` })
      .from(kbChunks),
    db()
      .select({ count: sql<number>`count(*)::int` })
      .from(kbFacts),
  ]);
  return {
    documents: docCount[0]?.count ?? 0,
    chunks: chunkCount[0]?.count ?? 0,
    facts: factCount[0]?.count ?? 0,
  };
}

export type DocumentRow = {
  id: string;
  name: string;
  fileType: string;
  byteSize: number | null;
  uploadedAt: Date;
  chunkCount: number;
  factCount: number;
  missingAttributionCount: number;
  kind: "facts" | "voice";
};

const documentListSelection = {
  id: kbDocuments.id,
  name: kbDocuments.name,
  fileType: kbDocuments.fileType,
  byteSize: kbDocuments.byteSize,
  uploadedAt: kbDocuments.uploadedAt,
  kind: sql<"facts" | "voice">`COALESCE(${kbDocuments.metadata}->>'kind', 'facts')`,
  chunkCount: sql<number>`(SELECT count(*)::int FROM kb_chunks WHERE kb_chunks.document_id = kb_documents.id)`,
  factCount: sql<number>`(SELECT count(*)::int FROM kb_facts WHERE kb_facts.document_id = kb_documents.id)`,
  missingAttributionCount: sql<number>`(
    SELECT count(*)::int
    FROM kb_facts
    WHERE kb_facts.document_id = kb_documents.id
      AND kb_facts.metadata->>'company' IS NULL
  )`,
};

export async function listDocuments(opts?: {
  needsAttribution?: boolean;
  limit?: number;
}): Promise<DocumentRow[]> {
  const limit = clampListLimit(opts?.limit, KB_DOCUMENT_LIST_LIMIT);
  const base = db().select(documentListSelection).from(kbDocuments);
  const rows = opts?.needsAttribution
    ? await base
        .where(sql`EXISTS (
          SELECT 1
          FROM kb_facts
          WHERE kb_facts.document_id = kb_documents.id
            AND kb_facts.metadata->>'company' IS NULL
        )`)
        .orderBy(desc(kbDocuments.uploadedAt))
        .limit(limit)
    : await base.orderBy(desc(kbDocuments.uploadedAt)).limit(limit);
  return rows;
}

export async function getDocumentById(id: string) {
  const [doc] = await db()
    .select()
    .from(kbDocuments)
    .where(eq(kbDocuments.id, id))
    .limit(1);
  return doc ?? null;
}

export async function listFactsForDocument(
  documentId: string,
  limit = KB_DOCUMENT_DETAIL_FACT_LIMIT,
) {
  return db()
    .select()
    .from(kbFacts)
    .where(eq(kbFacts.documentId, documentId))
    .orderBy(desc(kbFacts.createdAt))
    .limit(clampListLimit(limit, KB_DOCUMENT_DETAIL_FACT_LIMIT));
}

export async function listChunksForDocument(
  documentId: string,
  limit = KB_DOCUMENT_DETAIL_CHUNK_LIMIT,
) {
  return db()
    .select({
      id: kbChunks.id,
      chunkIndex: kbChunks.chunkIndex,
      content: kbChunks.content,
      tokenCount: kbChunks.tokenCount,
      createdAt: kbChunks.createdAt,
    })
    .from(kbChunks)
    .where(eq(kbChunks.documentId, documentId))
    .orderBy(kbChunks.chunkIndex)
    .limit(clampListLimit(limit, KB_DOCUMENT_DETAIL_CHUNK_LIMIT));
}

export async function deleteDocument(id: string) {
  // FK cascades handle kbChunks; kbFacts has ON DELETE SET NULL so we explicitly clean those too.
  await db().delete(kbFacts).where(eq(kbFacts.documentId, id));
  await db().delete(kbDocuments).where(eq(kbDocuments.id, id));
}

export async function countFactsMissingCompany(): Promise<number> {
  const [row] = await db()
    .select({ count: sql<number>`count(*)::int` })
    .from(kbFacts)
    .where(sql`${kbFacts.metadata}->>'company' IS NULL`);
  return row?.count ?? 0;
}

export async function listFactsMissingCompany(limit = 100) {
  return db()
    .select()
    .from(kbFacts)
    .where(sql`${kbFacts.metadata}->>'company' IS NULL`)
    .orderBy(desc(kbFacts.createdAt))
    .limit(clampListLimit(limit, 100));
}

function clampListLimit(value: number | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(Math.floor(value), fallback));
}
