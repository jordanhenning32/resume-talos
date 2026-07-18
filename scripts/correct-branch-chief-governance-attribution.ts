/**
 * Correct Branch Chief governance-pattern attribution.
 *
 * Ground truth (candidate correction, 2026-06-19):
 * - 14-day patch compliance, 99.9% availability, RAID / critical-path
 *   discipline across 30+ concurrent workloads, and standard-methods
 *   enforcement belong under SSA Branch Chief work, not Quadratic Digital.
 * - Do not use this material as a Quadratic Digital / CGO bullet.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env", override: true });

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { kbChunks, kbDocuments, kbFacts } from "@/db/schema";
import { embedText } from "@/lib/models/embed";

const STAMP = "2026-06-19";
const SOURCE_DOC_IDS_TO_REMOVE = ["Z7MZ7k6L0gOPCXTMuVQQq"];
const SOURCE_DERIVED_FACT_IDS_TO_REMOVE = [
  "LN804UIGPwj5tok6NhDOO",
  "UEBluF0vbR7Uj6OPmQFz4",
  "FW3bHtao8_BNTkayXQqAB",
  "YIYdcj1CZBe__x5uEF8fR",
  "CU_WSrX3shaFIE8O-cdzE",
  "wipxmqBTNWRQibZZYxa9x",
  "jQHkniw_EbM3Q6zFLSp8Q",
  "NjA9ipUOk7wAU5BQ9PAHO",
  "84B6KUSK56eWPKsirx3xj",
  "RSdJeGUWj42n8TqkmoWa8",
  "VwhfztLMybN4UqJwzA3_G",
  "uvG2ghLUBK-LoNPuwpOxY",
  "w4GdfrDtVYzYIyJV3qewL",
  "2z9ScJPfv4a5zNxlKen06",
  "PX1RsJo4XhNxEwEGXv0xN",
  "fbjO7TUYlsqKHgHyLczzi",
  "EhVvdclG9sD4yHtVZPcl_",
  "eA_Ohv9DWL6JJg5hivjGm",
];
const EXISTING_BRANCH_RAID_FACT_ID = "LLiQnt1F-YbohLdKBu7EO";

const CORRECTED_BRANCH_FACT = {
  content:
    "As Branch Chief, Hearings Office IT Oversight, applied SSA governance patterns including 14-day patch compliance, 99.9% availability, RAID and critical-path discipline across 30+ concurrent workloads, IT solution tracking, and standard-methods enforcement across field IT operations.",
  evidence:
    "Candidate correction (2026-06-19): this governance-pattern fact belongs under Branch Chief, not Quadratic Digital.",
  metadata: {
    company: "Social Security Administration",
    role: "Branch Chief, Hearings Office IT Oversight",
    startDate: "Jan 2022",
    endDate: "2025",
    source: "candidate-correction",
    branchChiefGovernanceCorrected: "true",
    correctedAt: STAMP,
    tags: [
      "branch-chief",
      "governance",
      "raid",
      "critical-path",
      "patch-compliance",
      "availability",
      "standard-methods",
    ],
    metrics: [
      { label: "patch compliance", value: "14-day" },
      { label: "availability", value: "99.9%" },
      { label: "concurrent workloads", value: "30+" },
    ],
  },
};

const GUARDRAIL = {
  content:
    "BRANCH CHIEF ATTRIBUTION GUARDRAIL: 14-day patch compliance, 99.9% availability, RAID and critical-path discipline across 30+ concurrent workloads, IT solution tracking, and standard-methods enforcement are Branch Chief / SSA Hearings Office IT Oversight facts. Do not place these claims under Quadratic Digital or describe them as CGO client-application work.",
  evidence:
    "Candidate correction (2026-06-19): Branch Chief governance-pattern material was incorrectly appearing under Quadratic Digital.",
  metadata: {
    company: "Social Security Administration",
    role: "Branch Chief, Hearings Office IT Oversight",
    startDate: "Jan 2022",
    endDate: "2025",
    source: "candidate-correction",
    branchChiefGovernanceGuardrail: "true",
    correctedAt: STAMP,
    tags: ["role-boundary", "quadratic-exclusion", "branch-chief"],
  },
};

async function main() {
  const backup = await collectBackupRows();
  mkdirSync(".pipeline", { recursive: true });
  const backupPath = uniqueBackupPath(
    `.pipeline/branch-chief-governance-correction-backup-${STAMP}.json`,
  );
  writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.log(`Backed up correction scope to ${backupPath}`);

  await updateBranchChiefFact();
  await upsertGuardrail();

  const deletedQuadraticFacts = await deleteBadQuadraticFacts();
  for (const fact of deletedQuadraticFacts) {
    console.log(`Deleted bad Quadratic governance fact ${fact.id}: ${clip(fact.content, 120)}`);
  }

  const deletedSourceFacts = await removeBadSourceFacts();
  console.log(`Removed ${deletedSourceFacts.length} fact(s) derived from the bad source.`);

  const deletedDocs = await removeBadSourceDocuments();
  console.log(`Removed ${deletedDocs.length} source document(s).`);

  const verification = await verify();
  console.table([verification]);
}

async function collectBackupRows() {
  const docs = await db()
    .select()
    .from(kbDocuments)
    .where(inArray(kbDocuments.id, SOURCE_DOC_IDS_TO_REMOVE));
  const chunks =
    SOURCE_DOC_IDS_TO_REMOVE.length > 0
      ? await db()
          .select()
          .from(kbChunks)
          .where(inArray(kbChunks.documentId, SOURCE_DOC_IDS_TO_REMOVE))
      : [];
  const facts = await db()
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
    .where(
      or(
        eq(kbFacts.id, EXISTING_BRANCH_RAID_FACT_ID),
        inArray(kbFacts.id, SOURCE_DERIVED_FACT_IDS_TO_REMOVE),
        inArray(kbFacts.documentId, SOURCE_DOC_IDS_TO_REMOVE),
        sql`${kbFacts.metadata}->>'company' ILIKE '%Quadratic%'
          AND (
            ${kbFacts.content} ILIKE '%14-day%'
            OR ${kbFacts.content} ILIKE '%14 day%'
            OR ${kbFacts.content} ILIKE '%99.9%'
            OR ${kbFacts.content} ILIKE '%30+ concurrent%'
            OR ${kbFacts.content} ILIKE '%critical-path%'
            OR ${kbFacts.content} ILIKE '%critical path%'
            OR ${kbFacts.content} ILIKE '%RAID%'
            OR ${kbFacts.content} ILIKE '%portfolio governance%'
            OR ${kbFacts.content} ILIKE '%SSA governance%'
          )`,
      ),
    );
  return { createdAt: new Date().toISOString(), docs, chunks, facts };
}

async function updateBranchChiefFact() {
  const { embedding } = await embedText(CORRECTED_BRANCH_FACT.content);
  const [existing] = await db()
    .select({ id: kbFacts.id })
    .from(kbFacts)
    .where(eq(kbFacts.id, EXISTING_BRANCH_RAID_FACT_ID))
    .limit(1);

  const values = {
    documentId: null,
    factType: "achievement" as const,
    content: CORRECTED_BRANCH_FACT.content,
    evidenceQuote: CORRECTED_BRANCH_FACT.evidence,
    metadata: CORRECTED_BRANCH_FACT.metadata,
    embedding,
    userAdded: "true",
    pinned: "true",
    updatedAt: new Date(),
  };

  if (existing) {
    await db()
      .update(kbFacts)
      .set(values)
      .where(eq(kbFacts.id, EXISTING_BRANCH_RAID_FACT_ID));
    console.log(`Updated Branch Chief governance fact ${EXISTING_BRANCH_RAID_FACT_ID}.`);
    return;
  }

  const [inserted] = await db()
    .insert(kbFacts)
    .values(values)
    .returning({ id: kbFacts.id });
  console.log(`Inserted Branch Chief governance fact ${inserted.id}.`);
}

async function upsertGuardrail() {
  const [existing] = await db()
    .select({ id: kbFacts.id })
    .from(kbFacts)
    .where(sql`${kbFacts.metadata}->>'branchChiefGovernanceGuardrail' = 'true'`)
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
    console.log(`Updated Branch Chief governance guardrail ${existing.id}.`);
    return;
  }

  const [inserted] = await db()
    .insert(kbFacts)
    .values(values)
    .returning({ id: kbFacts.id });
  console.log(`Inserted Branch Chief governance guardrail ${inserted.id}.`);
}

async function deleteBadQuadraticFacts(): Promise<Array<{ id: string; content: string }>> {
  return db()
    .delete(kbFacts)
    .where(
      sql`${kbFacts.metadata}->>'company' ILIKE '%Quadratic%'
        AND (
          ${kbFacts.content} ILIKE '%14-day%'
          OR ${kbFacts.content} ILIKE '%14 day%'
          OR ${kbFacts.content} ILIKE '%99.9%'
          OR ${kbFacts.content} ILIKE '%30+ concurrent%'
          OR ${kbFacts.content} ILIKE '%critical-path%'
          OR ${kbFacts.content} ILIKE '%critical path%'
          OR ${kbFacts.content} ILIKE '%RAID%'
          OR ${kbFacts.content} ILIKE '%portfolio governance%'
          OR ${kbFacts.content} ILIKE '%SSA governance%'
        )`,
    )
    .returning({ id: kbFacts.id, content: kbFacts.content });
}

async function removeBadSourceFacts() {
  if (SOURCE_DERIVED_FACT_IDS_TO_REMOVE.length === 0) return [];
  return db()
    .delete(kbFacts)
    .where(inArray(kbFacts.id, SOURCE_DERIVED_FACT_IDS_TO_REMOVE))
    .returning({ id: kbFacts.id, content: kbFacts.content });
}

async function removeBadSourceDocuments() {
  if (SOURCE_DOC_IDS_TO_REMOVE.length === 0) return [];
  return db()
    .delete(kbDocuments)
    .where(inArray(kbDocuments.id, SOURCE_DOC_IDS_TO_REMOVE))
    .returning({ id: kbDocuments.id, name: kbDocuments.name });
}

async function verify() {
  const [correctedBranchFacts, badQuadraticFacts, removedSourceDocs, guardrailFacts] =
    await Promise.all([
      countFacts(sql`${kbFacts.metadata}->>'branchChiefGovernanceCorrected' = 'true'
        AND ${kbFacts.metadata}->>'role' ILIKE '%Branch Chief%'
        AND ${kbFacts.pinned} = 'true'`),
      countFacts(sql`${kbFacts.metadata}->>'company' ILIKE '%Quadratic%'
        AND (
          ${kbFacts.content} ILIKE '%14-day%'
          OR ${kbFacts.content} ILIKE '%14 day%'
          OR ${kbFacts.content} ILIKE '%99.9%'
          OR ${kbFacts.content} ILIKE '%30+ concurrent%'
          OR ${kbFacts.content} ILIKE '%critical-path%'
          OR ${kbFacts.content} ILIKE '%critical path%'
          OR ${kbFacts.content} ILIKE '%RAID%'
          OR ${kbFacts.content} ILIKE '%portfolio governance%'
          OR ${kbFacts.content} ILIKE '%SSA governance%'
        )`),
      db()
        .select({ id: kbDocuments.id })
        .from(kbDocuments)
        .where(inArray(kbDocuments.id, SOURCE_DOC_IDS_TO_REMOVE)),
      countFacts(sql`${kbFacts.metadata}->>'branchChiefGovernanceGuardrail' = 'true'
        AND ${kbFacts.pinned} = 'true'`),
    ]);
  const staleSourceDerivedFacts = await db()
    .select({ id: kbFacts.id })
    .from(kbFacts)
    .where(inArray(kbFacts.id, SOURCE_DERIVED_FACT_IDS_TO_REMOVE));

  return {
    corrected_branch_facts: correctedBranchFacts,
    bad_quadratic_governance_facts: badQuadraticFacts,
    removed_source_docs_remaining: removedSourceDocs.length,
    stale_source_derived_facts_remaining: staleSourceDerivedFacts.length,
    guardrail_facts: guardrailFacts,
  };
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

function clip(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
