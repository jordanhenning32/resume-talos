import { and, desc, eq, inArray, not, sql } from "drizzle-orm";
import { db } from "@/db";
import { kbChunks, kbDocuments, kbFacts, type FactType } from "@/db/schema";
import { embedText } from "@/lib/models/embed";

export type RetrievedFact = {
  id: string;
  factType: string;
  content: string;
  evidenceQuote: string | null;
  metadata: Record<string, unknown> | null;
  similarity: number;
};

export type RetrievalGroup = {
  factType: string;
  facts: RetrievedFact[];
};

function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

/**
 * Embed `query` and return the top-K most similar KB facts overall.
 * If `factTypes` is provided, restrict to those types.
 */
export async function retrieveFacts(opts: {
  query: string;
  topK?: number;
  factTypes?: FactType[];
}): Promise<{ facts: RetrievedFact[]; costUsd: number }> {
  const topK = opts.topK ?? 20;
  const { embedding, costUsd } = await embedText(opts.query);
  const vec = vectorLiteral(embedding);

  const conditions = [];
  if (opts.factTypes && opts.factTypes.length > 0) {
    conditions.push(inArray(kbFacts.factType, opts.factTypes));
  }

  const rows = await db()
    .select({
      id: kbFacts.id,
      factType: kbFacts.factType,
      content: kbFacts.content,
      evidenceQuote: kbFacts.evidenceQuote,
      metadata: kbFacts.metadata,
      similarity: sql<number>`1 - (${kbFacts.embedding} <=> ${vec}::vector)`,
    })
    .from(kbFacts)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(sql`${kbFacts.embedding} <=> ${vec}::vector`)
    .limit(topK);

  return { facts: rows as RetrievedFact[], costUsd };
}

/**
 * Retrieve a *grouped* sample of relevant facts — N per type — so the
 * downstream agent sees a balanced selection rather than e.g. 20 achievements
 * and zero stories. Useful for Fit Scoring and the writer prompt-builder.
 */
export async function retrieveGroupedFacts(opts: {
  query: string;
  perTypeK?: number;
  types?: FactType[];
  overflow?: { enabled: boolean; topK?: number; similarityFloor?: number; types?: FactType[] };
}): Promise<{ groups: RetrievalGroup[]; totalFacts: number; costUsd: number }> {
  const perTypeK = opts.perTypeK ?? 5;
  const types: FactType[] =
    opts.types ?? ([
      "achievement",
      "role",
      "responsibility",
      "project",
      "skill",
      "tool",
      "story",
      "context",
      "certification",
      "education",
    ] as FactType[]);

  const { embedding, costUsd } = await embedText(opts.query);
  const vec = vectorLiteral(embedding);
  const pinnedIds = await getPinnedFactIds();
  const excludePinned = pinnedIds.length > 0 ? not(inArray(kbFacts.id, pinnedIds)) : undefined;

  const groups: RetrievalGroup[] = [];
  const seenFactIds = new Set<string>();
  let totalFacts = 0;
  for (const t of types) {
    const rows = await db()
      .select({
        id: kbFacts.id,
        factType: kbFacts.factType,
        content: kbFacts.content,
        evidenceQuote: kbFacts.evidenceQuote,
        metadata: kbFacts.metadata,
        similarity: sql<number>`1 - (${kbFacts.embedding} <=> ${vec}::vector)`,
      })
      .from(kbFacts)
      .where(excludePinned ? and(eq(kbFacts.factType, t), excludePinned) : eq(kbFacts.factType, t))
      .orderBy(sql`${kbFacts.embedding} <=> ${vec}::vector`)
      .limit(perTypeK);
    if (rows.length > 0) {
      for (const row of rows) seenFactIds.add(row.id);
      groups.push({ factType: t, facts: rows as RetrievedFact[] });
      totalFacts += rows.length;
    }
  }
  if (opts.overflow?.enabled) {
    const overflowTypes = opts.overflow.types ?? types;
    const rows = await db()
      .select({
        id: kbFacts.id,
        factType: kbFacts.factType,
        content: kbFacts.content,
        evidenceQuote: kbFacts.evidenceQuote,
        metadata: kbFacts.metadata,
        similarity: sql<number>`1 - (${kbFacts.embedding} <=> ${vec}::vector)`,
      })
      .from(kbFacts)
      .where(
        excludePinned
          ? and(inArray(kbFacts.factType, overflowTypes), excludePinned)
          : inArray(kbFacts.factType, overflowTypes),
      )
      .orderBy(sql`${kbFacts.embedding} <=> ${vec}::vector`)
      .limit(opts.overflow.topK ?? 20);
    const floor = opts.overflow.similarityFloor ?? 0.65;
    for (const row of rows as RetrievedFact[]) {
      if (row.similarity < floor || seenFactIds.has(row.id)) continue;
      let group = groups.find((g) => g.factType === row.factType);
      if (!group) {
        group = { factType: row.factType, facts: [] };
        groups.push(group);
      }
      group.facts.push(row);
      seenFactIds.add(row.id);
      totalFacts++;
    }
  }
  return { groups, totalFacts, costUsd };
}

