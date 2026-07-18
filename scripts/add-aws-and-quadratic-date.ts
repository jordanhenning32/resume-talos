/**
 * Two candidate-confirmed updates (2026-06-18):
 *  1. Add the AWS Certified AI Practitioner certification to the KB (pinned).
 *  2. Set the Quadratic Digital CGO role start date to April 2025 (was "2025").
 *
 * Idempotent: AWS insert skips if already present; date update is a no-op once set.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env", override: true });

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { kbFacts } from "@/db/schema";
import { embedText } from "@/lib/models/embed";

const AWS_CONTENT =
  "AWS Certified AI Practitioner — Amazon Web Services certification (2025) covering AI/ML and generative-AI concepts, AWS AI services, and responsible-AI practices.";

// Quadratic CGO role facts whose start date should read April 2025.
const QUADRATIC_ROLE_FACT_IDS = [
  "tL56dYLyyp3HM7ksLbUT0",
  "4q9kgNMmI0yrA-Wjmu0BW",
];

async function main() {
  // 1. AWS cert — insert once.
  const existing = (await db()
    .select({ id: kbFacts.id })
    .from(kbFacts)
    .where(sql`${kbFacts.content} ILIKE '%AWS Certified AI Practitioner%'`)
    .limit(1)) as Array<{ id: string }>;
  if (existing.length > 0) {
    console.log(`SKIP AWS cert — already present (${existing[0].id})`);
  } else {
    const { embedding } = await embedText(AWS_CONTENT);
    const [ins] = await db()
      .insert(kbFacts)
      .values({
        factType: "certification",
        content: AWS_CONTENT,
        evidenceQuote: "Candidate-confirmed 2026-06-18.",
        embedding,
        userAdded: "true",
        pinned: "true",
        metadata: {
          certification: "AWS Certified AI Practitioner",
          issuer: "Amazon Web Services",
          year: "2025",
          source: "candidate-confirmed",
          addedAt: "2026-06-18",
        },
      })
      .returning({ id: kbFacts.id });
    console.log(`ADDED AWS cert fact ${ins.id}`);
  }

  // 2. Quadratic CGO start date -> April 2025.
  for (const id of QUADRATIC_ROLE_FACT_IDS) {
    const [row] = await db()
      .select({ metadata: kbFacts.metadata })
      .from(kbFacts)
      .where(eq(kbFacts.id, id))
      .limit(1);
    if (!row) {
      console.log(`SKIP date ${id} — not found`);
      continue;
    }
    const cur = (row.metadata as Record<string, unknown> | null)?.startDate;
    if (cur === "2025-04") {
      console.log(`SKIP date ${id} — already 2025-04`);
      continue;
    }
    await db()
      .update(kbFacts)
      .set({
        metadata: sql`${kbFacts.metadata} || ${JSON.stringify({
          startDate: "2025-04",
          startDateRaw: cur ?? null,
          dateCorrectedAt: "2026-06-18",
        })}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(kbFacts.id, id));
    console.log(`SET ${id} startDate -> 2025-04 (was ${String(cur)})`);
  }

  console.log("\nDone.");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
