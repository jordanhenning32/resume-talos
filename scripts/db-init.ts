import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });
import { neon } from "@neondatabase/serverless";

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Configure .env.local first.");
  }

  const sql = neon(process.env.DATABASE_URL);

  console.log("→ Enabling pgvector extension…");
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;

  console.log("✓ pgvector enabled. You can now run:");
  console.log("  pnpm db:push      (sync schema to DB — dev)");
  console.log("  pnpm db:generate  (generate migration SQL)");
  console.log("  pnpm db:migrate   (apply migrations — prod)");
}

main().catch((err) => {
  console.error("✗ db:init failed:", err);
  process.exit(1);
});
