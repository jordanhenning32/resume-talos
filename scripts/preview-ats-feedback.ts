import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });

import { neon } from "@neondatabase/serverless";
import {
  atsReportToFeedbackItems,
  combineAtsReports,
} from "@/lib/agents/ats-simulator";
import { getApplicationById } from "@/lib/applications/create";
import type { JdAnalysis } from "@/lib/agents/jd-analyzer";

const APP_ID = "NQP2fHmUoerjbEEvsuXrw";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    SELECT resume_markdown, version_number, iteration
    FROM application_versions
    WHERE application_id = ${APP_ID}
    ORDER BY version_number DESC, iteration DESC
    LIMIT 1
  `) as Array<{ resume_markdown: string; version_number: number; iteration: number }>;
  const v = rows[0];
  if (!v) throw new Error("no version");
  const app = await getApplicationById(APP_ID);
  if (!app?.jdAnalysis) throw new Error("no jd analysis");
  const a = app.jdAnalysis as unknown as JdAnalysis;

  const cl = (await sql`
    SELECT cover_letter_markdown FROM application_versions
    WHERE application_id = ${APP_ID}
    ORDER BY version_number DESC, iteration DESC
    LIMIT 1
  `) as Array<{ cover_letter_markdown: string }>;
  const combined = combineAtsReports({
    resumeMarkdown: v.resume_markdown,
    coverLetterMarkdown: cl[0]?.cover_letter_markdown ?? "",
    mustHaveSkills: a.mustHaveSkills,
    niceToHaveSkills: a.niceToHaveSkills,
    keyLanguagePatterns: a.keyLanguagePatterns,
  });
  const resumeItems = atsReportToFeedbackItems(combined.resume, "resume", {
    combined: combined.combined,
  });
  const coverItems = atsReportToFeedbackItems(combined.coverLetter, "cover_letter", {
    combined: combined.combined,
  });
  const items = [...resumeItems, ...coverItems];

  console.log(
    `\n=== ATS feedback items the QC loop will append to the next writer revision ===\n`,
  );
  console.log(`Source: GDIT v${v.version_number}.${v.iteration}`);
  console.log(
    `Scores: resume=${combined.resumeScore}/100  cover=${combined.coverLetterScore}/100  blended=${combined.blendedScore}/100`,
  );
  console.log(`Missing-from-both must-haves: ${combined.missingFromBothCount}\n`);
  console.log(
    `Items: ${items.length} (${items.filter((i) => i.priority === "high").length} high, ${items.filter((i) => i.priority === "medium").length} medium, ${items.filter((i) => i.priority === "low").length} low)\n`,
  );

  for (const it of items) {
    console.log(`[${it.priority.toUpperCase().padEnd(6)}] (${it.doc.padEnd(13)}) ${it.issue}`);
    console.log(`         → ${it.suggestion.slice(0, 260)}\n`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
