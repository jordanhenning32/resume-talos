import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

const EMBED_DIMS = 1536;

export const kbDocuments = pgTable(
  "kb_documents",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    name: text("name").notNull(),
    fileType: text("file_type").notNull(),
    rawContent: text("raw_content").notNull(),
    // SHA-256 hex of the normalized text. Used for doc-level dedup.
    contentHash: text("content_hash").notNull(),
    sourcePath: text("source_path"),
    byteSize: integer("byte_size"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("kb_documents_content_hash_unique").on(table.contentHash),
  ],
);

export const kbChunks = pgTable(
  "kb_chunks",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    documentId: text("document_id")
      .notNull()
      .references(() => kbDocuments.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    tokenCount: integer("token_count"),
    embedding: vector("embedding", { dimensions: EMBED_DIMS }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("kb_chunks_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
    index("kb_chunks_document_idx").on(table.documentId),
  ],
);

export const factTypeValues = [
  "achievement",
  "skill",
  "role",
  "education",
  "certification",
  "project",
  "story",
  "metric",
  "tool",
  "responsibility",
  "context",
] as const;

export type FactType = (typeof factTypeValues)[number];

export const kbFacts = pgTable(
  "kb_facts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    documentId: text("document_id").references(() => kbDocuments.id, {
      onDelete: "set null",
    }),
    factType: text("fact_type").notNull(),
    content: text("content").notNull(),
    evidenceQuote: text("evidence_quote"),
    metadata: jsonb("metadata").$type<{
      company?: string;
      role?: string;
      startDate?: string;
      endDate?: string;
      tags?: string[];
      metrics?: Array<{ label: string; value: string }>;
      [key: string]: unknown;
    }>().default({}),
    embedding: vector("embedding", { dimensions: EMBED_DIMS }),
    userAdded: text("user_added").notNull().default("false"),
    pinned: text("pinned").notNull().default("false"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("kb_facts_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
    index("kb_facts_document_idx").on(table.documentId),
    index("kb_facts_type_idx").on(table.factType),
  ],
);

export type KbDocument = typeof kbDocuments.$inferSelect;
export type NewKbDocument = typeof kbDocuments.$inferInsert;
export type KbChunk = typeof kbChunks.$inferSelect;
export type NewKbChunk = typeof kbChunks.$inferInsert;
export type KbFact = typeof kbFacts.$inferSelect;
export type NewKbFact = typeof kbFacts.$inferInsert;
