import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env" });

import { neon } from "@neondatabase/serverless";
import { runKnockoutScan } from "@/lib/agents/knockout-detector";
import type { JdAnalysis } from "@/lib/agents/jd-analyzer";

const APP_IDS = process.argv.slice(2);
const DEFAULT_APPS = ["NQP2fHmUoerjbEEvsuXrw", "8HtHRdZa7g8W2K0cu9tnD"]; // GDIT + CMS

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const targets = APP_IDS.length > 0 ? APP_IDS : DEFAULT_APPS;

  for (const appId of targets) {
    const [app] = (await sql`
      SELECT a.id, a.role, a.company, a.jd_text, a.jd_analysis
      FROM applications a WHERE a.id = ${appId}
    `) as Array<{
      id: string;
      role: string;
      company: string;
      jd_text: string;
      jd_analysis: any;
    }>;
    if (!app) {
      console.log(`(skipped ${appId} — not found)`);
      continue;
    }
    const [version] = (await sql`
      SELECT id, resume_markdown
      FROM application_versions
      WHERE application_id = ${appId}
      ORDER BY version_number DESC, iteration DESC
      LIMIT 1
    `) as Array<{ id: string; resume_markdown: string | null }>;

    console.log(`\n========== ${app.role} @ ${app.company} ==========`);
    console.log(`Resume: ${version?.resume_markdown ? `v=${version.id} (${version.resume_markdown.length}c)` : "none yet"}`);

    const t0 = Date.now();
    const report = await runKnockoutScan({
      jdText: app.jd_text,
      jdAnalysis: app.jd_analysis as JdAnalysis,
      resumeMarkdown: version?.resume_markdown ?? null,
      resumeVersionId: version?.id ?? null,
      applicationId: app.id,
    });
    const sec = ((Date.now() - t0) / 1000).toFixed(1);

    console.log(`\nDetected ${report.knockouts.length} knockout(s)  (${sec}s, $${report.costUsd.toFixed(4)})`);
    console.log(`  verified: ${report.verifiedCount}  partial: ${report.partialCount}  missing: ${report.missingCount}  blocking: ${report.blockingCount}  cannot_determine: ${report.cannotDetermineCount}`);

    for (const k of report.knockouts) {
      const badge = {
        verified: "✓",
        partial: "~",
        missing: "✗",
        blocking: "‼",
        cannot_determine: "?",
      }[k.coverage.verdict];
      console.log(`\n  ${badge} [${k.category}] ${k.requirement}`);
      console.log(`     JD: "${k.jdEvidenceQuote.slice(0, 140)}"`);
      console.log(`     Verdict: ${k.coverage.verdict}`);
      if (k.coverage.resumeSnippet) {
        console.log(`     Resume: "${k.coverage.resumeSnippet.slice(0, 120)}"`);
      }
      if (k.coverage.notes) {
        console.log(`     Notes: ${k.coverage.notes}`);
      }
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
