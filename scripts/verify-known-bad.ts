import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });

import { neon } from "@neondatabase/serverless";
import { verifyDrafts } from "@/lib/agents/verifier";
import { getApplicationById } from "@/lib/applications/create";
import { getMarketResearchById } from "@/lib/applications/market-research";
import type { JdAnalysis } from "@/lib/agents/jd-analyzer";

const APP_ID = "NQP2fHmUoerjbEEvsuXrw";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    SELECT id, resume_markdown, cover_letter_markdown, cited_fact_ids
    FROM application_versions
    WHERE application_id = ${APP_ID}
      AND version_number = 1 AND iteration = 2
    LIMIT 1
  `) as Array<{
    id: string;
    resume_markdown: string;
    cover_letter_markdown: string;
    cited_fact_ids: string[];
  }>;
  const v = rows[0];
  if (!v) throw new Error("v1.2 not found");

  const app = await getApplicationById(APP_ID);
  if (!app) throw new Error("no app");
  const research = app.marketResearchId
    ? await getMarketResearchById(app.marketResearchId)
    : null;

  console.log("\n=== Re-verifying GDIT v1.2 (known-bad with JD-parrots) ===\n");
  const result = await verifyDrafts({
    resumeMarkdown: v.resume_markdown,
    coverLetterMarkdown: v.cover_letter_markdown,
    citedFactIds: v.cited_fact_ids,
    jdAnalysis: app.jdAnalysis as unknown as JdAnalysis,
    jdText: app.jdText,
    marketResearch: research,
    applicationId: APP_ID,
    applicationVersionId: v.id,
  });

  const crit = result.output.issuesFound.filter((i) => i.severity === "critical");
  const warn = result.output.issuesFound.filter((i) => i.severity === "warning");
  console.log(`passed=${result.output.passes}  critical=${crit.length}  warning=${warn.length}  $${result.costUsd.toFixed(4)}`);
  console.log(`summary: ${result.output.summary}\n`);
  for (const i of result.output.issuesFound) {
    console.log(`[${i.severity}] "${i.quote.slice(0, 140)}"`);
    console.log(`   → ${i.reason.slice(0, 320)}\n`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
