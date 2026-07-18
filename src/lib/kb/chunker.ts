export type Chunk = {
  index: number;
  content: string;
  charStart: number;
  charEnd: number;
};

export type ChunkerOptions = {
  /** Target chunk size in characters. Default 1500 (~375 tokens). */
  targetSize?: number;
  /** Maximum chunk size before forced split. Default 2200. */
  maxSize?: number;
  /** Overlap between chunks in characters. Default 200. */
  overlap?: number;
  /** Minimum chunk size — smaller fragments are merged into the next chunk. Default 150. */
  minSize?: number;
};

const DEFAULTS: Required<ChunkerOptions> = {
  targetSize: 1500,
  maxSize: 2200,
  overlap: 200,
  minSize: 150,
};

/**
 * Paragraph-aware text chunker. Splits the document on blank lines first,
 * accumulating paragraphs into chunks up to `targetSize`. If a single
 * paragraph exceeds `maxSize`, it is hard-split on sentence boundaries.
 * Adjacent chunks overlap by `overlap` characters so that a fact spanning
 * a chunk boundary still gets retrieved.
 */
export function chunkText(text: string, opts: ChunkerOptions = {}): Chunk[] {
  const { targetSize, maxSize, overlap, minSize } = { ...DEFAULTS, ...opts };

  if (text.length <= targetSize) {
    return text.trim().length === 0
      ? []
      : [{ index: 0, content: text.trim(), charStart: 0, charEnd: text.length }];
  }

  const paragraphs = splitOnBlankLines(text);
  const chunks: Chunk[] = [];

  let current = "";
  let currentStart = 0;
  let cursor = 0;

  const push = () => {
    const trimmed = current.trim();
    if (trimmed.length === 0) return;
    chunks.push({
      index: chunks.length,
      content: trimmed,
      charStart: currentStart,
      charEnd: currentStart + current.length,
    });
  };

  for (const para of paragraphs) {
    const paraText = para.text;
    const paraStart = para.start;

    // Find where in the source text the cursor is.
    cursor = paraStart;

    if (paraText.length > maxSize) {
      // First push whatever is already accumulated.
      if (current.length > 0) {
        push();
        current = "";
      }
      // Hard-split the oversized paragraph on sentence boundaries.
      for (const piece of splitOversizedParagraph(paraText, maxSize)) {
        chunks.push({
          index: chunks.length,
          content: piece.text.trim(),
          charStart: paraStart + piece.offset,
          charEnd: paraStart + piece.offset + piece.text.length,
        });
      }
      currentStart = paraStart + paraText.length;
      continue;
    }

    if (current.length === 0) {
      current = paraText;
      currentStart = paraStart;
      continue;
    }

    const projected = current.length + 2 + paraText.length;
    if (projected > targetSize) {
      push();
      // Start the next chunk with overlap from the end of the previous chunk.
      const tail = current.slice(Math.max(0, current.length - overlap));
      current = `${tail}\n\n${paraText}`;
      currentStart = cursor - tail.length;
    } else {
      current = `${current}\n\n${paraText}`;
    }
  }

  // Flush remainder.
  if (current.length > 0) {
    if (current.trim().length < minSize && chunks.length > 0) {
      // Merge a tiny tail back into the previous chunk.
      const last = chunks[chunks.length - 1];
      last.content = `${last.content}\n\n${current.trim()}`;
      last.charEnd = currentStart + current.length;
    } else {
      push();
    }
  }

  return chunks;
}

type Paragraph = { text: string; start: number };

function splitOnBlankLines(text: string): Paragraph[] {
  const result: Paragraph[] = [];
  const re = /\n\s*\n/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const slice = text.slice(last, match.index);
    if (slice.trim().length > 0) {
      result.push({ text: slice, start: last });
    }
    last = match.index + match[0].length;
  }
  const tail = text.slice(last);
  if (tail.trim().length > 0) {
    result.push({ text: tail, start: last });
  }
  return result;
}

function splitOversizedParagraph(
  text: string,
  maxSize: number,
): Array<{ text: string; offset: number }> {
  const sentenceRe = /(?<=[.!?])\s+(?=[A-Z(])/g;
  const sentences: Array<{ text: string; offset: number }> = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = sentenceRe.exec(text)) !== null) {
    sentences.push({ text: text.slice(last, match.index + 1), offset: last });
    last = match.index + match[0].length;
  }
  sentences.push({ text: text.slice(last), offset: last });

  const out: Array<{ text: string; offset: number }> = [];
  let current = "";
  let currentOffset = 0;
  for (const s of sentences) {
    if (current.length === 0) {
      current = s.text;
      currentOffset = s.offset;
      continue;
    }
    if (current.length + 1 + s.text.length > maxSize) {
      out.push({ text: current, offset: currentOffset });
      current = s.text;
      currentOffset = s.offset;
    } else {
      current = `${current} ${s.text}`;
    }
  }
  if (current.length > 0) {
    out.push({ text: current, offset: currentOffset });
  }
  // Final safety net: if a single "sentence" was still too big, hard-cut it.
  return out.flatMap((piece) => {
    if (piece.text.length <= maxSize) return [piece];
    const pieces: Array<{ text: string; offset: number }> = [];
    for (let i = 0; i < piece.text.length; i += maxSize) {
      pieces.push({
        text: piece.text.slice(i, i + maxSize),
        offset: piece.offset + i,
      });
    }
    return pieces;
  });
}
