import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  INTERNAL_ERROR_MESSAGE,
  internalServerErrorResponse,
} from "@/lib/api/errors";
import {
  providerCallTimeoutMs,
  providerTimeoutMessage,
} from "@/lib/models/timeout";
import { repairGeneratedObjectJsonText } from "@/lib/models/call";
import { isVersionBoundReportFresh } from "@/lib/applications/versioning";
import {
  marketResearchFromBrief,
  parseMarketResearchText,
} from "@/lib/agents/market-research";
import { atsReportToFeedbackItems } from "@/lib/agents/ats-simulator";
import { normalizeGeneratedResumeMarkdown } from "@/lib/agents/resume-writer";
import { normalizeGeneratedCoverLetterMarkdown } from "@/lib/agents/cover-letter-writer";

async function main() {
  await assertMigrationHistory();
  await assertNeonHttpCompatibility();
  assertMarketResearchRepair();
  assertMarketResearchMarkdownFallback();
  assertReportFreshness();
  await assertClassicExportStaysClassic();
  await assertPageOverflowDoesNotBlockExport();
  await assertApiRedaction();
  assertProviderTimeouts();
  assertStructuredObjectRepair();
  assertUnsupportedAtsPlatformsNotForced();
  assertResumeMarkdownNormalization();
  assertCoverLetterMarkdownNormalization();
  console.log("test-hardening-guards: ok");
}

async function assertMigrationHistory() {
  const migrationsDir = path.join(process.cwd(), "src", "db", "migrations");
  const files = await readdir(migrationsDir);
  const sqlFiles = files.filter((file) => file.endsWith(".sql"));
  assert.ok(sqlFiles.length > 0, "expected at least one SQL migration");

  const journal = await readFile(
    path.join(migrationsDir, "meta", "_journal.json"),
    "utf8",
  );
  assert.match(journal, /"entries"/, "expected Drizzle journal entries");

  const sql = await readFile(path.join(migrationsDir, sqlFiles[0]), "utf8");
  assert.match(sql, /CREATE EXTENSION IF NOT EXISTS vector/i);
  assert.match(sql, /kb_documents_content_hash_unique/);
  assert.match(sql, /application_versions_app_version_iteration_unique/);
  assert.match(sql, /kb_facts_document_idx/);
}

async function assertNeonHttpCompatibility() {
  const files = [
    path.join(process.cwd(), "src", "lib", "kb", "ingest.ts"),
    path.join(process.cwd(), "src", "lib", "applications", "versioning.ts"),
  ];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.equal(
      source.includes(".transaction("),
      false,
      `${path.basename(file)} must stay compatible with drizzle neon-http`,
    );
  }
}

function assertMarketResearchRepair() {
  const repaired = parseMarketResearchText(
    `\`\`\`json
{
  "findings": {
    "overview": "The Defense Logistics Agency (DLA) is the Department of Defense combat logistics support agency.",
    "mission": "Deliver readiness and global logistics support.",
    "leadership": [
      "Army Lt. Gen. Mark T. Simerly: Director"
    ],
    "products_services": "Supply chain management; acquisition; storage and distribution",
    "recent_news": [
      { "headline": "DLA highlights warfighter readiness", "uri": "https://www.dla.mil/" }
    ],
  },
  "tone_profile": {
    "formality": "0.9",
    "technical_density": "0.7",
    "mission_emphasis": "high",
    "energy_level": "medium"
  },
  "sources": [
    { "uri": "https://www.dla.mil/", "name": "Defense Logistics Agency" }
  ]
}
\`\`\``,
    "Defense Logistics Agency",
  );
  assert.ok(repaired, "expected DLA market research JSON to repair");
  assert.equal(repaired.findings.productsServices?.length, 3);
  assert.equal(repaired.toneProfile.missionEmphasis, "high");
  assert.equal(repaired.sources?.[0]?.url, "https://www.dla.mil/");
}

function assertMarketResearchMarkdownFallback() {
  const structured = marketResearchFromBrief(
    `## Overview
The Defense Logistics Agency (DLA) is the Department of Defense combat logistics support agency.

## Mission
Deliver readiness and global logistics support.

## Values
- Integrity
- Accountability

## Recent news (last ~12 months)
- May 2026: DLA highlighted warfighter readiness. https://www.dla.mil/

## Products and services
- Supply chain management
- Acquisition
- Storage and distribution

## Notable leadership
- Army Lt. Gen. Mark T. Simerly: Director

## Cover letter tone notes
Formality: 0.9
Technical density: 0.7
Mission emphasis: high
Energy level: medium
Use a direct, public-sector logistics tone.

## Sources
- [Defense Logistics Agency](https://www.dla.mil/)`,
    "Defense Logistics Agency",
  );

  assert.match(structured.findings.overview, /Defense Logistics Agency/);
  assert.equal(structured.findings.productsServices?.length, 3);
  assert.equal(structured.toneProfile.formality, 0.9);
  assert.equal(structured.toneProfile.missionEmphasis, "high");
  assert.equal(structured.sources?.[0]?.url, "https://www.dla.mil/");
}

function assertReportFreshness() {
  assert.equal(
    isVersionBoundReportFresh({ resumeVersionId: "v1" }, "v1"),
    true,
  );
  assert.equal(
    isVersionBoundReportFresh({ resumeVersionId: "v1" }, "v2"),
    false,
  );
  assert.equal(
    isVersionBoundReportFresh({ resumeVersionId: null }, null),
    true,
  );
  assert.equal(isVersionBoundReportFresh(null, "v1"), false);
}

