import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env" });

import { neon } from "@neondatabase/serverless";
import { combineAtsReports } from "@/lib/agents/ats-simulator";
import type { JdAnalysis } from "@/lib/agents/jd-analyzer";

const APP_ID = process.argv[2] ?? "NQP2fHmUoerjbEEvsuXrw";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  const [app] = (await sql`
    SELECT id, jd_analysis, recruiter_screener_result, recruiter_screener_at
    FROM applications WHERE id = ${APP_ID}
  `) as Array<{
    id: string;
    jd_analysis: JdAnalysis;
    recruiter_screener_result: any;
    recruiter_screener_at: string;
  }>;

  const versions = (await sql`
    SELECT id, version_number, iteration, resume_markdown, cover_letter_markdown,
           qc_a_score, qc_b_score, length(resume_markdown) AS resume_len,
           length(cover_letter_markdown) AS cover_len, created_at
    FROM application_versions
    WHERE application_id = ${APP_ID}
    ORDER BY version_number DESC, iteration DESC
    LIMIT 5
  `) as Array<{
    id: string;
    version_number: number;
    iteration: number;
    resume_markdown: string;
    cover_letter_markdown: string;
    qc_a_score: any;
    qc_b_score: any;
    resume_len: number;
    cover_len: number;
    created_at: string;
  }>;

  console.log("\n=== Versions for GDIT ===");
  for (const v of versions) {
    console.log(
      `v${v.version_number}.${v.iteration}  resume=${v.resume_len}c  cover=${v.cover_len}c  A=${v.qc_a_score?.overall ?? "-"} B=${v.qc_b_score?.overall ?? "-"}  ${v.created_at}`,
    );
  }

  const latest = versions[0];
  console.log(`\n=== Latest = v${latest.version_number}.${latest.iteration} ===`);

  console.log("\n--- Reviewer A dimensions ---");
  console.log(JSON.stringify(latest.qc_a_score, null, 2));

  console.log("\n--- Reviewer B dimensions ---");
  console.log(JSON.stringify(latest.qc_b_score, null, 2));

  // Pull the most recent consolidated feedback for the latest version
  const consolidation = (await sql`
    SELECT input, output, started_at
    FROM agent_runs
    WHERE application_id = ${APP_ID}
      AND agent_name = 'qc_consolidator'
    ORDER BY started_at DESC
    LIMIT 1
  `) as Array<{ input: any; output: any; started_at: string }>;

  const items = consolidation[0]?.output?.object?.items ?? consolidation[0]?.output?.items;
  if (items) {
    console.log("\n--- Latest consolidated feedback ---");
    for (const it of items) {
      console.log(
        `  [${it.priority.toUpperCase()}] (${it.doc}${it.location ? ` / ${it.location}` : ""})  ${it.issue}`,
      );
      if (it.suggestion) console.log(`      → ${it.suggestion}`);
    }
  } else {
    console.log("\n(no consolidator run found)");
  }

  // Recruiter sim
  console.log("\n--- Recruiter sim (latest) ---");
  const rs = app.recruiter_screener_result;
  if (rs) {
    console.log(`Advance score: ${rs.advanceScore} (${rs.recommendation})`);
    console.log(`Rationale: ${rs.rationale}`);
    console.log(`Strengths:`);
    for (const s of rs.topStrengths ?? []) console.log(`  + ${s}`);
    console.log(`Concerns:`);
    for (const c of rs.topConcerns ?? []) console.log(`  - ${c}`);
    console.log(`First impression: ${rs.firstImpressionNotes}`);
    console.log(`Internal consistency: ${rs.internalConsistencyNotes}`);
    console.log(`Story coherence: ${rs.storyCoherence}`);
  } else {
    console.log("(no recruiter sim result on application row)");
  }

  // ATS coverage on the latest version
  console.log("\n--- ATS coverage (v3.1) ---");
  const ats = combineAtsReports({
    resumeMarkdown: latest.resume_markdown,
    coverLetterMarkdown: latest.cover_letter_markdown,
    mustHaveSkills: app.jd_analysis.mustHaveSkills,
    niceToHaveSkills: app.jd_analysis.niceToHaveSkills,
    keyLanguagePatterns: app.jd_analysis.keyLanguagePatterns,
    jdRoleTitle: app.jd_analysis.roleTitle,
  });
  console.log(
    `Resume keyword: ${ats.resumeScore}  Cover keyword: ${ats.coverLetterScore}  Blended: ${ats.blendedScore}`,
  );
  console.log(
    `Role title in summary: ${ats.roleTitleCoverage.verdict}  (${ats.roleTitleCoverage.matchedContentWords}/${ats.roleTitleCoverage.totalContentWords} words)`,
  );
  console.log(`Summary snippet: ${(ats.roleTitleCoverage.summarySnippet ?? "").slice(0, 200)}`);
  const missingFromBoth = ats.combined.filter(
    (c) => c.category === "must_have" && c.resume === "missing" && c.coverLetter === "missing",
  );
  if (missingFromBoth.length > 0) {
    console.log(`Missing-from-both must-haves (${missingFromBoth.length}):`);
    for (const m of missingFromBoth) console.log(`  ! ${m.phrase}`);
  } else {
    console.log("No must-haves missing from both docs.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
