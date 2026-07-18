import { extractText as extractPdfText } from "unpdf";

// Minimal local typing for mammoth — the upstream package ships no types.
type MammothModule = {
  extractRawText: (
    input: { buffer: Buffer | ArrayBuffer | Uint8Array },
  ) => Promise<{ value: string; messages: Array<{ message: string }> }>;
};

export type SupportedFileType = "pdf" | "docx" | "txt" | "md";

export const SUPPORTED_EXTENSIONS = [".pdf", ".docx", ".txt", ".md"] as const;
export const SUPPORTED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
] as const;

export function fileTypeFromName(name: string): SupportedFileType | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "md";
  if (lower.endsWith(".txt")) return "txt";
  return null;
}

export type ParseResult = {
  text: string;
  pageCount?: number;
  warnings: string[];
};

export async function parseDocument(
  fileType: SupportedFileType,
  buffer: Buffer,
): Promise<ParseResult> {
  switch (fileType) {
    case "pdf": {
      const { text, totalPages } = await extractPdfText(new Uint8Array(buffer), {
        mergePages: true,
      });
      return { text: normalizeText(text), pageCount: totalPages, warnings: [] };
    }
    case "docx": {
      const mammoth = (await import("mammoth")) as unknown as MammothModule;
      const { value, messages } = await mammoth.extractRawText({ buffer });
      return {
        text: normalizeText(value),
        warnings: messages.map((m) => m.message),
      };
    }
    case "md":
    case "txt": {
      return { text: normalizeText(buffer.toString("utf-8")), warnings: [] };
    }
  }
}

function normalizeText(text: string): string {
  return text
    // Normalize Windows / classic Mac line endings.
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    // Collapse runs of blank lines (>2) down to exactly two.
    .replace(/\n{3,}/g, "\n\n")
    // Drop trailing whitespace on every line.
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}
