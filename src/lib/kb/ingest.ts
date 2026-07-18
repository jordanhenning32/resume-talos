import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/db";
import {
  kbChunks,
  kbDocuments,
  kbFacts,
  type NewKbChunk,
  type NewKbDocument,
  type NewKbFact,
} from "@/db/schema";
import { embedTexts } from "@/lib/models/embed";
import { chunkText } from "./chunker";
import {
  contentHash,
  cosineSimilarity,
  factSimilarityThreshold,
  findDocumentByHash,
} from "./dedup";
import { extractFactsFromChunk, type ExtractedFact } from "./extract";
import { parseDocument, type SupportedFileType } from "./parsers";
import { detectResumeSections, type SectionContext } from "./section-detect";

export type DocumentKind = "facts" | "voice";
export type IngestMode = "default" | "force_overwrite" | "merge";

export type IngestInput = {
  name: string;
  fileType: SupportedFileType;
  buffer: Buffer;
  /** Original URL if this came from a web fetch. Stored on kb_documents. */
  sourcePath?: string;
  /**
   * "facts" (default): standard structured-fact extraction. Use for resumes,
   * job histories, achievement decks - anything where claims about the
   * candidate matter.
   *
   * "voice": skip fact extraction. Treat the document as raw prose samples
   * for register/rhythm anchoring. Use for LinkedIn essays, blog posts,
   * interview transcripts. The cover-letter writer retrieves voice chunks
   * separately to anchor tone, not to cite facts.
   */
  kind?: DocumentKind;
  mode?: IngestMode;
  /** For deterministic tests or migrations that already have structured facts. */
  extractedFactsOverride?: ExtractedFact[];
  /**
   * Optional extra fields merged into `kbDocuments.metadata` alongside
   * `{pageCount, warnings, kind}`. Use this to tag provenance such as
   * `{source: "quick_add", applicationId, roleTitle}` so quick-add docs
   * can be filtered or audited later.
   */
  extraMetadata?: Record<string, unknown>;
  /**
   * True when the facts in this ingest were added by the user (quick-add /
   * manual-add), not extracted from an uploaded source. User facts are stamped
   * `userAdded="true"` - never deleted/merged by a later re-upload, and they
   * supersede a colliding machine-extracted fact. They are NOT auto-pinned:
   * they retrieve by relevance like any other fact (pin deliberately when a
   * fact should appear in every resume).
   */
  userFacts?: boolean;
};

export type SkippedFact = {
  content: string;
  factType: string;
  reason: "duplicate_existing" | "duplicate_in_batch";
  similarTo?: { id?: string; content: string; similarity: number };
};

export type IngestResult = {
  status: "ingested" | "duplicate_document";
  documentId: string;
  chunkCount: number;
  factCount: number;
  duplicateFactCount: number;
  costUsd: number;
  warnings: string[];
  duplicate?: { existingDocumentId: string; existingName: string };
  skippedFacts?: SkippedFact[];
};

const FACT_EXTRACTION_CONCURRENCY = 3;
const PINNED_FACT_IDS = new Set([
  "v1O3hdCcPewlwYJ4N6Zqh",
  "K-kTU3yyhi4hVsyxWwuS7",
]);

type PreparedFact = {
  entry: { fact: ExtractedFact; chunkId: string; chunkIndex: number };
  embedding: number[];
};

type ExistingFactMatch = {
  id: string;
  content: string;
  evidenceQuote: string | null;
  embedding: number[] | null;
  similarity: number;
  userAdded: string;
  pinned: string;
};

export type DuplicateAction = "supersede" | "merge" | "skip";

/**
 * Decide what to do when a newly-ingested fact duplicates an existing one.
 *
 * - A protected existing fact (user-added, pinned, or in PINNED_FACT_IDS) is
 *   NEVER deleted or merged, so a re-upload cannot wipe facts the user curated.
 * - A user/manual add (`userFacts`) supersedes a colliding machine-extracted
 *   fact (the user's version wins).
 * - Otherwise the existing mode rules apply (force_overwrite supersedes,
 *   merge merges, default skips).
 */
export function resolveDuplicate(
  existing: { id: string; userAdded?: string | null; pinned?: string | null },
  opts: { mode: IngestMode; userFacts: boolean },
): DuplicateAction {
  const isProtected =
    existing.userAdded === "true" ||
    existing.pinned === "true" ||
    PINNED_FACT_IDS.has(existing.id);
  if (isProtected) return "skip";
  if (opts.userFacts || opts.mode === "force_overwrite") return "supersede";
  if (opts.mode === "merge") return "merge";
  return "skip";
}

