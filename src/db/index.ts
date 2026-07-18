import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { env } from "@/lib/env";
import * as schema from "./schema";

let cachedDb: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function db() {
  if (cachedDb) return cachedDb;
  const sql = neon(env().DATABASE_URL);
  cachedDb = drizzle(sql, { schema, casing: "snake_case" });
  return cachedDb;
}

export { schema };