async function getPinnedFactIds(): Promise<string[]> {
  const rows = await db()
    .select({ id: kbFacts.id })
    .from(kbFacts)
    .where(eq(kbFacts.pinned, "true"));
  return rows.map((row) => row.id);
}

export async function getPinnedFacts(): Promise<RetrievedFact[]> {
  const rows = await db()
    .select({
      id: kbFacts.id,
      factType: kbFacts.factType,
      content: kbFacts.content,
      evidenceQuote: kbFacts.evidenceQuote,
      metadata: kbFacts.metadata,
      similarity: sql<number>`1`,
    })
    .from(kbFacts)
    .where(eq(kbFacts.pinned, "true"))
    .orderBy(desc(kbFacts.createdAt));
  return rows as RetrievedFact[];
}

export type VoiceChunk = {
  id: string;
  documentId: string;
  documentName: string;
  content: string;
  similarity: number;
};

/**
 * Retrieve raw prose chunks from documents tagged as voice samples. Used by
 * the writers to anchor register and rhythm in the user's actual writing
 * rather than the model's best guess at their voice. Returns chunks ranked
 * by similarity to the query (typically the JD's tone signals + summary).
 *
 * If no voice documents have been uploaded yet, returns empty — the writers
 * fall back to the rule-based exemplar pattern.
 */
export async function retrieveVoiceChunks(opts: {
  query: string;
  topK?: number;
}): Promise<{ chunks: VoiceChunk[]; costUsd: number }> {
  const topK = opts.topK ?? 4;
  const { embedding, costUsd } = await embedText(opts.query);
  const vec = vectorLiteral(embedding);

  // Join chunks against their document and filter on metadata.kind === 'voice'.
  // Using sql template directly because Drizzle's jsonb path filters are
  // verbose and the literal SQL here is unambiguous.
  const rows = await db()
    .select({
      id: kbChunks.id,
      documentId: kbChunks.documentId,
      documentName: kbDocuments.name,
      content: kbChunks.content,
      similarity: sql<number>`1 - (${kbChunks.embedding} <=> ${vec}::vector)`,
    })
    .from(kbChunks)
    .innerJoin(kbDocuments, eq(kbChunks.documentId, kbDocuments.id))
    .where(sql`${kbDocuments.metadata}->>'kind' = 'voice'`)
    .orderBy(sql`${kbChunks.embedding} <=> ${vec}::vector`)
    .limit(topK);

  return { chunks: rows as VoiceChunk[], costUsd };
}

/** Render voice chunks into a markdown block for the writer's cached prefix. */
export function renderVoiceChunksForPrompt(chunks: VoiceChunk[]): string {
  if (chunks.length === 0) return "";
  const out: string[] = [];
  for (const c of chunks) {
    out.push(`### from "${c.documentName}"`);
    out.push(c.content.trim());
    out.push("");
  }
  return out.join("\n");
}

/** Render retrieved facts into a compact markdown block for use inside an agent prompt. */
export function renderFactsForPrompt(groups: RetrievalGroup[]): string {
  const out: string[] = [];
  for (const g of groups) {
    out.push(`### ${g.factType} (${g.facts.length})`);
    for (const f of g.facts) {
      const meta = f.metadata ?? {};
      const company = (meta.company as string | undefined) ?? null;
      const role = (meta.role as string | undefined) ?? null;
      const dates =
        (meta.startDate as string | undefined) || (meta.endDate as string | undefined)
          ? ` [${meta.startDate ?? "?"}–${meta.endDate ?? "?"}]`
          : "";
      const tag = company || role ? `(${[company, role].filter(Boolean).join(" · ")}${dates}) ` : "";
      out.push(`- ${tag}${f.content}`);
    }
    out.push("");
  }
  return out.join("\n");
}
