/**
 * Candidate-confirmed update (2026-07-10):
 * Add the lapsed FAC-P/PM-IT credential to the KB and pin it so every
 * resume writer/export pass has grounding for the Certifications section.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env", override: true });

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { kbFacts } from "@/db/schema";
import { embedText } from "@/lib/models/embed";
import {
  MANDATORY_FAC_PPM_IT_CERTIFICATION,
  MANDATORY_FAC_PPM_IT_FACT_ID,
} from "@/lib/export/mandatory-resume-content";

const FAC_PPM_IT_CONTENT =
  `Jordan Henning previously held ${MANDATORY_FAC_PPM_IT_CERTIFICATION}; list it as lapsed or previously held, not active.`;

async function main() {
  const existing = await db()
    .select({ id: kbFacts.id })
    .from(kbFacts)
    .where(eq(kbFacts.id, MANDATORY_FAC_PPM_IT_FACT_ID))
    .limit(1);

  if (existing.length > 0) {
    await db()
      .update(kbFacts)
      .set({
        factType: "certification",
        content: FAC_PPM_IT_CONTENT,
        evidenceQuote:
          "Candidate-confirmed 2026-07-10: lapsed FAC-P/PM-IT certification should be listed on resumes.",
        userAdded: "true",
        pinned: "true",
        metadata: {
          certification: "FAC-P/PM-IT",
          expansion:
            "Federal Acquisition Certification for Program and Project Managers - Information Technology",
          status: "lapsed",
          source: "candidate-confirmed",
          addedAt: "2026-07-10",
          mandatoryResumeCredential: true,
        },
        updatedAt: new Date(),
      })
      .where(eq(kbFacts.id, MANDATORY_FAC_PPM_IT_FACT_ID));
    console.log(`UPDATED FAC-P/PM-IT cert fact ${MANDATORY_FAC_PPM_IT_FACT_ID}`);
    return;
  }

  const { embedding } = await embedText(FAC_PPM_IT_CONTENT);
  await db()
    .insert(kbFacts)
    .values({
      id: MANDATORY_FAC_PPM_IT_FACT_ID,
      factType: "certification",
      content: FAC_PPM_IT_CONTENT,
      evidenceQuote:
        "Candidate-confirmed 2026-07-10: lapsed FAC-P/PM-IT certification should be listed on resumes.",
      embedding,
      userAdded: "true",
      pinned: "true",
      metadata: {
        certification: "FAC-P/PM-IT",
        expansion:
          "Federal Acquisition Certification for Program and Project Managers - Information Technology",
        status: "lapsed",
        source: "candidate-confirmed",
        addedAt: "2026-07-10",
        mandatoryResumeCredential: true,
      },
    });
  console.log(`ADDED FAC-P/PM-IT cert fact ${MANDATORY_FAC_PPM_IT_FACT_ID}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
