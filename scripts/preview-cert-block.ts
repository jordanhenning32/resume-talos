import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });

import { findCertsForJd, renderCertReferenceBlock } from "@/lib/agents/cert-acronyms";
import { getApplicationById } from "@/lib/applications/create";
import type { JdAnalysis } from "@/lib/agents/jd-analyzer";

async function main() {
  const app = await getApplicationById("NQP2fHmUoerjbEEvsuXrw");
  if (!app?.jdAnalysis) throw new Error("no analysis");
  const a = app.jdAnalysis as unknown as JdAnalysis;

  const certs = findCertsForJd({
    mustHaveSkills: a.mustHaveSkills,
    niceToHaveSkills: a.niceToHaveSkills,
    keyLanguagePatterns: a.keyLanguagePatterns,
    responsibilities: a.responsibilities,
    successSignals: a.successSignals,
    oneSentenceSummary: a.oneSentenceSummary,
    roleTitle: a.roleTitle,
  });

  console.log(`\n=== Detected ${certs.length} certs in the GDIT JD ===\n`);
  for (const c of certs) {
    console.log(`  ${c.category.padEnd(10)} ${c.acronym} → ${c.expansion}`);
  }

  console.log("\n=== Rendered CERT REFERENCE block (verbatim what writer sees) ===\n");
  console.log(renderCertReferenceBlock(certs));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
