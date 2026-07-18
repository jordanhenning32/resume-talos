import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { neon } from "@neondatabase/serverless";
import { db } from "@/db";
import { applications, applicationVersions, agentRuns } from "@/db/schema";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  // Create a throwaway application + version + qc review + agent run
  const appId = nanoid();
  console.log(`Creating throwaway application ${appId}...`);
  await db().insert(applications).values({
    id: appId,
    role: "SMOKE TEST — DELETE ME",
    roleSlug: `smoke-role-${appId}`,
    company: "SMOKE TEST",
    companySlug: `smoke-test-${appId}`,
    jdText: "smoke test jd",
    status: "draft",
  });

  const [version] = await db()
    .insert(applicationVersions)
    .values({
      applicationId: appId,
      versionNumber: 1,
      iteration: 0,
      resumeMarkdown: "smoke test resume",
      coverLetterMarkdown: "smoke test cover",
    })
    .returning({ id: applicationVersions.id });

  await db().insert(agentRuns).values({
    applicationId: appId,
    applicationVersionId: version.id,
    agentName: "smoke_test",
    provider: "anthropic",
    model: "claude-haiku-4-5",
    status: "completed",
  });

  // Confirm everything's there
  const before = {
    app: (await sql`SELECT id FROM applications WHERE id = ${appId}` as Array<{ id: string }>).length,
    versions: (await sql`SELECT id FROM application_versions WHERE application_id = ${appId}` as Array<{ id: string }>).length,
    runs: (await sql`SELECT id FROM agent_runs WHERE application_id = ${appId}` as Array<{ id: string }>).length,
  };
  console.log("Before delete:", before);

  // Now delete via the same path the server action uses
  console.log("Deleting...");
  await db().delete(applications).where(eq(applications.id, appId));

  const after = {
    app: (await sql`SELECT id FROM applications WHERE id = ${appId}` as Array<{ id: string }>).length,
    versions: (await sql`SELECT id FROM application_versions WHERE application_id = ${appId}` as Array<{ id: string }>).length,
    runs: (await sql`SELECT id FROM agent_runs WHERE application_id = ${appId}` as Array<{ id: string }>).length,
  };
  console.log("After delete:", after);

  const ok = after.app === 0 && after.versions === 0 && after.runs === 0;
  console.log(`\n${ok ? "PASS" : "FAIL"} — cascade cleaned ${before.versions} version(s), ${before.runs} agent run(s)`);
  if (!ok) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
