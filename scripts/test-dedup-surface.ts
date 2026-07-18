import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { kbChunks, kbDocuments, kbFacts } from "@/db/schema";
import { ingestDocument } from "@/lib/kb/ingest";
import type { ExtractedFact } from "@/lib/kb/extract";

async function main() {
  const documentIds: string[] = [];
  let message = "PASS";
  let exitCode = 0;
  try {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const factContent = `Led the Resume Talos dedup surface regression ${suffix} with a deterministic fact payload.`;
    const extractedFact: ExtractedFact = {
      type: "achievement",
      content: factContent,
      evidenceQuote: factContent,
      company: "Resume Talos Test",
      role: "Regression Harness",
      tags: ["dedup-test"],
      metrics: [],
    };

    const first = await ingestDocument({
      name: `dedup-surface-a-${suffix}.txt`,
      fileType: "txt",
      buffer: Buffer.from(`${factContent}\nOriginal source wording for the first ingest.`, "utf8"),
      mode: "default",
      extractedFactsOverride: [extractedFact],
    });
    documentIds.push(first.documentId);

    const [existingFact] = await db()
      .select()
      .from(kbFacts)
      .where(eq(kbFacts.documentId, first.documentId))
      .limit(1);
    if (!existingFact) {
      throw new Error("First ingest did not insert the expected baseline fact.");
    }

    const second = await ingestDocument({
      name: `dedup-surface-b-${suffix}.txt`,
      fileType: "txt",
      buffer: Buffer.from(`${factContent}\nNear-duplicate source wording for the second ingest.`, "utf8"),
      mode: "default",
      extractedFactsOverride: [{ ...extractedFact, evidenceQuote: `${factContent}\nNear-duplicate source wording.` }],
    });
    documentIds.push(second.documentId);

    if (!second.skippedFacts || second.skippedFacts.length === 0) {
      throw new Error(`Expected duplicate skippedFacts, got ${JSON.stringify(second.skippedFacts)}`);
    }
    if (second.skippedFacts[0]?.similarTo?.id !== existingFact.id) {
      throw new Error(
        `Expected skipped fact to reference ${existingFact.id}, got ${JSON.stringify(second.skippedFacts[0])}`,
      );
    }
  } catch (err) {
    message = `FAIL: ${err instanceof Error ? err.message : String(err)}`;
    exitCode = 1;
  } finally {
    for (const documentId of documentIds.reverse()) {
      await db().delete(kbFacts).where(eq(kbFacts.documentId, documentId));
      await db().delete(kbChunks).where(eq(kbChunks.documentId, documentId));
      await db().delete(kbDocuments).where(eq(kbDocuments.id, documentId));
    }
    console.log(message);
    process.exit(exitCode);
  }
}

void main();
