import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env", override: true });

import { neon } from "@neondatabase/serverless";
import { writeResume } from "@/lib/agents/resume-writer";
import { writeCoverLetter } from "@/lib/agents/cover-letter-writer";
import { getApplicationById } from "@/lib/applications/create";
import { getMarketResearchById } from "@/lib/applications/market-research";
import { getWriterDirectives } from "@/lib/settings";
import type { JdAnalysis } from "@/lib/agents/jd-analyzer";

const APP_ID = "NQP2fHmUoerjbEEvsuXrw"; // GDIT

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  console.log(`\n=== Cache validation on application ${APP_ID} ===\n`);

  const app = await getApplicationById(APP_ID);
  if (!app) throw new Error(`Application ${APP_ID} not found.`);
  if (!app.jdAnalysis) throw new Error("Missing JD analysis.");
  if (!app.variant) throw new Error("Missing variant.");
  const jdAnalysis = app.jdAnalysis as unknown as JdAnalysis;
  const directives = await getWriterDirectives();
  const research = app.marketResearchId
    ? await getMarketResearchById(app.marketResearchId)
    : null;

  console.log("Step 1/2 — first call (writes cache)...");
  const t0 = Date.now();
  const r1 = await writeResume({
    variant: app.variant,
    jdAnalysis,
    directives,
    applicationId: APP_ID,
  });
  const t1 = Date.now();
  console.log(`  → resume v1   $${r1.writerCostUsd.toFixed(4)}  in ${((t1 - t0) / 1000).toFixed(1)}s`);

  console.log("\nStep 2/2 — second call within cache TTL (should READ cache)...");
  const t2 = Date.now();
  const r2 = await writeResume({
    variant: app.variant,
    jdAnalysis,
    directives,
    applicationId: APP_ID,
  });
  const t3 = Date.now();
  console.log(`  → resume v2   $${r2.writerCostUsd.toFixed(4)}  in ${((t3 - t2) / 1000).toFixed(1)}s`);

  console.log("\nStep 3 — cover letter, twice (same test)...");
  const c0 = Date.now();
  const cl1 = await writeCoverLetter({
    jdAnalysis,
    directives,
    research,
    userEditsOnResearch: research?.userEdits ?? null,
    applicationId: APP_ID,
  });
  const c1 = Date.now();
  console.log(`  → cover v1   $${cl1.writerCostUsd.toFixed(4)}  in ${((c1 - c0) / 1000).toFixed(1)}s`);
  const c2 = Date.now();
  const cl2 = await writeCoverLetter({
    jdAnalysis,
    directives,
    research,
    userEditsOnResearch: research?.userEdits ?? null,
    applicationId: APP_ID,
  });
  const c3 = Date.now();
  console.log(`  → cover v2   $${cl2.writerCostUsd.toFixed(4)}  in ${((c3 - c2) / 1000).toFixed(1)}s`);

  console.log("\n=== Token + cost breakdown for the 4 writer calls just made ===");
  const rows = (await sql`
    SELECT id, agent_name, model,
      input_tokens, output_tokens, cached_input_tokens,
      cost_usd,
      EXTRACT(EPOCH FROM (completed_at - started_at))::int AS duration_s,
      started_at
    FROM agent_runs
    WHERE id IN (${r1.runId}, ${r2.runId}, ${cl1.runId}, ${cl2.runId})
    ORDER BY started_at ASC
  `) as Array<{
    id: string;
    agent_name: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    cached_input_tokens: number;
    cost_usd: number;
    duration_s: number;
  }>;
  console.table(
    rows.map((r) => ({
      run: r.agent_name,
      in: r.input_tokens,
      cached_in: r.cached_input_tokens,
      "%cached": r.input_tokens
        ? `${Math.round((r.cached_input_tokens / r.input_tokens) * 100)}%`
        : "n/a",
      out: r.output_tokens,
      cost: `$${r.cost_usd.toFixed(4)}`,
      sec: r.duration_s,
    })),
  );

  const resumeFirst = rows.find((r) => r.id === r1.runId);
  const resumeSecond = rows.find((r) => r.id === r2.runId);
  const coverFirst = rows.find((r) => r.id === cl1.runId);
  const coverSecond = rows.find((r) => r.id === cl2.runId);

  console.log("\n=== Cache verdict ===");
  function verdict(label: string, first?: typeof resumeFirst, second?: typeof resumeFirst) {
    if (!first || !second) {
      console.log(`  ${label}: missing rows, can't compare`);
      return;
    }
    const firstHits = first.cached_input_tokens;
    const secondHits = second.cached_input_tokens;
    if (secondHits === 0) {
      console.log(`  ${label}: ❌ second call had 0 cache reads — caching NOT working`);
    } else if (secondHits > firstHits) {
      const savings = (1 - second.cost_usd / first.cost_usd) * 100;
      console.log(
        `  ${label}: ✓ second call read ${secondHits} tokens from cache (${Math.round((secondHits / second.input_tokens) * 100)}% of input). Cost dropped from $${first.cost_usd.toFixed(4)} → $${second.cost_usd.toFixed(4)} (${savings >= 0 ? "−" : "+"}${Math.abs(savings).toFixed(1)}%).`,
      );
    } else {
      console.log(`  ${label}: ⚠ second call had ${secondHits} cache reads, first had ${firstHits} — unexpected`);
    }
  }
  verdict("Resume", resumeFirst, resumeSecond);
  verdict("Cover ", coverFirst, coverSecond);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
