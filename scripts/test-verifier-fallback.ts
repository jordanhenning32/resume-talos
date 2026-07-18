// INTENTIONAL LLM CALL: tester runs this once to exercise live verifier fallback.
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env", override: true });

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { applications, applicationVersions } from "@/db/schema";
import { verifyDrafts } from "@/lib/agents/verifier";
import type { JdAnalysis } from "@/lib/agents/jd-analyzer";

async function main() {
  const [row] = await db()
    .select({
      appId: applications.id,
      jdText: applications.jdText,
      jdAnalysis: applications.jdAnalysis,
      versionId: applicationVersions.id,
      resumeMarkdown: applicationVersions.resumeMarkdown,
      coverLetterMarkdown: applicationVersions.coverLetterMarkdown,
    })
    .from(applications)
    .innerJoin(applicationVersions, eq(applicationVersions.id, applications.finalVersionId))
    .where(sql`${applications.finalVersionId} IS NOT NULL`)
    .limit(1);

  if (!row || !row.jdAnalysis) {
    throw new Error("No finalized application with JD analysis found.");
  }

  const result = await verifyDrafts({
    resumeMarkdown: row.resumeMarkdown ?? "",
    coverLetterMarkdown: row.coverLetterMarkdown ?? "",
    citedFactIds: [],
    jdAnalysis: row.jdAnalysis as unknown as JdAnalysis,
    jdText: row.jdText,
    applicationId: row.appId,
    applicationVersionId: row.versionId,
  });

  if (!result.recoveryFired) throw new Error("Expected recoveryFired=true.");
  if (result.factsLoaded <= 0) throw new Error("Expected factsLoaded > 0.");
  if (!result.output.summary.includes("Recovery")) {
    throw new Error("Expected summary to mention Recovery.");
  }
  const everythingUnsupported =
    result.output.issuesFound.length > 0 &&
    result.output.issuesFound.every((i) => /no KB fact provided|no facts were cited/i.test(i.reason));
  if (everythingUnsupported) {
    throw new Error("Verifier still returned an everything-unsupported report.");
  }

  console.log(
    `PASS verifier fallback loaded ${result.factsLoaded} facts; issues=${result.output.issuesFound.length}.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
