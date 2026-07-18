/**
 * Semantic-similarity defense against AI-powered ATS.
 *
 * Modern AI screeners (Eightfold, ModernHire, HireVue Assessments, etc.) use
 * embedding similarity between the resume text and the JD text as their
 * dominant signal — not keyword counts. This module computes that signal
 * deterministically so the user can see how the embedding layer scores
 * their drafts alongside the literal-keyword layer.
 *
 * Pipeline:
 *   1. Embed JD + resume + cover letter in one batched call (~50ms).
 *   2. Compute cosine similarity per doc against the JD.
 *   3. Calibrate raw similarity → 0-100 score so the dashboard reads
 *      consistently with the keyword score.
 *
 * Cost: one OpenAI embedMany call for 3 texts. At text-embedding-3-large
 * pricing (~$0.13 / M tokens), a typical resume + cover + JD (~5K tokens
 * combined) costs ~$0.0006. Per page load on every render.
 */

import { embedTexts } from "@/lib/models/embed";

/**
 * Calibration anchors for converting raw cosine similarity to a 0-100 score.
 * Empirically for resume↔JD pairs with text-embedding-3-large 1536-dim:
 *   - sim ≤ 0.30: unrelated docs (random comparison floor)
 *   - sim ≈ 0.50: typical loose paraphrase
 *   - sim ≈ 0.65: tightly aligned resume targeting the JD
 *   - sim ≥ 0.75: near-clone (rewritten directly from JD text)
 *
 * Linear-clamp from SIM_MIN→0, SIM_MAX→100. Gives meaningful headroom in
 * the 50-85 band where most resume-JD pairs naturally fall.
 */
const SIM_MIN = 0.3;
const SIM_MAX = 0.75;
const EMBEDDING_CHUNK_CHAR_LIMIT = 12_000;
const EMBEDDING_CHUNK_WORD_LIMIT = 5_500;

type Chunk = {
  docIndex: number;
  text: string;
  weight: number;
};

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `cosine: embedding length mismatch (${a.length} vs ${b.length})`,
    );
  }
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 0;
  return dot / denom;
}

function simToScore(sim: number): number {
  const ratio = (sim - SIM_MIN) / (SIM_MAX - SIM_MIN);
  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function isWithinEmbeddingLimit(value: string): boolean {
  return (
    value.length <= EMBEDDING_CHUNK_CHAR_LIMIT &&
    wordCount(value) <= EMBEDDING_CHUNK_WORD_LIMIT
  );
}

function chunkDocument(value: string): Array<{ text: string; weight: number }> {
  const cleaned = value.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];
  if (isWithinEmbeddingLimit(cleaned)) {
    return [{ text: cleaned, weight: cleaned.length }];
  }

  const chunks: Array<{ text: string; weight: number }> = [];
  let current = "";

  function pushCurrent() {
    const trimmed = current.trim();
    if (trimmed) {
      chunks.push({ text: trimmed, weight: trimmed.length });
    }
    current = "";
  }

  for (const paragraph of cleaned.split(/\n{2,}/)) {
    const block = paragraph.trim();
    if (!block) continue;

    if (!isWithinEmbeddingLimit(block)) {
      pushCurrent();
      for (const piece of splitLongBlock(block)) {
        chunks.push({ text: piece, weight: piece.length });
      }
      continue;
    }

    const next = current ? `${current}\n\n${block}` : block;
    if (isWithinEmbeddingLimit(next)) {
      current = next;
    } else {
      pushCurrent();
      current = block;
    }
  }

  pushCurrent();
  return chunks;
}

function splitLongBlock(value: string): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const chunks: string[] = [];
  let current: string[] = [];
  let currentChars = 0;

  function pushCurrent() {
    if (current.length > 0) {
      chunks.push(current.join(" "));
    }
    current = [];
    currentChars = 0;
  }

  for (const word of words) {
    if (
      current.length > 0 &&
      (current.length + 1 > EMBEDDING_CHUNK_WORD_LIMIT ||
        currentChars + word.length + 1 > EMBEDDING_CHUNK_CHAR_LIMIT)
    ) {
      pushCurrent();
    }

    if (word.length > EMBEDDING_CHUNK_CHAR_LIMIT) {
      pushCurrent();
      for (let i = 0; i < word.length; i += EMBEDDING_CHUNK_CHAR_LIMIT) {
        chunks.push(word.slice(i, i + EMBEDDING_CHUNK_CHAR_LIMIT));
      }
      continue;
    }

    current.push(word);
    currentChars += word.length + 1;
  }

  pushCurrent();
  return chunks;
}

