import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env", override: true });

import { appendFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { kbChunks, kbDocuments, kbFacts } from "@/db/schema";
import { detectResumeSections, isPlausibleSection, type SectionContext } from "@/lib/kb/section-detect";

const REPORT = ".pipeline/devteam_2026-05-19_backfill-report.md";
const APPLY = process.argv.includes("--apply");
const PINNED = new Set([
  "v1O3hdCcPewlwYJ4N6Zqh",
  "K-kTU3yyhi4hVsyxWwuS7",
]);

async function main() {
  const facts = await db()
    .select()
    .from(kbFacts)
    .where(sql`${kbFacts.metadata}->>'company' IS NULL`);

  const proposals: Array<{ id: string; factType: string; company: string; role?: string; reason: string }> = [];
  const skipped: Array<{
    id: string;
    factType: string;
    company?: string;
    role?: string;
    reason: string;
  }> = [];
  for (const fact of facts) {
    if (PINNED.has(fact.id) || !fact.documentId) continue;
    const [doc] = await db().select().from(kbDocuments).where(eq(kbDocuments.id, fact.documentId)).limit(1);
    if (!doc) continue;

    const metadata = (fact.metadata ?? {}) as { chunkId?: string };
    let chunk: typeof kbChunks.$inferSelect | undefined;
    if (metadata.chunkId) {
      [chunk] = await db().select().from(kbChunks).where(eq(kbChunks.id, metadata.chunkId)).limit(1);
    }

    const sections = detectResumeSections(doc.rawContent).filter(isPlausibleSection);
    const section = chunk ? sectionForChunk(sections, chunk.metadata) : undefined;
    const heuristic = section
      ? { ...section, reason: "section", sourceLine: sourceLineForSection(doc.rawContent, section) }
      : companyFromDocName(doc.name)
        ? { ...companyFromDocName(doc.name)!, reason: "doc-name", sourceLine: doc.name }
        : undefined;
    if (!heuristic) {
      skipped.push({
        id: fact.id,
        factType: fact.factType,
        reason: "no safe company heuristic",
      });
      continue;
    }
    if (!hasCompanyEvidence(heuristic.company, doc.name, heuristic.sourceLine)) {
      skipped.push({
        id: fact.id,
        factType: fact.factType,
        company: heuristic.company,
        role: heuristic.role,
        reason: `${heuristic.reason} missing company evidence in doc.name/source line`,
      });
      continue;
    }

    proposals.push({
      id: fact.id,
      factType: fact.factType,
      company: heuristic.company,
      role: heuristic.role,
      reason: heuristic.reason,
    });

    if (APPLY) {
      const patch = {
        company: heuristic.company,
        ...(heuristic.role ? { role: heuristic.role } : {}),
        ...(heuristic.startDate ? { startDate: heuristic.startDate } : {}),
        ...(heuristic.endDate ? { endDate: heuristic.endDate } : {}),
      };
      await db()
        .update(kbFacts)
        .set({
          metadata: sql`${kbFacts.metadata} || ${JSON.stringify(patch)}::jsonb`,
          updatedAt: new Date(),
        })
        .where(sql`${kbFacts.id} = ${fact.id} AND ${kbFacts.metadata}->>'company' IS NULL`);
    }
  }

  console.table(proposals);
  console.table(skipped);
  appendFileSync(
    REPORT,
    [
      "",
      `## Backfill ${APPLY ? "APPLY" : "DRY-RUN"} - ${new Date().toISOString()}`,
      "",
      `Proposed updates: ${proposals.length}`,
      `Skipped facts: ${skipped.length}`,
      "",
      "| fact_id | fact_type | company | role | reason |",
      "| --- | --- | --- | --- | --- |",
      ...proposals.map((p) => `| ${p.id} | ${p.factType} | ${p.company} | ${p.role ?? ""} | ${p.reason} |`),
      "",
      "| skipped_fact_id | fact_type | proposed_company | proposed_role | reason |",
      "| --- | --- | --- | --- | --- |",
      ...skipped.map((s) => `| ${s.id} | ${s.factType} | ${s.company ?? ""} | ${s.role ?? ""} | ${s.reason} |`),
      "",
    ].join("\n"),
  );
}

function sectionForChunk(
  sections: SectionContext[],
  metadata: Record<string, unknown> | null,
): SectionContext | undefined {
  const charStart = typeof metadata?.charStart === "number" ? metadata.charStart : null;
  const charEnd = typeof metadata?.charEnd === "number" ? metadata.charEnd : null;
  if (charStart === null || charEnd === null) return undefined;
  const midpoint = charStart + (charEnd - charStart) / 2;
  return sections.find((s) => midpoint >= s.charStart && midpoint < s.charEnd);
}

function companyFromDocName(name: string): SectionContext | undefined {
  const n = name.toLowerCase();
  if (n.includes("ssa") || n.includes("social security")) return stub("Social Security Administration");
  if (n.includes("quadratic")) return stub("Quadratic Digital");
  if (n.includes("mtd")) return stub("MTD Products");
  if (n.includes("army")) return stub("US Army");
  return undefined;
}

function sourceLineForSection(rawContent: string, section: SectionContext): string {
  const start = Math.max(0, Math.min(rawContent.length, section.charStart));
  const lineStart = rawContent.lastIndexOf("\n", start - 1) + 1;
  const nextNewline = rawContent.indexOf("\n", start);
  const lineEnd = nextNewline === -1 ? rawContent.length : nextNewline;
  return rawContent.slice(lineStart, lineEnd).trim();
}

function hasCompanyEvidence(company: string, docName: string, sourceLine?: string): boolean {
  return includesFolded(docName, company) || (sourceLine ? includesFolded(sourceLine, company) : false);
}

function includesFolded(haystack: string, needle: string): boolean {
  return haystack.toLocaleLowerCase().includes(needle.toLocaleLowerCase());
}

function stub(company: string): SectionContext {
  return { company, charStart: 0, charEnd: Number.MAX_SAFE_INTEGER };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
