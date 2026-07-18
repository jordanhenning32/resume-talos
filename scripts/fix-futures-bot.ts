/**
 * Remove the bad Quadratic Digital attribution for Futures Bot.
 *
 * Ground truth:
 * - RFP Factory is Quadratic Digital work.
 * - Futures Bot is a personal project and must not be included in the
 *   Quadratic Digital experience section.
 *
 * This keeps legitimate personal-project source material intact, but removes
 * the facts and quick-add source sentence that bundled Futures Bot into
 * Quadratic Digital experience.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env", override: true });

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { embedText } from "../src/lib/models/embed";

const STAMP = "2026-06-19";
const QUICK_DOC_ID = "ITGAeUnktRNKl_BmSpo9f";

const TARGET_FACT_IDS = [
  "RCIpeFdx5AYnu-cl54A7g",
  "T--_ogSg0l2bxsjfYPQui",
  "6i6WmiRaS_f5M43vS2ulh",
  "0DtKKtguMeaNd8iTAyyFg",
  "wuV1onnFf14QYL4UCpWAC",
  "PuTDFyokwD7rIH3SfIdRS",
];

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const sql = neon(process.env.DATABASE_URL);

  const [doc] = await sql`
    SELECT *
    FROM kb_documents
    WHERE id = ${QUICK_DOC_ID}
  `;
  const chunks = await sql`
    SELECT *
    FROM kb_chunks
    WHERE document_id = ${QUICK_DOC_ID}
    ORDER BY chunk_index
  `;
  const sourceFacts = await sql`
    SELECT *
    FROM kb_facts
    WHERE document_id = ${QUICK_DOC_ID}
    ORDER BY fact_type, id
  `;
  const factsToDelete = await sql`
    SELECT *
    FROM kb_facts
    WHERE id = ANY(${TARGET_FACT_IDS})
       OR (
         (content ILIKE '%futures bot%' OR content ILIKE '%futures-bot%'
          OR evidence_quote ILIKE '%futures bot%' OR evidence_quote ILIKE '%futures-bot%')
         AND metadata->>'company' ILIKE '%quadratic%'
       )
       OR (
         content ILIKE '%rfp factory%'
         AND (content ILIKE '%futures bot%' OR content ILIKE '%futures-bot%')
       )
    ORDER BY id
  `;
  const pinnedBefore = await sql`
    SELECT id, pinned, content
    FROM kb_facts
    WHERE id = ANY(${TARGET_FACT_IDS})
      AND pinned = 'true'
    ORDER BY id
  `;

  mkdirSync(".pipeline", { recursive: true });
  const backupPath = uniqueBackupPath(
    `.pipeline/futures-bot-quadratic-cleanup-backup-${STAMP}.json`,
  );
  writeFileSync(
    backupPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        document: doc ?? null,
        chunks,
        sourceFacts,
        factsToDelete,
        pinnedBefore,
      },
      null,
      2,
    ),
  );
  console.log(`Backed up cleanup scope to ${backupPath}`);

  if (doc?.raw_content) {
    const scrubbed = scrubQuickAddSource(doc.raw_content);
    if (scrubbed !== doc.raw_content) {
      const { embedding } = await embedText(scrubbed);
      await sql`
        UPDATE kb_documents
        SET raw_content = ${scrubbed},
            content_hash = ${contentHash(scrubbed)},
            byte_size = ${Buffer.byteLength(scrubbed, "utf8")},
            metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify({
              futuresBotQuadraticSourceScrubbed: "true",
              scrubbedAt: STAMP,
            })}::jsonb
        WHERE id = ${QUICK_DOC_ID}
      `;
      await sql`
        UPDATE kb_chunks
        SET content = ${scrubbed},
            token_count = ${Math.ceil(scrubbed.length / 4)},
            embedding = ${vectorLiteral(embedding)}::vector,
            metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify({
              charStart: 0,
              charEnd: scrubbed.length,
              futuresBotQuadraticSourceScrubbed: "true",
              scrubbedAt: STAMP,
            })}::jsonb
        WHERE document_id = ${QUICK_DOC_ID}
          AND chunk_index = 0
      `;
      console.log("Scrubbed Futures Bot sentence from the Quadratic quick-add source and chunk.");
    } else {
      console.log("Quadratic quick-add source was already scrubbed.");
    }
  } else {
    console.log("Quadratic quick-add source document was not found; source scrub skipped.");
  }

  const idsToDelete = Array.from(
    new Set((factsToDelete as Array<{ id: string }>).map((fact) => fact.id)),
  );
  const deletedFacts =
    idsToDelete.length > 0
      ? await sql`
          DELETE FROM kb_facts
          WHERE id = ANY(${idsToDelete})
          RETURNING id, fact_type, content
        `
      : [];
  console.log(`Deleted ${deletedFacts.length} bad/bundled Futures Bot facts.`);
  for (const fact of deletedFacts as Array<{ id: string; content: string }>) {
    console.log(`  - ${fact.id}: ${clip(fact.content, 120)}`);
  }

  const [verification] = await sql`
    SELECT
      (
        SELECT count(*)::int
        FROM kb_facts
        WHERE (content ILIKE '%futures bot%' OR content ILIKE '%futures-bot%'
          OR evidence_quote ILIKE '%futures bot%' OR evidence_quote ILIKE '%futures-bot%')
          AND metadata->>'company' ILIKE '%quadratic%'
      ) AS quadratic_futures_facts,
      (
        SELECT count(*)::int
        FROM kb_facts
        WHERE content ILIKE '%rfp factory%'
          AND (content ILIKE '%futures bot%' OR content ILIKE '%futures-bot%')
      ) AS bundled_rfp_futures_facts,
      (
        SELECT count(*)::int
        FROM kb_documents
        WHERE id = ${QUICK_DOC_ID}
          AND (raw_content ILIKE '%futures bot%' OR raw_content ILIKE '%futures-bot%')
      ) AS quick_source_mentions,
      (
        SELECT count(*)::int
        FROM kb_chunks
        WHERE document_id = ${QUICK_DOC_ID}
          AND (content ILIKE '%futures bot%' OR content ILIKE '%futures-bot%')
      ) AS quick_chunk_mentions,
      (
        SELECT count(*)::int
        FROM kb_facts
        WHERE document_id = ${QUICK_DOC_ID}
          AND (content ILIKE '%futures bot%' OR content ILIKE '%futures-bot%'
            OR evidence_quote ILIKE '%futures bot%' OR evidence_quote ILIKE '%futures-bot%')
      ) AS quick_fact_mentions,
      (
        SELECT count(*)::int
        FROM kb_facts
        WHERE content ILIKE '%futures bot%' OR content ILIKE '%futures-bot%'
          OR evidence_quote ILIKE '%futures bot%' OR evidence_quote ILIKE '%futures-bot%'
      ) AS total_futures_facts
  `;
  console.table([verification]);
}

function scrubQuickAddSource(source: string): string {
  return source
    .replace(
      /^Your Futures Bot \(live since Feb 2026\).*real-world usage and results\.\s*/m,
      "",
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function contentHash(text: string): string {
  const canonical = text.replace(/\s+/g, " ").trim().toLowerCase();
  return createHash("sha256").update(canonical).digest("hex");
}

function uniqueBackupPath(basePath: string): string {
  if (!existsSync(basePath)) return basePath;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return basePath.replace(/\.json$/, `-${stamp}.json`);
}

function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

function clip(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