function centroid(
  embeddings: number[][],
  chunks: Array<{ weight: number }>,
): number[] {
  if (embeddings.length === 0) return [];
  const dimensions = embeddings[0].length;
  const out = Array.from({ length: dimensions }, () => 0);
  const totalWeight = chunks.reduce((sum, chunk) => sum + chunk.weight, 0) || 1;

  for (let i = 0; i < embeddings.length; i++) {
    const weight = chunks[i].weight / totalWeight;
    for (let j = 0; j < dimensions; j++) {
      out[j] += embeddings[i][j] * weight;
    }
  }

  return out;
}

async function embedDocumentCentroids(
  values: string[],
): Promise<{ embeddings: number[][]; costUsd: number }> {
  const chunks: Chunk[] = [];
  const chunksByDoc = values.map((value, docIndex) => {
    const docChunks = chunkDocument(value).map((chunk) => ({
      ...chunk,
      docIndex,
    }));
    chunks.push(...docChunks);
    return docChunks;
  });

  if (chunks.length === 0) {
    return { embeddings: [], costUsd: 0 };
  }

  const { embeddings: chunkEmbeddings, costUsd } = await embedTexts(
    chunks.map((chunk) => chunk.text),
  );

  let offset = 0;
  const documentEmbeddings = chunksByDoc.map((docChunks) => {
    const docEmbeddings = chunkEmbeddings.slice(offset, offset + docChunks.length);
    offset += docChunks.length;
    return centroid(docEmbeddings, docChunks);
  });

  return { embeddings: documentEmbeddings, costUsd };
}

export type ScreeningSimilarity = {
  /** Raw cosine similarity between JD and resume (0-1). */
  resumeSim: number;
  /** Raw cosine similarity between JD and cover letter (0-1) or null if no cover. */
  coverLetterSim: number | null;
  /** Calibrated 0-100 score for resume↔JD. */
  resumeScore: number;
  /** Calibrated 0-100 score for cover↔JD (null if no cover). */
  coverLetterScore: number | null;
  /**
   * Blended 0-100 score using the same 70/30 resume/cover weighting as the
   * keyword scan, so the two metrics read on the same axis. Null when no
   * cover letter is supplied.
   */
  blendedScore: number | null;
  embedCostUsd: number;
};

export async function computeScreeningSimilarity(opts: {
  jdText: string;
  resumeMarkdown: string;
  coverLetterMarkdown?: string | null;
}): Promise<ScreeningSimilarity> {
  if (!opts.jdText.trim() || !opts.resumeMarkdown.trim()) {
    return {
      resumeSim: 0,
      coverLetterSim: null,
      resumeScore: 0,
      coverLetterScore: null,
      blendedScore: null,
      embedCostUsd: 0,
    };
  }

  const hasCover = !!opts.coverLetterMarkdown && opts.coverLetterMarkdown.trim().length > 0;
  const inputs = [opts.jdText, opts.resumeMarkdown];
  if (hasCover) inputs.push(opts.coverLetterMarkdown!);

  const { embeddings, costUsd } = await embedDocumentCentroids(inputs);
  const [jd, resume, cover] = embeddings;

  const resumeSim = cosine(jd, resume);
  const resumeScore = simToScore(resumeSim);
  const coverLetterSim = hasCover ? cosine(jd, cover) : null;
  const coverLetterScore = coverLetterSim != null ? simToScore(coverLetterSim) : null;
  const blendedScore =
    coverLetterScore != null
      ? Math.round(0.7 * resumeScore + 0.3 * coverLetterScore)
      : null;

  return {
    resumeSim,
    coverLetterSim,
    resumeScore,
    coverLetterScore,
    blendedScore,
    embedCostUsd: costUsd,
  };
}
