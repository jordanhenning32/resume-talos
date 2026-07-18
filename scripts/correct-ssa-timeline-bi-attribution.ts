/**
 * Correct SSA 2013-2016 timeline and Tableau/WebFOCUS BI attribution.
 *
 * Ground truth (candidate correction, 2026-06-19):
 * - Systems Analyst: 2013-2014
 * - Lead Systems Analyst: 2014-2016
 * - Tableau/WebFOCUS / agency-wide Business Intelligence implementation is
 *   IT Project Manager-era work, not Branch Chief work.
 *
 * The KB contained generated quick-add documents that placed BI/statistical
 * analytics under Branch Chief. This script backs up and removes those source
 * documents/facts, retags legitimate BI facts to IT Project Manager with dates,
 * and inserts pinned guardrails so future writers keep the roles separate.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env", override: true });

import { mkdirSync, writeFileSync } from "node:fs";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { kbChunks, kbDocuments, kbFacts } from "@/db/schema";
import { embedText } from "@/lib/models/embed";

const STAMP = "2026-06-19";

const SUSPECT_DOCUMENT_NAMES = [
  "quick-ZfFvYqZA_Mw42ovvijnQa-1780344942239.txt",
  "quick-vuKhz7p7BhJ2paGEKnhdT-1779145930073.txt",
  "quick-vuKhz7p7BhJ2paGEKnhdT-1779146009892.txt",
];

const BI_IT_PM_REFRAMES: Array<{
  id: string;
  content: string;
  evidence: string;
}> = [
  {
    id: "VOFQDNl2VyOzgKzkr6SQH",
    content:
      "As IT Project Manager (2016-2022), led progress on the agency-wide Tableau and WebFocus implementation at the Social Security Administration.",
    evidence:
      "Candidate correction (2026-06-19): Tableau/WebFOCUS BI implementation belongs to IT Project Manager-era work, not Branch Chief.",
  },
  {
    id: "acJtnmXE2wNPoFwPlFgFP",
    content:
      "As IT Project Manager (2016-2022), developed SSA's strategy for business intelligence and data visualization tools.",
    evidence:
      "Candidate correction (2026-06-19): BI strategy and data visualization tool work belongs to IT Project Manager-era work.",
  },
  {
    id: "qlBtLCb0xJPSrqIfT2Xgy",
    content:
      "As IT Project Manager (2016-2022), led agency-wide Business Intelligence implementation using Tableau and WebFocus.",
    evidence:
      "Candidate correction (2026-06-19): Tableau/WebFOCUS BI implementation belongs to IT Project Manager-era work, not Branch Chief.",
  },
  {
    id: "yLSykWB-Z-cw_Ic2rQ_O0",
    content:
      "As IT Project Manager (2016-2022), led agency-wide BI platform implementation at SSA using Tableau and WebFocus.",
    evidence:
      "Candidate correction (2026-06-19): Tableau/WebFOCUS BI implementation belongs to IT Project Manager-era work.",
  },
  {
    id: "_aDN8G5_m4HB5GHiSPxyK",
    content:
      "As IT Project Manager (2016-2022), was responsible for selection and implementation of new Business Intelligence tools across SSA.",
    evidence:
      "Candidate correction (2026-06-19): BI tool selection and implementation belongs to IT Project Manager-era work.",
  },
  {
    id: "t-xaRx7eeYCQNwP8Y4OLq",
    content:
      "As IT Project Manager (2016-2022), helped define agency-wide policies governing newly implemented Business Intelligence tools at SSA.",
    evidence:
      "Candidate correction (2026-06-19): BI policy/tooling work belongs to IT Project Manager-era work.",
  },
  {
    id: "a_OO9SrD6QsRXJ1a8bwNR",
    content:
      "As IT Project Manager (2016-2022), selected and implemented new Business Intelligence tools at SSA.",
    evidence:
      "Candidate correction (2026-06-19): BI implementation belongs to IT Project Manager-era work.",
  },
  {
    id: "DkSFL-9BsOtxowzs2-Kom",
    content:
      "As IT Project Manager (2016-2022), conducted stakeholder interviews for SSA's Business Intelligence tool selection process.",
    evidence:
      "Candidate correction (2026-06-19): BI requirements and stakeholder engagement belongs to IT Project Manager-era work.",
  },
  {
    id: "I0o6VJTD55vzn7E4vUzSZ",
    content:
      "As IT Project Manager (2016-2022), selected and implemented Tableau and WebFocus as business intelligence tools at SSA.",
    evidence:
      "Candidate correction (2026-06-19): Tableau/WebFOCUS selection and implementation belongs to IT Project Manager-era work.",
  },
  {
    id: "j9F4LbbYyArG1b8FJN_Nb",
    content:
      "As IT Project Manager (2016-2022), used Tableau for agency-wide Business Intelligence implementation work.",
    evidence:
      "Candidate correction (2026-06-19): Tableau/WebFOCUS BI implementation belongs to IT Project Manager-era work.",
  },
  {
    id: "2XYf24uCmACMKN0TIhY3S",
    content:
      "Served as IT Project Manager for SSA's Business Intelligence Tools Implementation initiative.",
    evidence:
      "Candidate correction (2026-06-19): BI Tools Implementation was IT Project Manager-era work.",
  },
  {
    id: "9_SfG_64mLBSErIkekTdm",
    content:
      "As IT Project Manager (2016-2022), delivered major SSA IT modernizations: agency-wide Tableau + WebFocus BI platform, Centralized Print consolidation, and Appeals Database consolidation (7 legacy systems into 1).",
    evidence:
      "Candidate correction (2026-06-19): these major modernization efforts belong to IT Project Manager-era work.",
  },
  {
    id: "ocTtM_9AlmsGItqXhqScG",
    content:
      "As IT Project Manager (2016-2022), led agency-wide Business Intelligence platform rollout using Tableau and WebFocus, including change-management and training planning.",
    evidence:
      "Candidate correction (2026-06-19): Tableau/WebFOCUS BI rollout belongs to IT Project Manager-era work, not Branch Chief.",
  },
  {
    id: "cM7oLZCXf2qrYahDNtSvk",
    content:
      "As IT Project Manager (2016-2022), supported knowledge-transfer planning for agency-wide BI platform implementation using Tableau and WebFocus.",
    evidence:
      "Candidate correction (2026-06-19): Tableau/WebFOCUS BI implementation and related rollout planning belongs to IT Project Manager-era work, not Branch Chief.",
  },
];

const ROLE_FACTS: Array<{
  role: string;
  startDate: string;
  endDate: string;
  content: string;
  evidence: string;
}> = [
  {
    role: "Systems Analyst",
    startDate: "2013",
    endDate: "2014",
    content:
      "Served as Systems Analyst at the Social Security Administration from 2013 to 2014.",
    evidence:
      "Candidate correction (2026-06-19): Systems Analyst from 2013 to 2014.",
  },
  {
    role: "Lead Systems Analyst",
    startDate: "2014",
    endDate: "2016",
    content:
      "Served as Lead Systems Analyst at the Social Security Administration from 2014 to 2016.",
    evidence:
      "Candidate correction (2026-06-19): Lead Systems Analyst from 2014 to 2016.",
  },
];

const BI_GUARDRAIL = {
  content:
    "SSA BI ATTRIBUTION GUARDRAIL: Tableau/WebFOCUS, agency-wide Business Intelligence implementation, BI strategy/tool selection, and related statistical/data-visualization implementation work belong to the IT Project Manager tenure (2016-2022), not Branch Chief. Do not place those BI implementation bullets under Branch Chief.",
  evidence:
    "Candidate correction (2026-06-19): BI implementation work was IT Project Manager-era work, not Branch Chief work.",
  metadata: {
    company: "Social Security Administration",
    role: "IT Project Manager",
    startDate: "2016",
    endDate: "2022",
    source: "candidate-correction",
    biAttributionGuardrail: "true",
    correctedAt: STAMP,
    tags: ["business intelligence", "tableau", "webfocus", "role-boundary"],
  },
};

const TIMELINE_GUARDRAIL = {
  content:
    "SSA CAREER TIMELINE GUARDRAIL: Area System Coordinator (2011-2013), Systems Analyst (2013-2014), Lead Systems Analyst (2014-2016), IT Project Manager (2016-2022), Branch Chief, Hearings Office IT Oversight (2022-2025). Do not skip the 2013-2016 Systems Analyst / Lead Systems Analyst period.",
  evidence:
    "Candidate correction (2026-06-19): explicit 2013-2016 Systems Analyst and Lead Systems Analyst timeline.",
  metadata: {
    company: "Social Security Administration",
    source: "candidate-correction",
    ssaTimelineGuardrail: "true",
    correctedAt: STAMP,
    tags: ["career timeline", "systems analyst", "lead systems analyst"],
  },
};

async function main() {
  const docs = await db()
    .select()
    .from(kbDocuments)
    .where(inArray(kbDocuments.name, SUSPECT_DOCUMENT_NAMES));
  const docIds = docs.map((doc) => doc.id);

  if (docIds.length > 0) {
    const [chunks, facts] = await Promise.all([
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
        .where(inArray(kbChunks.documentId, docIds)),
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
        .where(inArray(kbFacts.documentId, docIds)),
    ]);

    mkdirSync(".pipeline", { recursive: true });
    const backupPath = `.pipeline/ssa-bi-timeline-correction-backup-${STAMP}.json`;
    writeFileSync(
      backupPath,
      JSON.stringify({ documents: docs, chunks, facts }, null, 2),
    );
    console.log(
      `Backed up ${docs.length} docs, ${chunks.length} chunks, ${facts.length} facts to ${backupPath}`,
    );

    const deletedFacts = await db()
      .delete(kbFacts)
      .where(inArray(kbFacts.documentId, docIds))
      .returning({ id: kbFacts.id });
    await db().delete(kbDocuments).where(inArray(kbDocuments.id, docIds));
    console.log(
      `Deleted ${docs.length} suspect source docs and ${deletedFacts.length} facts derived from them.`,
    );
  } else {
    console.log("No suspect source docs found; delete step skipped.");
  }

  let reframed = 0;
  for (const item of BI_IT_PM_REFRAMES) {
    const [row] = await db()
      .select({
        id: kbFacts.id,
        content: kbFacts.content,
        metadata: kbFacts.metadata,
      })
      .from(kbFacts)
      .where(eq(kbFacts.id, item.id))
      .limit(1);
    if (!row) {
      console.log(`SKIP BI reframe ${item.id} - not found`);
      continue;
    }
    if (
      (row.metadata as Record<string, unknown> | null)
        ?.biAttributionCorrected === "true" &&
      row.content === item.content
    ) {
      console.log(`SKIP BI reframe ${item.id} - already corrected`);
      continue;
    }

    const { embedding } = await embedText(item.content);
    await db()
      .update(kbFacts)
      .set({
        content: item.content,
        evidenceQuote: item.evidence,
        embedding,
        metadata: sql`coalesce(${kbFacts.metadata}, '{}'::jsonb) || ${JSON.stringify({
          company: "Social Security Administration",
          role: "IT Project Manager",
          startDate: "2016",
          endDate: "2022",
          biAttributionCorrected: "true",
          biAttributionCorrectedAt: STAMP,
          contentRaw: row.content,
        })}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(kbFacts.id, item.id));
    reframed++;
    console.log(`REFRAMED BI fact ${item.id}`);
  }

  for (const role of ROLE_FACTS) {
    await upsertRoleFact(role);
  }
  await upsertGuardrail("biAttributionGuardrail", BI_GUARDRAIL);
  await upsertGuardrail("ssaTimelineGuardrail", TIMELINE_GUARDRAIL);

  console.log(`Done. reframed=${reframed} inserted/updated roles=${ROLE_FACTS.length}`);
}

async function upsertRoleFact(role: (typeof ROLE_FACTS)[number]) {
  const [existing] = await db()
    .select({ id: kbFacts.id, content: kbFacts.content })
    .from(kbFacts)
    .where(
      sql`${kbFacts.factType} = 'role'
        AND ${kbFacts.metadata}->>'company' = 'Social Security Administration'
        AND ${kbFacts.metadata}->>'role' = ${role.role}
        AND ${kbFacts.metadata}->>'startDate' = ${role.startDate}
        AND ${kbFacts.metadata}->>'endDate' = ${role.endDate}`,
    )
    .limit(1);

  const { embedding } = await embedText(role.content);
  const values = {
    factType: "role" as const,
    content: role.content,
    evidenceQuote: role.evidence,
    embedding,
    metadata: {
      company: "Social Security Administration",
      role: role.role,
      startDate: role.startDate,
      endDate: role.endDate,
      source: "candidate-correction",
      timelineCorrected: "true",
      correctedAt: STAMP,
      tags: ["career timeline"],
    },
    userAdded: "true",
    updatedAt: new Date(),
  };

  if (existing) {
    await db().update(kbFacts).set(values).where(eq(kbFacts.id, existing.id));
    console.log(`UPDATED role fact ${existing.id}: ${role.role}`);
  } else {
    const [inserted] = await db()
      .insert(kbFacts)
      .values(values)
      .returning({ id: kbFacts.id });
    console.log(`INSERTED role fact ${inserted.id}: ${role.role}`);
  }
}

async function upsertGuardrail(
  flag: "biAttributionGuardrail" | "ssaTimelineGuardrail",
  guardrail: {
    content: string;
    evidence: string;
    metadata: Record<string, unknown>;
  },
) {
  const [existing] = await db()
    .select({ id: kbFacts.id, content: kbFacts.content })
    .from(kbFacts)
    .where(sql`${kbFacts.metadata}->>${flag} = 'true'`)
    .limit(1);
  const { embedding } = await embedText(guardrail.content);
  const values = {
    factType: "context" as const,
    content: guardrail.content,
    evidenceQuote: guardrail.evidence,
    embedding,
    metadata: guardrail.metadata,
    userAdded: "true",
    pinned: "true",
    updatedAt: new Date(),
  };
  if (existing) {
    await db().update(kbFacts).set(values).where(eq(kbFacts.id, existing.id));
    console.log(`UPDATED guardrail ${existing.id}: ${flag}`);
  } else {
    const [inserted] = await db()
      .insert(kbFacts)
      .values(values)
      .returning({ id: kbFacts.id });
    console.log(`INSERTED guardrail ${inserted.id}: ${flag}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
