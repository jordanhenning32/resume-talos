/**
 * Remove Bronze Star / Purple Heart references from the live KB (2026-07-08).
 *
 * Rationale (candidate instruction): the awards are not on Jordan's DD-214 and
 * he wants them out of the RAG. Each affected fact ALSO carries valid combat-tour
 * / service content, so we scrub only the award phrasing and keep the rest.
 *
 * Scope confirmed by scripts/scan-awards-refs.ts: 5 facts, 0 chunks, 0 docs.
 *
 * Backs up affected rows, applies explicit per-fact rewrites, re-embeds each
 * edited fact, and stamps metadata.awardsRemoved + raw values for rollback.
 * Idempotent: a fact with no award terms left is skipped.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env", override: true });

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { kbChunks, kbDocuments, kbFacts } from "@/db/schema";
import { embedText } from "@/lib/models/embed";

const STAMP = "2026-07-08";

const AWARD_RE = /bronze star|purple heart/i;

/** Explicit per-fact rewrites (content + evidence with the award phrasing removed). */
const REWRITES: Array<{ id: string; content: string; evidence: string | null }> = [
  {
    id: "bQkPhyLHF4c_p3iLW4Nh9",
    content:
      "Served as Infantry Soldier & Transportation Specialist in the U.S. Army, 101st Airborne Division from 2001 to 2009, completing one combat tour in Iraq.",
    evidence:
      "Infantry Soldier & Transportation Specialist, U.S. Army, 101st Airborne Division (2001–2009) — completed one combat tour in Iraq.",
  },
  {
    id: "dCUVMzkM0BfsWUdptHyIO", // pinned user-added combat-tour guardrail
    content:
      "MILITARY TOUR FACT: Jordan Henning served one combat tour in Iraq with the 101st Airborne Division. Use this scope for military-service summaries.",
    evidence: "Candidate correction (2026-06-19): Jordan Henning served one combat tour in Iraq.",
  },
  {
    id: "6LKNAZaOEB-OISXQSQSce",
    content:
      "Served one combat tour in Iraq with the 101st Airborne Division, with leadership lessons translating into incident command, scaling service organizations, and customer-facing pressure situations.",
    evidence:
      "one combat tour in Iraq with the 101st Airborne translated directly into how I run incident command, scale service organizations, and show up for customers under pressure.",
  },
  {
    id: "wUThSUQTrpi9cQuc8mWeW",
    content: "Completed one combat tour in Iraq.",
    evidence: "completed one combat tour in Iraq.",
  },
  {
    id: "aFsLQnNMUrmM9KK1IsRIy",
    content: "Combat-tested through one combat tour in Iraq with the 101st Airborne.",
    evidence: "Combat-tested under one combat tour in Iraq with the 101st Airborne.",
  },
];

async function main() {
  const ids = REWRITES.map((r) => r.id);

  // Backup (exclude embedding vectors — bulky and regenerable).
  const backup = await db()
    .select({
      id: kbFacts.id,
      factType: kbFacts.factType,
      content: kbFacts.content,
      evidenceQuote: kbFacts.evidenceQuote,
      metadata: kbFacts.metadata,
      userAdded: kbFacts.userAdded,
      pinned: kbFacts.pinned,
    })
    .from(kbFacts)
    .where(inArray(kbFacts.id, ids));

  mkdirSync(".pipeline", { recursive: true });
  const backupPath = uniqueBackupPath(`.pipeline/awards-removal-backup-${STAMP}.json`);
  writeFileSync(backupPath, JSON.stringify({ createdAt: new Date().toISOString(), facts: backup }, null, 2));
  console.log(`Backed up ${backup.length} fact(s) to ${backupPath}`);

  let updated = 0;
  let skipped = 0;
  for (const r of REWRITES) {
    const [row] = await db()
      .select({ content: kbFacts.content, evidenceQuote: kbFacts.evidenceQuote, metadata: kbFacts.metadata })
      .from(kbFacts)
      .where(eq(kbFacts.id, r.id))
      .limit(1);

    if (!row) {
      console.log(`SKIP ${r.id} — not found`);
      skipped++;
      continue;
    }
    if (!AWARD_RE.test(row.content) && !AWARD_RE.test(row.evidenceQuote ?? "")) {
      console.log(`SKIP ${r.id} — already clean`);
      skipped++;
      continue;
    }

    const { embedding } = await embedText(r.content);
    await db()
      .update(kbFacts)
      .set({
        content: r.content,
        evidenceQuote: r.evidence,
        embedding,
        metadata: sql`coalesce(${kbFacts.metadata}, '{}'::jsonb) || ${JSON.stringify({
          awardsRemoved: "true",
          awardsRemovedAt: STAMP,
          awardsContentRaw: row.content,
          awardsEvidenceRaw: row.evidenceQuote,
        })}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(kbFacts.id, r.id));
    console.log(`UPDATED ${r.id}\n   old: ${row.content}\n   new: ${r.content}\n`);
    updated++;
  }

  const verification = await verify();
  console.log(`\nDone. updated=${updated} skipped=${skipped}`);
  console.table([verification]);

  if (verification.award_facts + verification.award_chunks + verification.award_docs > 0) {
    console.error("WARNING — award references still present after run. Review above.");
    process.exit(2);
  }
  process.exit(0);
}

async function verify() {
  const factWhere = sql`(${kbFacts.content} ILIKE '%bronze star%' OR ${kbFacts.content} ILIKE '%purple heart%'
    OR ${kbFacts.evidenceQuote} ILIKE '%bronze star%' OR ${kbFacts.evidenceQuote} ILIKE '%purple heart%')`;
  const chunkWhere = sql`(${kbChunks.content} ILIKE '%bronze star%' OR ${kbChunks.content} ILIKE '%purple heart%')`;
  const docWhere = sql`(${kbDocuments.rawContent} ILIKE '%bronze star%' OR ${kbDocuments.rawContent} ILIKE '%purple heart%')`;

  const [f] = await db().select({ v: sql<number>`count(*)::int` }).from(kbFacts).where(factWhere);
  const [c] = await db().select({ v: sql<number>`count(*)::int` }).from(kbChunks).where(chunkWhere);
  const [d] = await db().select({ v: sql<number>`count(*)::int` }).from(kbDocuments).where(docWhere);
  return {
    award_facts: Number(f?.v ?? 0),
    award_chunks: Number(c?.v ?? 0),
    award_docs: Number(d?.v ?? 0),
  };
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
