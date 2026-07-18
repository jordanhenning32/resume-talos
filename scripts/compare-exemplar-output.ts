import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env", override: true });

import { neon } from "@neondatabase/serverless";
import { generateDraftsForApplication } from "@/lib/applications/drafts";
import { runVerifierForApplication } from "@/lib/applications/export";

const APP_ID = "NQP2fHmUoerjbEEvsuXrw"; // GDIT VP

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  console.log(`\n=== Regenerate GDIT drafts with exemplar prompts + verify ===\n`);

  // Capture the prior latest version for direct comparison
  const priorRows = (await sql`
    SELECT version_number, iteration, resume_markdown, cover_letter_markdown,
      jsonb_array_length(coalesce(cited_fact_ids, '[]'::jsonb)) AS cited_count
    FROM application_versions
    WHERE application_id = ${APP_ID}
    ORDER BY version_number DESC, iteration DESC
    LIMIT 1
  `) as Array<{
    version_number: number;
    iteration: number;
    resume_markdown: string;
    cover_letter_markdown: string;
    cited_count: number;
  }>;
  const prior = priorRows[0];

  console.log("Step 1 — generating fresh drafts...");
  const t0 = Date.now();
  const draft = await generateDraftsForApplication(APP_ID);
  const t1 = Date.now();
  console.log(
    `  → v${draft.version.versionNumber}.${draft.version.iteration}  ` +
      `resume facts=${draft.factsUsedResume}, cover facts=${draft.factsUsedCoverLetter}  ` +
      `$${draft.costUsd.toFixed(4)}  in ${((t1 - t0) / 1000).toFixed(1)}s`,
  );

  console.log("\nStep 2 — verifier...");
  const ver = await runVerifierForApplication(APP_ID);
  console.log(
    `  → passed=${ver.passed}  critical=${ver.criticalCount}  warning=${ver.warningCount}  $${ver.costUsd.toFixed(4)}`,
  );

  // Pull the new draft
  const newRows = (await sql`
    SELECT resume_markdown, cover_letter_markdown,
      jsonb_array_length(coalesce(cited_fact_ids, '[]'::jsonb)) AS cited_count
    FROM application_versions
    WHERE id = ${draft.version.id}
  `) as Array<{ resume_markdown: string; cover_letter_markdown: string; cited_count: number }>;
  const next = newRows[0];

  console.log("\n=== Quantitative texture diff ===");

  function bulletStats(md: string) {
    const lines = md.split("\n");
    const bullets = lines.filter((l) => /^\s*-\s+/.test(l));
    const totalLen = bullets.reduce((s, b) => s + b.length, 0);
    const avg = bullets.length > 0 ? totalLen / bullets.length : 0;
    const startsWithVerb = bullets.filter((b) =>
      /^\s*-\s+(Owned|Drove|Built|Led|Cut|Grew|Shipped|Architected|Designed|Delivered|Launched|Migrated|Refactored|Implemented|Negotiated|Mentored|Stood up|Re-engineered|Authored|Established|Managed|Reduced|Increased|Saved|Generated|Recovered|Scaled|Expanded|Eliminated)/.test(b),
    ).length;
    const withNumber = bullets.filter((b) => /\d/.test(b)).length;
    const withDollar = bullets.filter((b) => /\$|%|million|billion|MM|M\b/i.test(b)).length;
    return {
      bulletCount: bullets.length,
      avgBulletLen: Math.round(avg),
      startsWithStrongVerb: startsWithVerb,
      verbPct: bullets.length > 0 ? Math.round((startsWithVerb / bullets.length) * 100) : 0,
      withNumber,
      withDollarOrPct: withDollar,
    };
  }

  function wordCount(md: string) {
    return md.split(/\s+/).filter((w) => w.length > 0).length;
  }

  if (prior) {
    console.log("\n  RESUME:");
    console.log("    prior:", bulletStats(prior.resume_markdown), `wc=${wordCount(prior.resume_markdown)}, cited=${prior.cited_count}`);
    console.log("    next :", bulletStats(next.resume_markdown), `wc=${wordCount(next.resume_markdown)}, cited=${next.cited_count}`);
    console.log("\n  COVER:");
    console.log("    prior:", `wc=${wordCount(prior.cover_letter_markdown)}, paragraphs=${prior.cover_letter_markdown.split(/\n\s*\n/).length}`);
    console.log("    next :", `wc=${wordCount(next.cover_letter_markdown)}, paragraphs=${next.cover_letter_markdown.split(/\n\s*\n/).length}`);
  }

  console.log("\n=== Anti-leakage check (exemplar content must NOT appear in output) ===");
  const exemplarLeakage = [
    "Sentari",
    "Velora",
    "Calloway",
    "Subramanian",
    "Helix Bio",
    "Genzyme",
    "ScyllaDB",
    "Plaid",
    "biotech",
    "manufacturing operations",
  ];
  const combined = `${next.resume_markdown}\n${next.cover_letter_markdown}`;
  for (const term of exemplarLeakage) {
    const hits = combined.toLowerCase().includes(term.toLowerCase());
    console.log(`  ${hits ? "❌ LEAKED " : "✓ absent  "} ${term}`);
  }

  console.log("\n=== First 6 resume bullets (texture sample) ===\n");
  const bullets = next.resume_markdown.split("\n").filter((l) => /^\s*-\s+/.test(l)).slice(0, 6);
  for (const b of bullets) console.log(b);

  console.log("\n=== Cover letter opening (3 sentences) ===\n");
  console.log(next.cover_letter_markdown.split(/(?<=[.!?])\s+/).slice(0, 3).join(" "));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