async function assertClassicExportStaysClassic() {
  const source = await readFile(
    path.join(process.cwd(), "src", "lib", "applications", "export.ts"),
    "utf8",
  );
  assert.match(
    source,
    /if \(requestedLayout === "classic"\) \{[\s\S]*?return \[\];[\s\S]*?\}/,
    "classic export must not auto-switch to another layout",
  );
}

async function assertPageOverflowDoesNotBlockExport() {
  const source = await readFile(
    path.join(process.cwd(), "src", "lib", "export", "parseability.ts"),
    "utf8",
  );
  const brokenBranch = source.match(
    /else if \(([\s\S]*?)\) \{\s*verdict = "broken";/,
  )?.[1] ?? "";
  assert.equal(
    brokenBranch.includes('kind === "page_overflow"'),
    false,
    "page overflow should warn, not mark PDF parseability broken",
  );
}

async function assertApiRedaction() {
  const originalError = console.error;
  console.error = () => {};
  try {
    const response = internalServerErrorResponse(
      "test",
      new Error("SECRET_DO_NOT_LEAK"),
    );
    assert.equal(response.status, 500);
    const body = (await response.json()) as { error: string; errorId: string };
    assert.equal(body.error, INTERNAL_ERROR_MESSAGE);
    assert.match(body.errorId, /^[\w-]{10}$/);
    assert.equal(JSON.stringify(body).includes("SECRET_DO_NOT_LEAK"), false);
  } finally {
    console.error = originalError;
  }
}

function assertProviderTimeouts() {
  assert.equal(providerCallTimeoutMs("2500"), 2500);
  assert.equal(providerCallTimeoutMs("0"), 120_000);
  assert.equal(providerCallTimeoutMs("not-a-number"), 120_000);
  assert.equal(
    providerTimeoutMessage(2500),
    "Provider call timed out after 2500ms.",
  );
}

function assertStructuredObjectRepair() {
  const citedFactIds = Array.from({ length: 90 }, (_, index) => `fact-${index}`);
  const repaired = repairGeneratedObjectJsonText(`\`\`\`json
{
  "markdown": "## Summary\\nA usable resume draft with enough words to test repair.",
  "citedFactIds": ${JSON.stringify(citedFactIds)},
  "variantTargetWords": "842 words",
  "notes": {"why": "object note"},
}
\`\`\``);
  assert.ok(repaired, "expected structured writer output to repair");
  const parsed = JSON.parse(repaired);
  assert.equal(parsed.citedFactIds.length, 80);
  assert.equal(parsed.variantTargetWords, 842);
  assert.equal(typeof parsed.notes, "string");
}

function assertUnsupportedAtsPlatformsNotForced() {
  const items = atsReportToFeedbackItems({
    mustHave: [
      {
        phrase: "NG911, CAD, RMS, COP, MNS, and OT software/hardware",
        verdict: "missing",
        matchedContentWords: 0,
        totalContentWords: 7,
        matchSnippet: null,
      },
      {
        phrase: "Track and assess IT and OT software/hardware development",
        verdict: "partial",
        matchedContentWords: 3,
        totalContentWords: 7,
        matchSnippet: "IT development",
      },
    ],
    niceToHave: [],
    keyLanguagePatterns: [],
    verbatimCount: 0,
    partialCount: 0,
    missingCount: 1,
    overallScore: 0,
  });
  assert.equal(
    items.length,
    0,
    "ATS feedback must not force unsupported target-platform acronyms",
  );
}

function assertResumeMarkdownNormalization() {
  const normalized = normalizeGeneratedResumeMarkdown(
    "Tableau and WebFocus\nPublic Trust Clearance — High Risk Tier (held 2008–2025 during SSA tenure; reinstatement-eligible)\nTracking and assessing standard metrics for IT and OT software/hardware development across teams.\nLed a 12-person HQ team including 2 team leads and four Agile teams.\nApplied COTR-style oversight to Quadratic work.",
  );
  assert.match(normalized, /WebFOCUS/);
  assert.match(normalized, /previously held 2008-2025; reinstatement-eligible/);
  assert.doesNotMatch(normalized, /\(held 2008/);
  assert.doesNotMatch(normalized, /IT and OT software\/hardware/i);
  assert.match(normalized, /standard IT delivery metrics/);
  assert.match(normalized, /2 team leads \+ 10 staff across four Agile teams/);
  assert.doesNotMatch(normalized, /COTR-style/);
  assert.match(normalized, /FAC-P\/PM-IT/);
  assert.match(normalized, /Federal Acquisition Certification/);
  assert.match(normalized, /\blapsed\b/);

  const certNormalized = normalizeGeneratedResumeMarkdown(
    "## Certifications\n- FAC-P/PM",
  );
  assert.match(certNormalized, /FAC-P\/PM-IT/);
  assert.equal(certNormalized.match(/FAC-P\/PM-IT/g)?.length, 1);
}

function assertCoverLetterMarkdownNormalization() {
  const normalized = normalizeGeneratedCoverLetterMarkdown(
    "This role matches my GS-13/GS-14 equivalent specialized experience.",
  );
  assert.match(normalized, /GS-13 equivalent specialized experience/);
  assert.doesNotMatch(normalized, /GS-13\/GS-14/);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
