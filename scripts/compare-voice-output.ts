import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });

import { neon } from "@neondatabase/serverless";
import { writeCoverLetter } from "@/lib/agents/cover-letter-writer";
import { getApplicationById } from "@/lib/applications/create";
import { getMarketResearchById } from "@/lib/applications/market-research";
import { getWriterDirectives } from "@/lib/settings";
import { retrieveVoiceChunks } from "@/lib/agents/retriever";
import type { JdAnalysis } from "@/lib/agents/jd-analyzer";

const APP_ID = "NQP2fHmUoerjbEEvsuXrw";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  // First: prove voice retrieval is finding the seeded doc.
  const probe = await retrieveVoiceChunks({
    query:
      "Federal AI services delivery executive presenting to senior leadership",
    topK: 3,
  });
  console.log(`\n=== Voice retrieval probe ===`);
  console.log(`Found ${probe.chunks.length} voice chunks.`);
  for (const c of probe.chunks) {
    console.log(`  · sim=${c.similarity.toFixed(3)} from "${c.documentName}"`);
    console.log(`    ${c.content.slice(0, 100)}…`);
  }

  // Capture the prior cover letter for diff
  const priorRows = (await sql`
    SELECT cover_letter_markdown
    FROM application_versions
    WHERE application_id = ${APP_ID}
    ORDER BY version_number DESC, iteration DESC
    LIMIT 1
  `) as Array<{ cover_letter_markdown: string }>;
  const priorCover = priorRows[0]?.cover_letter_markdown ?? "";

  // Re-run the cover letter writer with voice mining live
  const app = await getApplicationById(APP_ID);
  if (!app?.jdAnalysis) throw new Error("no analysis");
  if (!app.marketResearchId) throw new Error("no research");
  const research = await getMarketResearchById(app.marketResearchId);
  const directives = await getWriterDirectives();

  console.log(`\n=== Regenerating cover letter with voice mining ===`);
  const t0 = Date.now();
  const r = await writeCoverLetter({
    jdAnalysis: app.jdAnalysis as unknown as JdAnalysis,
    directives,
    research,
    userEditsOnResearch: research?.userEdits ?? null,
    applicationId: APP_ID,
  });
  const t1 = Date.now();
  console.log(`  → $${r.writerCostUsd.toFixed(4)} in ${((t1 - t0) / 1000).toFixed(1)}s\n`);

  console.log("=== Prior cover letter (first 3 sentences) ===");
  console.log(priorCover.split(/(?<=[.!?])\s+/).slice(0, 3).join(" "));
  console.log("\n=== New cover letter (full) ===");
  console.log(r.output.markdown);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
