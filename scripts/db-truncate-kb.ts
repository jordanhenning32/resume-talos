// One-off script to clear KB tables during schema migration.
// Usage: pnpm tsx scripts/db-truncate-kb.ts
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });
import { neon } from "@neondatabase/serverless";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  const sql = neon(process.env.DATABASE_URL);
  console.log("→ Truncating kb_facts, kb_chunks, kb_documents (cascade)…");
  await sql`TRUNCATE TABLE kb_facts, kb_chunks, kb_documents CASCADE`;
  console.log("✓ done.");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
