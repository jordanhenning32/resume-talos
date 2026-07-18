/**
 * Correct candidate education facts in the live KB and cached drafts.
 *
 * Ground truth (candidate correction, 2026-06-19):
 * - B.A. in Computer Information Systems, Kent State University, 2008.
 * - M.B.A., Malone University, 2012.
 * - Malone University is NOT the bachelor's institution, and the bachelor's
 *   degree is NOT a B.S. in Computer Science.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env", override: true });

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { applicationVersions, kbFacts } from "@/db/schema";
import { embedText } from "@/lib/models/embed";

const STAMP = "2026-06-19";

const BACHELOR_FACT = {
  content:
    "Earned a B.A. in Computer Information Systems from Kent State University in 2008.",
  evidence:
    "Candidate correction (2026-06-19): B.A. from Kent State University in Computer Information Systems, 2008.",
  metadata: {
    institution: "Kent State University",
    degree: "B.A.",
    field: "Computer Information Systems",
    year: "2008",
    source: "candidate-correction",
    educationBachelorCorrected: "true",
    correctedAt: STAMP,
    tags: ["education", "bachelor", "computer-information-systems"],
  },
};

const MBA_FACT = {
  content: "Earned an M.B.A. from Malone University in 2012.",
  evidence: "Candidate correction (2026-06-19): M.B.A. from Malone University, 2012.",
  metadata: {
    institution: "Malone University",
    degree: "M.B.A.",
    field: "Business Administration",
    year: "2012",
    source: "candidate-correction",
    educationMbaCorrected: "true",
    correctedAt: STAMP,
    tags: ["education", "mba", "business-administration"],
  },
};

const EDUCATION_GUARDRAIL = {
  content:
    "EDUCATION ATTRIBUTION GUARDRAIL: Jordan Henning's bachelor's degree is a B.A. in Computer Information Systems from Kent State University (2008). Malone University is only the M.B.A. institution (2012). Do not combine Malone University with the bachelor's degree or label the bachelor's as B.S. / Computer Science.",
  evidence:
    "Candidate correction (2026-06-19): bachelor is Kent State B.A. in Computer Information Systems; Malone is the M.B.A. institution only.",
  metadata: {
    source: "candidate-correction",
    educationAttributionGuardrail: "true",
    correctedAt: STAMP,
    tags: ["education", "role-boundary", "bachelor", "mba"],
  },
};

async function main() {
  const backup = await collectBackupRows();
  mkdirSync(".pipeline", { recursive: true });
  const backupPath = uniqueBackupPath(`.pipeline/education-degree-correction-backup-${STAMP}.json`);
  writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.log(`Backed up correction scope to ${backupPath}`);

  const staleFactsUpdated = await correctStaleEducationFacts();
  const bachelorId = await upsertPinnedFact("educationBachelorCorrected", BACHELOR_FACT);
  const mbaId = await upsertPinnedFact("educationMbaCorrected", MBA_FACT);
  const guardrailId = await upsertPinnedFact(
    "educationAttributionGuardrail",
    EDUCATION_GUARDRAIL,
    "context",
  );
  const cachedDraftsUpdated = await correctCachedDrafts();
  const verification = await verify();

  console.log(
    `Updated stale facts=${staleFactsUpdated}, bachelor=${bachelorId}, mba=${mbaId}, guardrail=${guardrailId}, cached drafts=${cachedDraftsUpdated}`,
  );
  console.table([verification]);
}

async function collectBackupRows() {
  const [facts, versions] = await Promise.all([
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
      .where(educationFactScope()),
    db()
      .select({
        id: applicationVersions.id,
        applicationId: applicationVersions.applicationId,
        versionNumber: applicationVersions.versionNumber,
        iteration: applicationVersions.iteration,
        resumeMarkdown: applicationVersions.resumeMarkdown,
        coverLetterMarkdown: applicationVersions.coverLetterMarkdown,
        createdAt: applicationVersions.createdAt,
      })
      .from(applicationVersions)
      .where(staleVersionText()),
  ]);
  return { createdAt: new Date().toISOString(), facts, versions };
}

async function correctStaleEducationFacts() {
  const facts = await db()
    .select({
      id: kbFacts.id,
      content: kbFacts.content,
      evidenceQuote: kbFacts.evidenceQuote,
      metadata: kbFacts.metadata,
    })
    .from(kbFacts)
    .where(educationFactScope());

  let updated = 0;
  for (const fact of facts) {
    const nextContent = fixEducationText(fact.content);
    const nextEvidence = fact.evidenceQuote ? fixEducationText(fact.evidenceQuote) : null;
    if (nextContent === fact.content && nextEvidence === fact.evidenceQuote) continue;
    const { embedding } = await embedText(nextContent);
    await db()
      .update(kbFacts)
      .set({
        content: nextContent,
        evidenceQuote: nextEvidence,
        embedding,
        metadata: sql`coalesce(${kbFacts.metadata}, '{}'::jsonb) || ${JSON.stringify({
          educationDegreeCorrected: "true",
          educationDegreeCorrectedAt: STAMP,
          educationContentRaw: fact.content,
          educationEvidenceRaw: fact.evidenceQuote,
        })}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(kbFacts.id, fact.id));
    updated++;
  }
  return updated;
}

async function upsertPinnedFact(
  flag: "educationBachelorCorrected" | "educationMbaCorrected" | "educationAttributionGuardrail",
  item: {
    content: string;
    evidence: string;
    metadata: Record<string, unknown>;
  },
  factType: "education" | "context" = "education",
) {
  const [existing] = await db()
    .select({ id: kbFacts.id })
    .from(kbFacts)
    .where(sql`${kbFacts.metadata}->>${flag} = 'true'`)
    .limit(1);
  const { embedding } = await embedText(item.content);
  const values = {
    documentId: null,
    factType,
    content: item.content,
    evidenceQuote: item.evidence,
    metadata: item.metadata,
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

async function correctCachedDrafts() {
  const versions = await db()
    .select({
      id: applicationVersions.id,
      resumeMarkdown: applicationVersions.resumeMarkdown,
      coverLetterMarkdown: applicationVersions.coverLetterMarkdown,
    })
    .from(applicationVersions)
    .where(staleVersionText());

  let updated = 0;
  for (const version of versions) {
    const resume = version.resumeMarkdown ? fixEducationText(version.resumeMarkdown) : null;
    const cover = version.coverLetterMarkdown ? fixEducationText(version.coverLetterMarkdown) : null;
    if (resume === version.resumeMarkdown && cover === version.coverLetterMarkdown) continue;
    await db()
      .update(applicationVersions)
      .set({
        resumeMarkdown: resume,
        coverLetterMarkdown: cover,
      })
      .where(eq(applicationVersions.id, version.id));
    updated++;
  }
  return updated;
}

async function verify() {
  const [badFacts, badDrafts, bachelorFacts, mbaFacts, guardrails] = await Promise.all([
    countFacts(staleEducationText(kbFacts.content, kbFacts.evidenceQuote)),
    countVersions(staleVersionText()),
    countFacts(sql`${kbFacts.content} ILIKE '%B.A.%Computer Information Systems%Kent State University%2008%'`),
    countFacts(sql`${kbFacts.content} ILIKE '%M.B.A.%Malone University%2012%'`),
    countFacts(sql`${kbFacts.metadata}->>'educationAttributionGuardrail' = 'true'
      AND ${kbFacts.pinned} = 'true'`),
  ]);

  return {
    stale_fact_content_or_evidence: badFacts,
    stale_cached_drafts: badDrafts,
    bachelor_kent_state_2008_facts: bachelorFacts,
    mba_malone_2012_facts: mbaFacts,
    pinned_guardrails: guardrails,
  };
}

function educationFactScope() {
  return sql`${kbFacts.factType} = 'education'
    OR ${staleEducationText(kbFacts.content, kbFacts.evidenceQuote)}
    OR ${kbFacts.content} ILIKE '%Kent State%'
    OR ${kbFacts.content} ILIKE '%Malone%'
    OR ${kbFacts.evidenceQuote} ILIKE '%Kent State%'
    OR ${kbFacts.evidenceQuote} ILIKE '%Malone%'`;
}

function staleEducationText(contentColumn: unknown, evidenceColumn: unknown) {
  return sql`(
    ${contentColumn} ILIKE '%B.S.%Computer Science%Malone%'
    OR ${contentColumn} ILIKE '%BS%Computer Science%Malone%'
    OR ${contentColumn} ILIKE '%Bachelor of Science%Computer Science%Malone%'
    OR ${contentColumn} ILIKE '%Computer Science%Malone University%'
    OR ${contentColumn} ILIKE '%B.A.%Computer Information Systems%Kent State University%2007%'
    OR ${contentColumn} ILIKE '%B.A.%Computer Information System%Kent State University%2007%'
    OR ${evidenceColumn} ILIKE '%B.S.%Computer Science%Malone%'
    OR ${evidenceColumn} ILIKE '%BS%Computer Science%Malone%'
    OR ${evidenceColumn} ILIKE '%Bachelor of Science%Computer Science%Malone%'
    OR ${evidenceColumn} ILIKE '%Computer Science%Malone University%'
    OR ${evidenceColumn} ILIKE '%B.A.%Computer Information Systems%Kent State University%2007%'
    OR ${evidenceColumn} ILIKE '%B.A.%Computer Information System%Kent State University%2007%'
  )`;
}

function staleVersionText() {
  return sql`${staleEducationText(
    applicationVersions.resumeMarkdown,
    applicationVersions.coverLetterMarkdown,
  )}`;
}

function fixEducationText(value: string): string {
  return value
    .replace(
      /\bB\.?\s*S\.?\s+in\s+Computer\s+Science,\s+Malone\s+University(?:\s*[,·-]\s*\d{4})?/gi,
      "B.A. in Computer Information Systems, Kent State University, 2008",
    )
    .replace(
      /\bBachelor\s+of\s+Science\s+in\s+Computer\s+Science\s+from\s+Malone\s+University(?:\s*[,·-]\s*\d{4})?/gi,
      "B.A. in Computer Information Systems from Kent State University in 2008",
    )
    .replace(
      /\bBachelor\s+of\s+Science,\s+Computer\s+Science,\s+Malone\s+University(?:\s*[,·-]\s*\d{4})?/gi,
      "B.A., Computer Information Systems, Kent State University, 2008",
    )
    .replace(
      /\bB\.?\s*A\.?\s+in\s+Computer\s+Information\s+Systems,\s+Kent\s+State\s+University(?:\s*[,·-]\s*)?2007\b/gi,
      "B.A. in Computer Information Systems, Kent State University, 2008",
    )
    .replace(
      /\bB\.?\s*A\.?,?\s+(?:in\s+)?Computer\s+Information\s+Systems?(?:\s*\([^)]*\))?\*{0,2}\s*(?:,|\s*[\u2013\u2014-])\s*Kent\s+State\s+University\*{0,2}\s*(?:[,·\u2013\u2014-]|\()\s*2007\b/gi,
      "B.A. in Computer Information Systems, Kent State University, 2008",
    )
    .replace(
      /\bB\.?\s*A\.?,\s+Computer\s+Information\s+Systems,\s+Kent\s+State\s+University(?:\s*[,·-]\s*)?2007\b/gi,
      "B.A., Computer Information Systems, Kent State University, 2008",
    )
    .replace(
      /\bEarned a B\.A\. in Computer Information Systems from Kent State University in 2007\./gi,
      "Earned a B.A. in Computer Information Systems from Kent State University in 2008.",
    );
}

async function countFacts(where: ReturnType<typeof sql>) {
  const [row] = await db()
    .select({ value: sql<number>`count(*)::int` })
    .from(kbFacts)
    .where(where);
  return Number(row?.value ?? 0);
}

async function countVersions(where: ReturnType<typeof sql>) {
  const [row] = await db()
    .select({ value: sql<number>`count(*)::int` })
    .from(applicationVersions)
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
