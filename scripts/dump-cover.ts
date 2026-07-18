import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    SELECT version_number, iteration, cover_letter_markdown
    FROM application_versions
    WHERE application_id = 'NQP2fHmUoerjbEEvsuXrw'
    ORDER BY version_number DESC, iteration DESC
    LIMIT 1
  `) as Array<{ version_number: number; iteration: number; cover_letter_markdown: string }>;
  const row = rows[0];
  console.log(`--- v${row.version_number}.${row.iteration} cover letter ---\n`);
  console.log(row.cover_letter_markdown);
  console.log("\n--- Search for known market-research-only terms ---");
  const probes = ["CMS OneGov", "OneGov", "VIA", "VIA investment", "GTRI", "Velocity AI"];
  for (const p of probes) {
    const found = row.cover_letter_markdown.toLowerCase().includes(p.toLowerCase());
    console.log(`  ${found ? "FOUND " : "absent"}  ${p}`);
  }
}
main().catch(console.error);
