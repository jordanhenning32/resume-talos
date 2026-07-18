import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { kbDocuments, kbFacts } from "@/db/schema";
import { env } from "@/lib/env";

/** SHA-256 hex of the normalized text — stable across whitespace tweaks. */
export function contentHash(text: string): string {
  const canonical = text
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return createHash("sha256").update(canonical).digest("hex");
}

export type ExistingDocument = {
  id: string;
  name: string;
  uploadedAt: Date;
};

export async function findDocumentByHash(
  hash: string,
): Promise<ExistingDocument | null> {
  const [row] = await db()
    .select({
      id: kbDocuments.id,
      name: kbDocuments.name,
      uploadedAt: kbDocuments.uploadedAt,
    })
    .from(kbDocuments)
    .where(eq(kbDocuments.contentHash, hash))
    .limit(1);
  return row ?? null;
}

/**
 * Default cosine-similarity threshold for treating two facts of the same type
 * as semantic duplicates. 0.85 catches obvious semantic duplicates with rephrasing;
 * 0.92+ only catches near-identical wording. Override via FACT_SIMILARITY_THRESHOLD
 * env var if you want stricter or looser behavior.
 */
export function factSimilarityThreshold(): number {
  return env().FACT_SIMILARITY_THRESHOLD;
}

/** Format a number array for a pgvector literal: `[0.1,0.2,...]`. */
function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export type ExistingFactMatch = {
  id: string;
  content: string;
  similarity: number;
  userAdded: string;
  pinned: string;
};

/**
 * Returns the single most similar existing fact of the same fact_type, if its
 * cosine similarity to `embedding` is above `threshold`. Otherwise null.
 */
export async function findSimilarExistingFact(opts: {
  embedding: number[];
  factType: string;
  threshold?: number;
}): Promise<ExistingFactMatch | null> {
  const threshold = opts.threshold ?? factSimilarityThreshold();
  const vec = vectorLiteral(opts.embedding);
  const rows = await db()
    .select({
      id: kbFacts.id,
      content: kbFacts.content,
      similarity: sql<number>`1 - (${kbFacts.embedding} <=> ${vec}::vector)`,
      userAdded: kbFacts.userAdded,
      pinned: kbFacts.pinned,
    })
    .from(kbFacts)
    .where(
      and(
        eq(kbFacts.factType, opts.factType),
        sql`1 - (${kbFacts.embedding} <=> ${vec}::vector) > ${threshold}`,
      ),
    )
    .orderBy(sql`${kbFacts.embedding} <=> ${vec}::vector`)
    .limit(1);
  return rows[0] ?? null;
}

/** Cosine similarity between two equal-length number vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
