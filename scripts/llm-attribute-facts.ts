/**
 * LLM-assisted attribution backfill for KB facts that lack an employer.
 *
 * Problem: ~57% of kb_facts have no metadata.company, so the writer's
 * attribution rules and the verifier's cross-attribution check have nothing
 * to key off — the model ends up placing unattributed achievements under
 * whichever employer fits the narrative ("jobs getting mixed up"). The
 * deterministic heuristic backfill (scripts/backfill-fact-attribution.ts)
 * can repair 0 of them because the source documents aren't employer-named.
 *
 * This pass groups unattributed facts by source document and asks an LLM —
 * given the full document context + the canonical employer list — to either
 * attribute each fact to one employer (with an evidence quote + confidence),
 * mark it `transferable` (essays / thought-leadership / cross-cutting skills
 * not tied to a single job), or leave it `uncertain`.
 *
 * CONSERVATIVE policy:
 *   - Auto-apply ONLY decision="attributed" + confidence="high" + a company
 *     that matches the canonical employer set, with an evidence quote.
 *   - On --apply, also stamp decision="transferable" facts with
 *     metadata.attribution="transferable" so the writer knows they are
 *     intentionally cross-employer (not merely un-tagged).
 *   - Everything else (uncertain / medium / low / off-list company) is left
 *     untouched and routed to the KB "Attribute fact" UI for manual review.
 *
 * Usage:
 *   pnpm tsx scripts/llm-attribute-facts.ts              # dry-run, report only
 *   pnpm tsx scripts/llm-attribute-facts.ts --apply      # write high-confidence + transferable
 *   pnpm tsx scripts/llm-attribute-facts.ts --limit 5    # only first 5 docs (cheap smoke test)
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env", override: true });

import { appendFileSync, mkdirSync } from "node:fs";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { kbDocuments, kbFacts } from "@/db/schema";
import { callObject } from "@/lib/models/call";
import { getCanonicalCareerTimeline } from "@/lib/kb/career-timeline";

const APPLY = process.argv.includes("--apply");
const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  return i >= 0 ? Number(process.argv[i + 1]) : Infinity;
})();
const REPORT_DIR = ".pipeline";
const REPORT = `${REPORT_DIR}/llm-attribution-report.md`;

// Pinned attribution-rule facts — never touch (content read-only per HANDOFF).
const PINNED = new Set([
  "v1O3hdCcPewlwYJ4N6Zqh",
  "K-kTU3yyhi4hVsyxWwuS7",
]);

// Canonical employer labels. Aliases on the left collapse to the value.
const COMPANY_CANONICAL: Record<string, string> = {
  "social security administration": "Social Security Administration",
  ssa: "Social Security Administration",
  "social security": "Social Security Administration",
  "office of hearings operations": "Social Security Administration",
  "quadratic digital": "Quadratic Digital",
  quadratic: "Quadratic Digital",
  "mtd products": "MTD Products",
  mtd: "MTD Products",
  "u.s. army": "U.S. Army",
  "us army": "U.S. Army",
  army: "U.S. Army",
};

function canonicalCompany(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  return COMPANY_CANONICAL[key] ?? null;
}

const AssignmentsSchema = z.object({
  assignments: z.array(
    z.object({
      factId: z.string(),
      decision: z.enum(["attributed", "transferable", "uncertain"]),
      company: z.string().nullish(),
      role: z.string().nullish(),
      startDate: z.string().nullish(),
      endDate: z.string().nullish(),
      confidence: z.enum(["high", "medium", "low"]),
      evidenceQuote: z.string().nullish(),
      reasoning: z.string().nullish().describe("≤12 words"),
    }),
  ),
});
type Assignment = z.infer<typeof AssignmentsSchema>["assignments"][number];

const SYSTEM = `You are an attribution analyst for a resume knowledge base. Each "fact" was extracted from one of the candidate's source documents. Your job is to decide which employer (if any) each fact belongs to, using ONLY evidence in the provided document.

Decisions:
- "attributed": the document clearly ties this fact to ONE specific employer from the CANONICAL EMPLOYERS list. Provide the exact canonical company string, and role/dates if the document states them. Set confidence "high" ONLY when the document text explicitly anchors the fact to that employer (an evidence quote naming the employer, a dated role heading the fact sits under, or unambiguous context). Otherwise use "medium"/"low".
- "transferable": the fact is a general skill, a piece of thought-leadership, an opinion/essay, an aspirational or hypothetical scenario ("how I would run X"), or a cross-cutting capability NOT tied to a single past job. These must NEVER be attributed to one employer. Aspirational/future-tense essays are ALWAYS transferable.
- "uncertain": the fact plausibly belongs to an employer but the document does not give you enough evidence to be sure.

Hard rules:
- NEVER invent an employer. company MUST be one of the CANONICAL EMPLOYERS strings, copied exactly, or null.
- When in doubt between "attributed" and "uncertain", choose "uncertain". Wrong attribution is worse than no attribution.
- evidenceQuote must be a short verbatim snippet FROM THE DOCUMENT that justifies your decision (for attributed: the text naming/anchoring the employer).
- Return exactly one assignment per fact id provided.`;

type DocGroup = {
  docId: string;
  docName: string;
  rawContent: string;
  facts: Array<{ id: string; factType: string; content: string; evidenceQuote: string | null }>;
};

async function loadGroups(): Promise<DocGroup[]> {
  const facts = await db()
    .select({
      id: kbFacts.id,
      factType: kbFacts.factType,
      content: kbFacts.content,
      evidenceQuote: kbFacts.evidenceQuote,
      documentId: kbFacts.documentId,
    })
    .from(kbFacts)
    .where(sql`${kbFacts.metadata}->>'company' IS NULL`);

  const byDoc = new Map<string, DocGroup["facts"]>();
  for (const f of facts) {
    if (PINNED.has(f.id) || !f.documentId) continue;
    const arr = byDoc.get(f.documentId) ?? [];
    arr.push({ id: f.id, factType: f.factType, content: f.content, evidenceQuote: f.evidenceQuote });
    byDoc.set(f.documentId, arr);
  }

  const groups: DocGroup[] = [];
  for (const [docId, docFacts] of byDoc) {
    const [doc] = await db().select().from(kbDocuments).where(eq(kbDocuments.id, docId)).limit(1);
    if (!doc) continue;
    groups.push({
      docId,
      docName: doc.name,
      rawContent: doc.rawContent,
      facts: docFacts,
    });
  }
  // Largest groups first so a --limit smoke test hits the highest-value docs.
  return groups.sort((a, b) => b.facts.length - a.facts.length);
}

const FACTS_PER_CALL = 12;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buildPrompt(group: DocGroup, facts: DocGroup["facts"], canonicalEmployers: string): string {
  const factLines = facts
    .map(
      (f) =>
        `- factId: ${f.id}\n  type: ${f.factType}\n  content: ${f.content}\n  evidenceQuote: ${f.evidenceQuote ?? "(none)"}`,
    )
    .join("\n");
  const docText = group.rawContent.slice(0, 14000);
  return `CANONICAL EMPLOYERS (use these exact strings for company):
${canonicalEmployers}

SOURCE DOCUMENT: "${group.docName}"
--- BEGIN DOCUMENT ---
${docText}
--- END DOCUMENT ---

FACTS TO ATTRIBUTE (${facts.length}):
${factLines}

Return one assignment per factId above.`;
}

async function main() {
  mkdirSync(REPORT_DIR, { recursive: true });
  const timeline = await getCanonicalCareerTimeline();
  const canonicalEmployers = [
    ...new Set([
      "Social Security Administration",
      "Quadratic Digital",
      "MTD Products",
      "U.S. Army",
      ...timeline.map((r) => r.company),
    ]),
  ]
    .map((c) => `- ${c}`)
    .join("\n");

  const timelineHint = timeline
    .map((r) => `  ${r.company} | ${r.role} | ${r.displayDate}`)
    .join("\n");

  const allGroups = await loadGroups();
  const groups = allGroups.slice(0, LIMIT === Infinity ? allGroups.length : LIMIT);
  const totalFacts = groups.reduce((n, g) => n + g.facts.length, 0);
  console.log(
    `Mode: ${APPLY ? "APPLY" : "DRY-RUN"} | docs: ${groups.length}/${allGroups.length} | unattributed facts in scope: ${totalFacts}`,
  );

  const tally = { attributed: 0, transferable: 0, uncertain: 0, applied: 0, markedTransferable: 0, offList: 0 };
  const rows: string[] = [];
  let costUsd = 0;

  for (const group of groups) {
    const assignments: Assignment[] = [];
    for (const batch of chunk(group.facts, FACTS_PER_CALL)) {
      try {
        const result = await callObject<z.infer<typeof AssignmentsSchema>>({
          role: "verifier",
          agentName: "attribution-backfill",
          schema: AssignmentsSchema,
          temperature: 0,
          maxOutputTokens: 8000,
          system: SYSTEM,
          prompt: `${buildPrompt(group, batch, canonicalEmployers)}\n\nCANONICAL CAREER TIMELINE (for role/date reference):\n${timelineHint}`,
        });
        assignments.push(...result.object.assignments);
        costUsd += result.costUsd;
      } catch (err) {
        console.error(`  ! ${group.docName} (batch): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const byId = new Map(assignments.map((a) => [a.factId, a]));
    for (const fact of group.facts) {
      const a = byId.get(fact.id);
      if (!a) {
        rows.push(`| ${fact.id} | ${fact.factType} | (no response) | | | ${truncate(group.docName)} |`);
        continue;
      }
      tally[a.decision]++;

      const canonical = canonicalCompany(a.company);
      const isApplicable =
        a.decision === "attributed" && a.confidence === "high" && !!canonical && !!a.evidenceQuote;
      const offList = a.decision === "attributed" && a.confidence === "high" && a.company && !canonical;
      if (offList) tally.offList++;

      let action = "review";
      if (a.decision === "attributed") {
        action = isApplicable ? "APPLY" : offList ? "off-list→review" : `${a.confidence}→review`;
      } else if (a.decision === "transferable") {
        action = "mark transferable";
      }

      if (APPLY && isApplicable && canonical) {
        const patch: Record<string, string> = {
          company: canonical,
          attributionSource: "llm-backfill",
          attributionConfidence: "high",
        };
        if (a.role) patch.role = a.role;
        if (a.startDate) patch.startDate = a.startDate;
        if (a.endDate) patch.endDate = a.endDate;
        await db()
          .update(kbFacts)
          .set({ metadata: sql`${kbFacts.metadata} || ${JSON.stringify(patch)}::jsonb`, updatedAt: new Date() })
          .where(sql`${kbFacts.id} = ${fact.id} AND ${kbFacts.metadata}->>'company' IS NULL`);
        tally.applied++;
      } else if (APPLY && a.decision === "transferable") {
        const patch = { attribution: "transferable", attributionSource: "llm-backfill" };
        await db()
          .update(kbFacts)
          .set({ metadata: sql`${kbFacts.metadata} || ${JSON.stringify(patch)}::jsonb`, updatedAt: new Date() })
          .where(sql`${kbFacts.id} = ${fact.id} AND ${kbFacts.metadata}->>'company' IS NULL`);
        tally.markedTransferable++;
      }

      rows.push(
        `| ${fact.id} | ${fact.factType} | ${a.decision}/${a.confidence} | ${canonical ?? a.company ?? ""} | ${action} | ${truncate(a.reasoning ?? "")} |`,
      );
    }
    console.log(`  ✓ ${group.docName} (${group.facts.length} facts)`);
  }

  console.log("\n=== SUMMARY ===");
  console.log(tally);
  console.log(`LLM cost: $${costUsd.toFixed(4)}`);
  if (!APPLY) console.log("DRY-RUN — no DB writes. Re-run with --apply to write high-confidence + transferable.");

  appendFileSync(
    REPORT,
    [
      "",
      `## ${APPLY ? "APPLY" : "DRY-RUN"} — ${new Date().toISOString()}`,
      "",
      `Docs processed: ${groups.length}/${allGroups.length} · facts in scope: ${totalFacts} · LLM cost: $${costUsd.toFixed(4)}`,
      `attributed: ${tally.attributed} · transferable: ${tally.transferable} · uncertain: ${tally.uncertain} · off-list: ${tally.offList}`,
      `applied(company): ${tally.applied} · marked transferable: ${tally.markedTransferable}`,
      "",
      "| fact_id | type | decision/conf | company | action | reasoning |",
      "| --- | --- | --- | --- | --- | --- |",
      ...rows,
      "",
    ].join("\n"),
  );
  console.log(`\nReport: ${REPORT}`);
}

function truncate(s: string, n = 90): string {
  const clean = s.replace(/\|/g, "/").replace(/\n/g, " ");
  return clean.length > n ? `${clean.slice(0, n)}…` : clean;
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
