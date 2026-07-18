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
    throw new Error("No application version with non-empty citedFactIds found.");
  }

  const inherited = row.citedFactIds ?? [];
  const editedResume = `${row.resumeMarkdown ?? ""}\n\n<!-- manual edit smoke -->`;
  const result = await recoverCitedFactIds({
    resumeMarkdown: editedResume,
    coverLetterMarkdown: row.coverLetterMarkdown ?? "",
    inheritedFactIds: inherited,
  });

  const recovered = new Set(result.recoveredFactIds);
  const missing = inherited.filter((id) => !recovered.has(id));
  if (missing.length > 0) {
    throw new Error(`Manual-edit recovery failed superset check: ${missing.join(", ")}`);
  }

  console.log(
    `PASS manual-edit cite recovery kept ${inherited.length} inherited IDs and returned ${result.recoveredFactIds.length}.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
