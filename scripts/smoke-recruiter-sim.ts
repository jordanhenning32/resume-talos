import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { applications } from "@/db/schema";
import { runRecruiterSimulation } from "@/lib/agents/recruiter-simulator";
import { getApplicationById } from "@/lib/applications/create";
import { getLatestVersion } from "@/lib/applications/drafts";
import type { JdAnalysis } from "@/lib/agents/jd-analyzer";

const APP_ID = "NQP2fHmUoerjbEEvsuXrw";

async function main() {
  const app = await getApplicationById(APP_ID);
  if (!app?.jdAnalysis || !app.jdText) throw new Error("missing JD analysis or text");
  const v = await getLatestVersion(APP_ID);
  if (!v?.resumeMarkdown) throw new Error("no resume markdown");

  console.log("\n=== Recruiter simulation on GDIT v3.0 ===\n");
  const t0 = Date.now();
  const { output, costUsd } = await runRecruiterSimulation({
    jdAnalysis: app.jdAnalysis as unknown as JdAnalysis,
    jdText: app.jdText,
    resumeMarkdown: v.resumeMarkdown,
    coverLetterMarkdown: v.coverLetterMarkdown ?? "",
    applicationId: APP_ID,
    applicationVersionId: v.id,
  });
  const t1 = Date.now();
  console.log(`Cost: $${costUsd.toFixed(4)}  in ${((t1 - t0) / 1000).toFixed(1)}s\n`);
  console.log(`Advance: ${output.advanceScore}/100  Recommendation: ${output.recommendation.toUpperCase()}`);
  console.log(`Rationale: ${output.twoSentenceRationale}\n`);
  console.log("Strengths:");
  for (const s of output.topStrengths) console.log(`  · ${s}`);
  console.log("\nConcerns:");
  for (const s of output.topConcerns) console.log(`  · ${s}`);
  console.log(`\nFirst-impression: ${output.firstImpressionNotes}`);
  console.log(`Consistency:      ${output.internalConsistencyNotes || "(none flagged)"}`);
  console.log(`Story coherence:  ${output.storyCoherence}\n`);

  if (process.env.PERSIST_RECRUITER_SIM === "1") {
    await db()
      .update(applications)
      .set({
        recruiterScreenerResult: { ...output, resumeVersionId: v.id },
        recruiterScreenerAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(applications.id, APP_ID));
    console.log("Persisted to DB.");
  } else {
    console.log("Skipped DB persistence (set PERSIST_RECRUITER_SIM=1 to write the result).");
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
