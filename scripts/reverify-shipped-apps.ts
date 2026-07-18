import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env", override: true });

import { writeFileSync } from "fs";
import { eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { applications, applicationVersions } from "@/db/schema";
import { verifyDrafts } from "@/lib/agents/verifier";

async function main() {
  const apps = await db()
    .select()
    .from(applications)
    .where(isNotNull(applications.finalVersionId));

  const results: Array<
    | { app: (typeof apps)[number]; skipped: true; reason: string }
    | {
        app: (typeof apps)[number];
        version: typeof applicationVersions.$inferSelect;
        skipped?: false;
        result: Awaited<ReturnType<typeof verifyDrafts>>;
      }
  > = [];

  for (const app of apps) {
    if (!app.finalVersionId) continue;

    const [version] = await db()
      .select()
      .from(applicationVersions)
      .where(eq(applicationVersions.id, app.finalVersionId));

    if (!version?.resumeMarkdown || !app.jdAnalysis) {
      console.log("SKIP:", app.role, "-", "missing resumeMarkdown or jdAnalysis");
      results.push({ app, skipped: true, reason: "missing data" });
      continue;
    }

    console.log("Verifying:", app.role, "at", app.company);
    const result = await verifyDrafts({
      resumeMarkdown: version.resumeMarkdown,
      coverLetterMarkdown: version.coverLetterMarkdown ?? "",
      citedFactIds: [],
      applicationId: app.id,
      applicationVersionId: version.id,
      jdAnalysis: app.jdAnalysis as any,
      jdText: app.jdText,
    });

    results.push({ app, version, result });
    console.log("  recoveryFired:", result.recoveryFired);
    console.log("  factsLoaded:", result.factsLoaded);
    console.log("  passes:", result.output.passes);
    console.log("  issues:", result.output.issuesFound.length);
  }

  let md = "# Reverify Report - 2026-05-19\n\n";
  md += "## Summary Table\n\n";
  md += "| App | Company | RecoveryFired | Facts Loaded | Passes | Issues | Verdict |\n";
  md += "|-----|---------|--------------|--------------|--------|--------|--------|\n";

  let flipped = 0;
  let verified = 0;
  for (const r of results) {
    if (r.skipped) {
      md += `| ${cell(r.app.role)} | ${cell(r.app.company)} | - | - | - | - | SKIPPED |\n`;
      continue;
    }
    verified++;
    const fired = r.result.recoveryFired ?? false;
    const factsLoaded = r.result.factsLoaded ?? 0;
    const passes = r.result.output.passes;
    const issues = r.result.output.issuesFound.length;
    const verdict = fired && factsLoaded > 0 ? "flipped to sensible" : "still mostly unsupported";
    if (fired && factsLoaded > 0) flipped++;
    md += `| ${cell(r.app.role)} | ${cell(r.app.company)} | ${fired} | ${factsLoaded} | ${passes} | ${issues} | ${verdict} |\n`;
  }

  md += `\n## Overall: ${flipped} of ${verified} apps flipped to sensible\n\n`;

  if (flipped < 2) {
    md += "### Note: Fewer than 2 apps flipped - surfacing for QA\n";
    md += "Possible causes: claim-recovery floor 0.55 too conservative, or no matching KB facts for these applications.\n";
    md += "Do not loop back automatically - QA team to decide on next action.\n\n";
  }

  for (const r of results) {
    if (r.skipped) continue;
    md += `## ${r.app.role} - ${r.app.company}\n\n`;
    md += `- Recovery fired: ${r.result.recoveryFired ?? false}\n`;
    md += `- Facts loaded: ${r.result.factsLoaded ?? 0}\n`;
    md += `- Summary: ${r.result.output.summary ?? "no summary"}\n`;
    md += `- Issues found: ${r.result.output.issuesFound.length}\n`;
    if (r.result.output.issuesFound.length > 0) {
      md += "- Sample issues:\n";
      for (const issue of r.result.output.issuesFound.slice(0, 3)) {
        md += `  - [${issue.severity}] ${issue.reason ?? issue.quote ?? "no detail"}\n`;
      }
    }
    md += "\n";
  }

  writeFileSync(".pipeline/devteam_2026-05-19_reverify.md", md, "utf8");
  console.log("Wrote .pipeline/devteam_2026-05-19_reverify.md");
}

function cell(value: string | null | undefined): string {
  return (value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
