import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Configure .env.local first.");
  }
  const sql = neon(process.env.DATABASE_URL);
  const db = drizzle(sql);
  console.log("→ Running migrations…");
  await migrate(db, { migrationsFolder: "./src/db/migrations" });
  console.log("✓ migrations applied.");
}

main().catch((err) => {
  console.error("✗ migration failed:", err);
  process.exit(1);
});