export async function ingestDocument(input: IngestInput): Promise<IngestResult> {
  const warnings: string[] = [];
  const mode = input.mode ?? "default";
  const userFacts = input.userFacts ?? false;

  const parsed = await parseDocument(input.fileType, input.buffer);
  warnings.push(...parsed.warnings);

  if (parsed.text.trim().length === 0) {
    throw new Error("Document parsed to empty text - nothing to ingest.");
  }

  const kind: DocumentKind = input.kind ?? "facts";
  const sections =
    kind === "facts"
      ? detectResumeSections(parsed.text).filter((section) =>
          companyAppearsInDocument(section.company, input.name, parsed.text),
        )
      : [];

  const hash = contentHash(parsed.text);
  const existing = await findDocumentByHash(hash);
  if (existing) {
    return duplicateDocumentResult(existing, warnings);
  }

  const documentId = nanoid();
  const chunks = chunkText(parsed.text);
  const document: NewKbDocument & { id: string; contentHash: string } = {
    id: documentId,
    name: input.name,
    fileType: input.fileType,
    rawContent: parsed.text,
    contentHash: hash,
    sourcePath: input.sourcePath,
    byteSize: input.buffer.byteLength,
    metadata: documentMetadata({
      pageCount: parsed.pageCount,
      warnings: parsed.warnings,
      kind,
      sections,
      extraMetadata: input.extraMetadata,
    }),
  };

  const chunkRows: NewKbChunk[] = chunks.map((chunk) => ({
    id: nanoid(),
    documentId,
    chunkIndex: chunk.index,
    content: chunk.content,
    tokenCount: Math.ceil(chunk.content.length / 4),
    metadata: { charStart: chunk.charStart, charEnd: chunk.charEnd },
  }));

  if (chunks.length === 0) {
    return commitIngest({
      document,
      chunks: [],
      facts: [],
      hash,
      chunkCount: 0,
      costUsd: 0,
      warnings,
      mode,
      userFacts,
    });
  }

  const chunkEmbed = await embedTexts(chunks.map((chunk) => chunk.content));
  let totalCost = chunkEmbed.costUsd;
  for (let i = 0; i < chunkRows.length; i++) {
    chunkRows[i].embedding = chunkEmbed.embeddings[i];
  }

  if (kind === "voice") {
    return commitIngest({
      document,
      chunks: chunkRows,
      facts: [],
      hash,
      chunkCount: chunks.length,
      costUsd: totalCost,
      warnings,
      mode,
      userFacts,
    });
  }

  const allFacts: Array<{
    fact: ExtractedFact;
    chunkId: string;
    chunkIndex: number;
  }> = [];
  const fallbackSection = toSectionContext(input.extraMetadata?.sectionContext);

  if (input.extractedFactsOverride) {
    const firstChunk = chunkRows[0];
    if (firstChunk?.id) {
      for (const fact of input.extractedFactsOverride) {
        allFacts.push({
          fact,
          chunkId: firstChunk.id,
          chunkIndex: firstChunk.chunkIndex,
        });
      }
    }
  } else {
    await mapWithConcurrency(
      chunks,
      FACT_EXTRACTION_CONCURRENCY,
      async (chunk) => {
        const chunkRow = chunkRows.find((row) => row.chunkIndex === chunk.index);
        if (!chunkRow?.id) return;
        try {
          const matchedSection =
            sectionForChunk(sections, chunk.charStart, chunk.charEnd) ?? fallbackSection;
          const result = await extractFactsFromChunk({
            chunkText: chunk.content,
            chunkIndex: chunk.index,
            documentName: input.name,
            sectionContext: matchedSection,
          });
          totalCost += result.costUsd;
          for (const fact of result.facts) {
            allFacts.push({
              fact,
              chunkId: chunkRow.id,
              chunkIndex: chunk.index,
            });
          }
        } catch (err) {
          warnings.push(
            `Fact extraction failed on chunk ${chunk.index}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      },
    );
  }

  if (allFacts.length === 0) {
    return commitIngest({
      document,
      chunks: chunkRows,
      facts: [],
      hash,
      chunkCount: chunks.length,
      costUsd: totalCost,
      warnings,
      mode,
      userFacts,
    });
  }

  const factEmbed = await embedTexts(allFacts.map((entry) => entry.fact.content));
  totalCost += factEmbed.costUsd;

  const threshold = factSimilarityThreshold();
  const skipped: SkippedFact[] = [];
  const kept: PreparedFact[] = [];

  for (let i = 0; i < allFacts.length; i++) {
    const entry = allFacts[i];
    const embedding = factEmbed.embeddings[i];
    const intraDupe = kept.find(
      (candidate) =>
        candidate.entry.fact.type === entry.fact.type &&
        cosineSimilarity(candidate.embedding, embedding) > threshold,
    );
    if (intraDupe) {
      skipped.push({
        content: entry.fact.content,
        factType: entry.fact.type,
        reason: "duplicate_in_batch",
        similarTo: {
          content: intraDupe.entry.fact.content,
          similarity: cosineSimilarity(intraDupe.embedding, embedding),
        },
      });
      continue;
    }
    kept.push({ entry, embedding });
  }

  return commitIngest({
    document,
    chunks: chunkRows,
    facts: kept,
    skipped,
    hash,
    chunkCount: chunks.length,
    costUsd: totalCost,
    warnings,
    mode,
    userFacts,
    threshold,
  });
}

async function commitIngest(opts: {
  document: NewKbDocument & { id: string; contentHash: string };
  chunks: NewKbChunk[];
  facts: PreparedFact[];
  skipped?: SkippedFact[];
  hash: string;
  chunkCount: number;
  costUsd: number;
  warnings: string[];
  mode: IngestMode;
  userFacts: boolean;
  threshold?: number;
}): Promise<IngestResult> {
  const skipped: SkippedFact[] = [...(opts.skipped ?? [])];
  let documentInserted = false;

  try {
    const existing = await findDocumentByHash(opts.hash);
    if (existing) {
      return duplicateDocumentResult(existing, opts.warnings);
    }

    await db().insert(kbDocuments).values(opts.document);
    documentInserted = true;

    if (opts.chunks.length > 0) {
      await db().insert(kbChunks).values(opts.chunks);
    }

    const factRows: NewKbFact[] = [];
    const threshold = opts.threshold ?? factSimilarityThreshold();
    for (const prepared of opts.facts) {
      const dbDupe = await findSimilarExistingFactForDb({
        embedding: prepared.embedding,
        factType: prepared.entry.fact.type,
        threshold,
      });

      if (dbDupe) {
        const action = resolveDuplicate(dbDupe, {
          mode: opts.mode,
          userFacts: opts.userFacts,
        });

        if (action === "supersede") {
          await db().delete(kbFacts).where(eq(kbFacts.id, dbDupe.id));
          factRows.push(toFactRow(opts.document.id, prepared, opts.userFacts));
          continue;
        }

        if (action === "merge") {
          await db()
            .update(kbFacts)
            .set({
              content: `${dbDupe.content} | ${prepared.entry.fact.content}`,
              evidenceQuote:
                [dbDupe.evidenceQuote, prepared.entry.fact.evidenceQuote]
                  .filter(Boolean)
                  .join(" | ") || dbDupe.evidenceQuote,
              embedding: mergeEmbeddings(dbDupe.embedding, prepared.embedding),
              metadata: sql`${kbFacts.metadata} || ${JSON.stringify(
                factMetadata(prepared.entry),
              )}::jsonb`,
              updatedAt: new Date(),
            })
            .where(eq(kbFacts.id, dbDupe.id));
          continue;
        }

        skipped.push({
          content: prepared.entry.fact.content,
          factType: prepared.entry.fact.type,
          reason: "duplicate_existing",
          similarTo: {
            id: dbDupe.id,
            content: dbDupe.content,
            similarity: dbDupe.similarity,
          },
        });
        continue;
      }

      factRows.push(toFactRow(opts.document.id, prepared, opts.userFacts));
    }

    if (factRows.length > 0) {
      await db().insert(kbFacts).values(factRows);
    }

    return {
      status: "ingested",
      documentId: opts.document.id,
      chunkCount: opts.chunkCount,
      factCount: factRows.length,
      duplicateFactCount: skipped.length,
      costUsd: round6(opts.costUsd),
      warnings: opts.warnings,
      skippedFacts: skipped,
    };
  } catch (err) {
    if (isUniqueContentHashViolation(err)) {
      const existing = await findDocumentByHash(opts.hash);
      if (existing) {
        return duplicateDocumentResult(existing, opts.warnings);
      }
    }
    if (documentInserted) {
      await db()
        .delete(kbDocuments)
        .where(eq(kbDocuments.id, opts.document.id))
        .catch((cleanupErr) => {
          console.warn(
            `[kb/ingest] failed cleanup after ingest error for ${opts.document.id}:`,
            cleanupErr instanceof Error ? cleanupErr.message : cleanupErr,
          );
        });
    }
    throw err;
  }
}

function toFactRow(
  documentId: string,
  prepared: PreparedFact,
  userFacts: boolean,
): NewKbFact {
  return {
    documentId,
    factType: prepared.entry.fact.type,
    content: prepared.entry.fact.content,
    evidenceQuote: prepared.entry.fact.evidenceQuote,
    embedding: prepared.embedding,
    metadata: factMetadata(prepared.entry),
    ...(userFacts ? { userAdded: "true" } : {}),
  };
}

function duplicateDocumentResult(
  existing: { id: string; name: string },
  warnings: string[],
): IngestResult {
  return {
    status: "duplicate_document",
    documentId: existing.id,
    chunkCount: 0,
    factCount: 0,
    duplicateFactCount: 0,
    costUsd: 0,
    warnings,
    duplicate: { existingDocumentId: existing.id, existingName: existing.name },
  };
}

function documentMetadata(opts: {
  pageCount?: number | null;
  warnings: string[];
  kind: DocumentKind;
  sections: SectionContext[];
  extraMetadata?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    pageCount: opts.pageCount,
    warnings: opts.warnings,
    kind: opts.kind,
    ...(opts.sections.length > 0 ? { sections: opts.sections } : {}),
    ...(opts.extraMetadata ?? {}),
  };
}

async function findSimilarExistingFactForDb(
  opts: { embedding: number[]; factType: string; threshold: number },
): Promise<ExistingFactMatch | null> {
  const vec = vectorLiteral(opts.embedding);
  const rows = await db()
    .select({
      id: kbFacts.id,
      content: kbFacts.content,
      evidenceQuote: kbFacts.evidenceQuote,
      embedding: kbFacts.embedding,
      similarity: sql<number>`1 - (${kbFacts.embedding} <=> ${vec}::vector)`,
      userAdded: kbFacts.userAdded,
      pinned: kbFacts.pinned,
    })
    .from(kbFacts)
    .where(
      and(
        eq(kbFacts.factType, opts.factType),
        sql`1 - (${kbFacts.embedding} <=> ${vec}::vector) > ${opts.threshold}`,
      ),
    )
    .orderBy(sql`${kbFacts.embedding} <=> ${vec}::vector`)
    .limit(1);
  return rows[0] ?? null;
}

function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

function mergeEmbeddings(
  existing: number[] | null | undefined,
  incoming: number[],
): number[] {
  if (!existing || existing.length !== incoming.length) return incoming;
  const merged = existing.map((value, index) => (value + incoming[index]) / 2);
  const norm = Math.sqrt(merged.reduce((sum, value) => sum + value * value, 0));
  return norm === 0 ? incoming : merged.map((value) => value / norm);
}

function isUniqueContentHashViolation(err: unknown): boolean {
  const maybe = err as { code?: string; constraint?: string; message?: string };
  return (
    maybe.code === "23505" &&
    (maybe.constraint === "kb_documents_content_hash_unique" ||
      maybe.message?.includes("kb_documents_content_hash_unique") === true)
  );
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function factMetadata(entry: { fact: ExtractedFact; chunkId: string; chunkIndex: number }) {
  return {
    chunkId: entry.chunkId,
    chunkIndex: entry.chunkIndex,
    company: entry.fact.company ?? undefined,
    role: entry.fact.role ?? undefined,
    startDate: entry.fact.startDate ?? undefined,
    endDate: entry.fact.endDate ?? undefined,
    tags: entry.fact.tags ?? [],
    metrics: entry.fact.metrics ?? [],
  };
}

function sectionForChunk(
  sections: SectionContext[],
  charStart: number,
  charEnd: number,
): SectionContext | undefined {
  if (sections.length === 0) return undefined;
  const midpoint = charStart + (charEnd - charStart) / 2;
  return (
    sections.find((s) => midpoint >= s.charStart && midpoint < s.charEnd) ??
    sections
      .map((s) => ({
        section: s,
        overlap: Math.max(0, Math.min(charEnd, s.charEnd) - Math.max(charStart, s.charStart)),
      }))
      .sort((a, b) => b.overlap - a.overlap)[0]?.section
  );
}

function companyAppearsInDocument(company: string, docName: string, parsedText: string): boolean {
  const needle = company.toLocaleLowerCase();
  return (
    docName.toLocaleLowerCase().includes(needle) ||
    parsedText.toLocaleLowerCase().includes(needle)
  );
}

function toSectionContext(value: unknown): SectionContext | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<SectionContext>;
  if (!candidate.company || typeof candidate.company !== "string") return undefined;
  return {
    company: candidate.company,
    role: typeof candidate.role === "string" ? candidate.role : undefined,
    startDate: typeof candidate.startDate === "string" ? candidate.startDate : undefined,
    endDate: typeof candidate.endDate === "string" ? candidate.endDate : undefined,
    charStart: typeof candidate.charStart === "number" ? candidate.charStart : 0,
    charEnd: typeof candidate.charEnd === "number" ? candidate.charEnd : Number.MAX_SAFE_INTEGER,
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers: Promise<void>[] = [];
  const next = async (): Promise<void> => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  };
  for (let i = 0; i < Math.min(limit, items.length); i++) {
    workers.push(next());
  }
  await Promise.all(workers);
  return results;
}
