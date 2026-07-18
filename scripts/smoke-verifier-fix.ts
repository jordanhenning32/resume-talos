import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env" });

import { neon } from "@neondatabase/serverless";
import { runVerifierFixSuggester } from "@/lib/agents/verifier-fix-suggester";
import type { JdAnalysis } from "@/lib/agents/jd-analyzer";

// Reproduces the user's screenshot case — Azure Gov / FedRAMP fabrication
// flagged on a Starburst (or similar) JD. We pull the latest available app
// that has a verifierIssues row to use as substrate.
async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const [v] = (await sql`
    SELECT av.id, av.application_id, av.resume_markdown,
      av.verifier_issues, a.role, a.company, a.jd_analysis
    FROM application_versions av
    JOIN applications a ON a.id = av.application_id
    WHERE av.verifier_issues IS NOT NULL
      AND jsonb_array_length(av.verifier_issues) > 0
    ORDER BY av.created_at DESC
    LIMIT 1
  `) as Array<{
    id: string;
    application_id: string;
    resume_markdown: string;
    verifier_issues: Array<{ claim: string; reason: string; severity: string }>;
    role: string;
    company: string;
    jd_analysis: any;
  }>;
  if (!v) throw new Error("No version with verifier_issues found in DB.");

  console.log(`=== Latest verifier-flagged version ===`);
  console.log(`App: ${v.role} @ ${v.company}`);
  console.log(`Issues: ${v.verifier_issues.length}\n`);

  for (let i = 0; i < Math.min(v.verifier_issues.length, 2); i++) {
    const issue = v.verifier_issues[i];
    console.log(`\n--- Issue ${i + 1} (${issue.severity}) ---`);
    console.log(`Claim: "${issue.claim.slice(0, 160)}..."`);
    console.log(`Reason: ${issue.reason.slice(0, 200)}...`);
    console.log();

    const t0 = Date.now();
    const result = await runVerifierFixSuggester({
      claim: issue.claim,
      reason: issue.reason,
      jdAnalysis: v.jd_analysis as JdAnalysis,
      resumeMarkdown: v.resume_markdown,
      applicationId: v.application_id,
    });
    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`Suggested in ${sec}s · $${result.costUsd.toFixed(4)} · ${result.factsRetrieved} facts retrieved`);
    console.log(`Root cause: ${result.rootCause}\n`);

    for (let j = 0; j < result.fixes.length; j++) {
      const f = result.fixes[j];
      console.log(`  Fix ${j + 1}: [${f.kind}] ${f.title}  (confidence: ${f.confidence})`);
      console.log(`     ${f.explanation}`);
      if (f.locationHint) console.log(`     In resume: "${f.locationHint.slice(0, 140)}"`);
      if (f.suggestedText) {
        console.log(`     Suggested:`);
        for (const line of f.suggestedText.split("\n").slice(0, 4)) {
          console.log(`       ${line.slice(0, 130)}`);
        }
      }
      console.log();
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
