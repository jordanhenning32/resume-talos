import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env" });

import { neon } from "@neondatabase/serverless";
import { getMeta } from "unpdf";
import { renderArtifacts } from "@/lib/export/render";
import { validatePdfParseability } from "@/lib/export/parseability";
import type { LayoutId } from "@/lib/export/layouts/types";

const APP_ID = process.argv[2] ?? "NQP2fHmUoerjbEEvsuXrw";
const LAYOUTS: LayoutId[] = ["classic", "executive", "modern-two-column"];

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const [app] = (await sql`
    SELECT a.id, a.role, a.company, a.jd_analysis
    FROM applications a WHERE a.id = ${APP_ID}
  `) as Array<{ id: string; role: string; company: string; jd_analysis: any }>;
  if (!app) throw new Error(`App ${APP_ID} not found`);

  const [v] = (await sql`
    SELECT id, version_number, iteration, resume_markdown, cover_letter_markdown
    FROM application_versions
    WHERE application_id = ${APP_ID}
    ORDER BY version_number DESC, iteration DESC
    LIMIT 1
  `) as Array<{
    id: string;
    version_number: number;
    iteration: number;
    resume_markdown: string;
    cover_letter_markdown: string;
  }>;
  if (!v?.resume_markdown) throw new Error("No resume markdown");

  console.log(`=== ${app.role} @ ${app.company} · v${v.version_number}.${v.iteration} ===\n`);

  const keywords =
    (app.jd_analysis?.mustHaveSkills as string[] | undefined) ?? [];

  let layoutsWithCompleteMetadata = 0;
  for (const layout of LAYOUTS) {
    const rendered = await renderArtifacts({
      resumeMarkdown: v.resume_markdown,
      coverLetterMarkdown: v.cover_letter_markdown ?? "",
      layout,
      pdfMetadata: {
        roleTitle: app.role,
        companyName: app.company,
        keywords,
      },
    });

    // Read PDF info dict via pdfjs (unpdf wrapper). @react-pdf/renderer
    // compresses the info dictionary so raw-byte regex doesn't match — the
    // proper way is to ask the PDF library.
    const resumeMeta = await getMeta(new Uint8Array(rendered.resumePdf));
    const coverMeta = await getMeta(new Uint8Array(rendered.coverPdf));
    const resumeInfo: Record<string, unknown> = resumeMeta.info ?? {};
    const coverInfo: Record<string, unknown> = coverMeta.info ?? {};

    const hits = {
      "resume Title": Boolean(resumeInfo.Title),
      "resume Author": Boolean(resumeInfo.Author),
      "resume Subject": Boolean(resumeInfo.Subject),
      "resume Keywords": Boolean(resumeInfo.Keywords),
      "resume Creator": Boolean(resumeInfo.Creator),
      "cover Title": Boolean(coverInfo.Title),
      "cover Author": Boolean(coverInfo.Author),
      "cover Subject": Boolean(coverInfo.Subject),
    };

    const titleStr = resumeInfo.Title ? String(resumeInfo.Title) : null;
    const subjectStr = resumeInfo.Subject ? String(resumeInfo.Subject) : null;
    const authorStr = resumeInfo.Author ? String(resumeInfo.Author) : null;
    const keywordsStr = resumeInfo.Keywords ? String(resumeInfo.Keywords) : null;

    // Run parseability — this exercises the new section-strictness audit too.
    const report = await validatePdfParseability({
      pdfBuffer: rendered.resumePdf,
      sourceMarkdown: v.resume_markdown,
      layoutId: layout,
    });

    console.log(`---------- ${layout} (PDF ${(rendered.resumePdf.byteLength / 1024).toFixed(1)} KB) ----------`);
    for (const [k, ok] of Object.entries(hits)) {
      console.log(`  ${ok ? "✓" : "✗"} ${k}`);
    }
    if (titleStr) console.log(`  Title:    "${titleStr}"`);
    if (authorStr) console.log(`  Author:   "${authorStr}"`);
    if (subjectStr) console.log(`  Subject:  "${subjectStr}"`);
    if (keywordsStr) console.log(`  Keywords: "${keywordsStr.slice(0, 200)}"`);
    if (Object.values(hits).every(Boolean)) layoutsWithCompleteMetadata++;

    console.log(`  parseability: ${report.verdict.toUpperCase()}  (${report.artifacts.length} artifact(s))`);
    for (const a of report.artifacts) {
      console.log(`    [${a.kind}] ${a.detail.slice(0, 130)}`);
    }
    console.log();
  }
  if (layoutsWithCompleteMetadata !== LAYOUTS.length) {
    throw new Error(
      `Expected all layouts to include PDF metadata, got ${layoutsWithCompleteMetadata}/${LAYOUTS.length}.`,
    );
  }
  console.log(`PASS PDF metadata present on ${layoutsWithCompleteMetadata} layout(s).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
