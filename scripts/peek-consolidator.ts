import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env" });
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const versionId = process.argv[2] ?? "aQQFlUuAS2sq0mzPjb3oB"; // v3.1
  const rows = await sql`
    SELECT id, output
    FROM agent_runs
    WHERE agent_name = 'qc_consolidator'
      AND application_version_id = ${versionId}
    ORDER BY started_at DESC
    LIMIT 1
  ` as Array<{ id: string; output: any }>;
  if (rows.length === 0) {
    console.log("No consolidator run for version", versionId);
    return;
  }
  console.log("Run id:", rows[0].id);
  console.log("Output top-level keys:", Object.keys(rows[0].output ?? {}));
  console.log("Output:");
  console.log(JSON.stringify(rows[0].output, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
