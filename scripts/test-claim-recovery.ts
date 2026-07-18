import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env", override: true });

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { applicationVersions } from "@/db/schema";
import { recoverCitedFactIds } from "@/lib/kb/claim-recovery";

async function main() {
  const [row] = await db()
    .select({
      id: applicationVersions.id,
      resumeMarkdown: applicationVersions.resumeMarkdown,
      coverLetterMarkdown: applicationVersions.coverLetterMarkdown,
      citedFactIds: applicationVersions.citedFactIds,
    })
    .from(applicationVersions)
    .where(sql`jsonb_array_length(coalesce(${applicationVersions.citedFactIds}, '[]'::jsonb)) > 0`)
    .limit(1);

  if (!row) {
    throw new Error("No application_versions row with citedFactIds found.");
  }

  const inherited = row.citedFactIds ?? [];
  const result = await recoverCitedFactIds({
    resumeMarkdown: row.resumeMarkdown ?? "",
    coverLetterMarkdown: row.coverLetterMarkdown ?? "",
    inheritedFactIds: inherited,
  });
  const recovered = new Set(result.recoveredFactIds);
  const missing = inherited.filter((id) => !recovered.has(id));
  if (missing.length > 0) {
    throw new Error(`Recovery dropped inherited IDs for ${row.id}: ${missing.join(", ")}`);
  }
  console.log(
    `PASS claim recovery preserved ${inherited.length} inherited IDs and returned ${result.recoveredFactIds.length}.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
