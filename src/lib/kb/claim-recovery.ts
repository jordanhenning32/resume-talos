import { sql } from "drizzle-orm";
import { db } from "@/db";
import { kbFacts } from "@/db/schema";
import { embedTexts } from "@/lib/models/embed";

const SIMILARITY_FLOOR = 0.55;

export type RecoverCitedFactIdsOptions = {
  resumeMarkdown: string;
  coverLetterMarkdown: string;
  inheritedFactIds?: string[];
};

export type RecoverCitedFactIdsResult = {
  recoveredFactIds: string[];
  warnings: string[];
};

function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

function claimSegments(text: string): string[] {
  const candidates: string[] = [];
  const bulletRe = /^\s*[-*\u2022]\s+(.+)$/gm;
  const withoutBullets = text.replace(bulletRe, (_match, bullet: string) => {
    candidates.push(bullet.trim());
    return "\n";
  });

  for (const sentence of withoutBullets
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)) {
    candidates.push(sentence.trim());
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of candidates) {
    const cleaned = c.replace(/\s+/g, " ").trim();
    if (cleaned.length < 15 || cleaned.length > 400) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

export async function recoverCitedFactIds(
  opts: RecoverCitedFactIdsOptions,
): Promise<RecoverCitedFactIdsResult> {
  const inherited = opts.inheritedFactIds ?? [];
  const segments = claimSegments(
    `${opts.resumeMarkdown ?? ""}\n\n${opts.coverLetterMarkdown ?? ""}`,
  );
  const recovered = new Set<string>(inherited.filter(Boolean));

  if (segments.length === 0) {
    return {
      recoveredFactIds: [...recovered],
      warnings: ["Processed 0 claims, recovered 0 IDs"],
    };
  }

  const { embeddings } = await embedTexts(segments);
  let recoveredCount = 0;

  for (const embedding of embeddings) {
    const vec = vectorLiteral(embedding);
    const [row] = await db()
      .select({
        id: kbFacts.id,
        similarity: sql<number>`1 - (${kbFacts.embedding} <=> ${vec}::vector)`,
      })
      .from(kbFacts)
      .where(sql`1 - (${kbFacts.embedding} <=> ${vec}::vector) >= ${SIMILARITY_FLOOR}`)
      .orderBy(sql`${kbFacts.embedding} <=> ${vec}::vector`)
      .limit(1);
    if (row?.id && !recovered.has(row.id)) {
      recovered.add(row.id);
      recoveredCount++;
    }
  }

  return {
    recoveredFactIds: [...recovered],
    warnings: [`Processed ${segments.length} claims, recovered ${recoveredCount} IDs`],
  };
}
