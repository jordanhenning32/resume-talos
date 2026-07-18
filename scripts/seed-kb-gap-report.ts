import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { applications } from "@/db/schema";
import { detectKbGaps } from "@/lib/agents/kb-gap-detector";
import { getApplicationById } from "@/lib/applications/create";
import type { JdAnalysis } from "@/lib/agents/jd-analyzer";

const APP_ID = "NQP2fHmUoerjbEEvsuXrw";

async function main() {
  const app = await getApplicationById(APP_ID);
  if (!app?.jdAnalysis) throw new Error("no jd analysis");
  const a = app.jdAnalysis as unknown as JdAnalysis;

  console.log("Scanning + persisting KB gap report for GDIT app…");
  const t0 = Date.now();
  const report = await detectKbGaps({
    mustHaveSkills: a.mustHaveSkills,
    niceToHaveSkills: a.niceToHaveSkills,
    context: { roleTitle: a.roleTitle, companyName: a.companyName ?? undefined },
    applicationId: app.id,
  });
  await db()
    .update(applications)
    .set({
      kbGapReport: report,
      kbGapReportAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(applications.id, APP_ID));
  console.log(
    `Persisted in ${((Date.now() - t0) / 1000).toFixed(1)}s — ` +
      `${report.wellCoveredMustHaveCount} solid / ${report.thinMustHaveCount} thin / ${report.missingMustHaveCount} missing`,
  );
}
main().catch((e) => { console.error(e); process.exit(1); });
