import * as fs from "node:fs/promises";
import * as path from "node:path";
import { format } from "date-fns";
import { env } from "@/lib/env";
import type { RenderedArtifacts } from "./render";

export type ExportFilePaths = {
  folder: string;
  resumePdf: string;
  resumeDocx: string;
  coverPdf: string;
  coverDocx: string;
  metadata: string;
};

/** Sanitize a string for safe folder/file name usage on Windows. */
function safeSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "untitled";
}

export async function writeArtifacts(opts: {
  artifacts: RenderedArtifacts;
  companySlug: string;
  roleSlug: string;
  versionNumber: number;
  iteration: number;
  metadata: Record<string, unknown>;
}): Promise<ExportFilePaths> {
  const root = env().OUTPUT_ROOT;
  const dateStr = format(new Date(), "yyyy-MM-dd");
  const folder = path.join(
    root,
    safeSlug(opts.companySlug),
    `${safeSlug(opts.roleSlug)}-${dateStr}`,
    `v${opts.versionNumber}.${opts.iteration}`,
  );

  await fs.mkdir(folder, { recursive: true });

  const resumePdf = path.join(folder, "resume.pdf");
  const resumeDocx = path.join(folder, "resume.docx");
  const coverPdf = path.join(folder, "cover-letter.pdf");
  const coverDocx = path.join(folder, "cover-letter.docx");
  const metadata = path.join(folder, "metadata.json");

  await Promise.all([
    fs.writeFile(resumePdf, opts.artifacts.resumePdf),
    fs.writeFile(resumeDocx, opts.artifacts.resumeDocx),
    fs.writeFile(coverPdf, opts.artifacts.coverPdf),
    fs.writeFile(coverDocx, opts.artifacts.coverDocx),
    fs.writeFile(
      metadata,
      JSON.stringify(
        {
          ...opts.metadata,
          exportedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    ),
  ]);

  return { folder, resumePdf, resumeDocx, coverPdf, coverDocx, metadata };
}
