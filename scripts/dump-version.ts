import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`
    SELECT resume_markdown, cover_letter_markdown
    FROM application_versions
    ORDER BY created_at DESC
    LIMIT 1
  ` as Array<{ resume_markdown: string; cover_letter_markdown: string }>;
  if (rows.length === 0) {
    console.log("No versions found");
    return;
  }
  console.log("\n========== RESUME ==========\n");
  console.log(rows[0].resume_markdown);
  console.log("\n\n========== COVER LETTER ==========\n");
  console.log(rows[0].cover_letter_markdown);
}
main().catch((e) => { console.error(e); process.exit(1); });
