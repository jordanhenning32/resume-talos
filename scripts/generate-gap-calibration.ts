import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env", override: true });

import { writeFileSync } from "fs";
import { desc, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { applications, kbFacts } from "@/db/schema";

const OUT = ".pipeline/devteam_2026-05-19_gap-detector-calibration.md";

async function main() {
  const apps = await db()
    .select({
      id: applications.id,
      company: applications.company,
      role: applications.role,
      createdAt: applications.createdAt,
      kbGapReport: applications.kbGapReport,
    })
    .from(applications)
    .where(isNotNull(applications.kbGapReport))
    .orderBy(desc(applications.createdAt))
    .limit(5);

  const factCounts = await db()
    .select({
      factType: kbFacts.factType,
      count: sql<number>`count(*)::int`,
    })
    .from(kbFacts)
    .groupBy(kbFacts.factType)
    .orderBy(kbFacts.factType);

  const lines: string[] = [
    "# Gap Detector Calibration - 2026-05-19",
    "",
    "Known threshold values: `SIMILARITY_THRESHOLD=0.5`, `WELL_COVERED_MIN_COUNT=3`.",
    "",
    "Note: query expansion skipped in calibration mode to avoid LLM cost.",
    "",
    "## KB Size By Fact Type",
    "",
    "| Fact type | Count |",
    "|---|---:|",
  ];

  for (const row of factCounts) {
    lines.push(`| ${row.factType} | ${row.count} |`);
  }

  lines.push("", "## Per-App Must-Have Verdict Counts", "");

  if (apps.length === 0) {
    lines.push("No applications currently have `kbGapReport` populated.");
    lines.push("");
    lines.push("Recommendation: run gap detection for recent applications first, then re-run this calibration script.");
  } else {
    lines.push("| App | Company | Created | Well covered | Thin | Missing |");
    lines.push("|---|---|---|---:|---:|---:|");
    let totalWell = 0;
    let totalThin = 0;
    let totalMissing = 0;
    for (const app of apps) {
      const report = app.kbGapReport as
        | { mustHave?: Array<{ verdict?: "well_covered" | "thin" | "missing" }> }
        | null;
      const counts = { well_covered: 0, thin: 0, missing: 0 };
      for (const item of report?.mustHave ?? []) {
        if (item.verdict && item.verdict in counts) counts[item.verdict]++;
      }
      totalWell += counts.well_covered;
      totalThin += counts.thin;
      totalMissing += counts.missing;
      lines.push(
        `| ${escapeCell(app.role)} | ${escapeCell(app.company)} | ${app.createdAt.toISOString().slice(0, 10)} | ${counts.well_covered} | ${counts.thin} | ${counts.missing} |`,
      );
    }
    lines.push("");
    lines.push("## Recommendation");
    lines.push("");
    if (totalMissing > totalWell + totalThin) {
      lines.push("Retune if many missing verdicts persist after reviewing the underlying skills and KB facts.");
    } else {
      lines.push("Hold at 0.5 if most skills are well_covered or thin; retune if many missing verdicts appear in later samples.");
    }
    lines.push("");
    lines.push(`Sample totals: well_covered=${totalWell}, thin=${totalThin}, missing=${totalMissing}.`);
  }

  writeFileSync(OUT, `${lines.join("\n")}\n`, "utf8");
  console.log(`Wrote ${OUT}`);
}

function escapeCell(value: string | null | undefined): string {
  return (value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
