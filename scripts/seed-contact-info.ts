/**
 * One-shot script: ensure the persisted writer_directives row contains
 * Jordan's contact info (phone + location + email). Merges the new
 * contact block into the existing row without disturbing other fields.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env" });

import {
  DEFAULT_WRITER_DIRECTIVES,
  getWriterDirectives,
  setWriterDirectives,
} from "@/lib/settings";

async function main() {
  const current = await getWriterDirectives();
  const next = {
    ...current,
    contact: {
      phone: "555-555-0100",
      location: "York, PA",
      email: "jordan@jordanhenning.com",
      ...current.contact, // user overrides win if anything's already set
    },
  };
  // But explicitly OVERWRITE phone + location since the user asked for them
  // to be specific values.
  next.contact = {
    ...next.contact,
    phone: "555-555-0100",
    location: "York, PA",
  };
  await setWriterDirectives(next);
  console.log("Saved writer directives. Contact block now:");
  console.log(JSON.stringify(next.contact, null, 2));
  console.log("\n(Code defaults for reference):");
  console.log(JSON.stringify(DEFAULT_WRITER_DIRECTIVES.contact, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
