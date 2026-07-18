import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { seedDefaultsIfMissing } from "@/lib/settings";

async function main() {
  await seedDefaultsIfMissing();
  console.log("✓ Settings defaults seeded (or already present).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
