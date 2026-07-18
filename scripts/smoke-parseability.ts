import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env" });

import { neon } from "@neondatabase/serverless";
import { renderArtifacts } from "@/lib/export/render";
import { validatePdfParseability } from "@/lib/export/parseability";
import type { LayoutId } from "@/lib/export/layouts/types";

const APP_ID = process.argv[2] ?? "NQP2fHmUoerjbEEvsuXrw";
const LAYOUTS: LayoutId[] = ["classic", "executive", "modern-two-column"];

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const [app] = (await sql`
    SELECT a.id, a.role, a.company
    FROM applications a WHERE a.id = ${APP_ID}
  `) as Array<{ id: string; role: string; company: string }>;
  if (!app) throw new Error(`App ${APP_ID} not found.`);

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
  if (!v?.resume_markdown) throw new Error("No resume markdown.");

  console.log(`=== ${app.role} @ ${app.company} · v${v.version_number}.${v.iteration} ===`);
  console.log(`Resume markdown: ${v.resume_markdown.length} chars\n`);

  let cleanLayouts = 0;
  for (const layout of LAYOUTS) {
    const t0 = Date.now();
    const rendered = await renderArtifacts({
      resumeMarkdown: v.resume_markdown,
      coverLetterMarkdown: v.cover_letter_markdown ?? "",
      layout,
    });
    const renderSec = ((Date.now() - t0) / 1000).toFixed(1);

    const report = await validatePdfParseability({
      pdfBuffer: rendered.resumePdf,
      sourceMarkdown: v.resume_markdown,
      layoutId: layout,
    });

    console.log(`---------- ${layout} (rendered ${renderSec}s, PDF ${(rendered.resumePdf.byteLength / 1024).toFixed(1)} KB) ----------`);
    console.log(`Verdict:        ${report.verdict.toUpperCase()}`);
    console.log(`Pages:          ${report.pageCount}`);
    console.log(`Extracted len:  ${report.extractedTextLength} chars`);
    console.log(`Coverage:       ${(report.contentCoverage * 100).toFixed(1)}%`);
    console.log(`Sections src:   [${report.sectionOrder.sourceOrder.join(", ")}]`);
    console.log(`Sections out:   [${report.sectionOrder.extractedOrder.join(", ")}]`);
    console.log(`Sections OK:    ${report.sectionOrder.inOrder}`);
    if (report.missingTokens.length > 0) {
      console.log(`Missing toks:   ${report.missingTokens.slice(0, 8).join(", ")}${report.missingTokens.length > 8 ? "…" : ""}`);
    }
    if (report.artifacts.length === 0) {
      console.log(`Artifacts:      (none)`);
    } else {
      console.log(`Artifacts (${report.artifacts.length}):`);
      for (const a of report.artifacts) {
        console.log(`  [${a.kind}] ${a.detail}`);
        if (a.sample) console.log(`    sample: "${a.sample.slice(0, 160)}"`);
      }
    }
    for (const n of report.notes) console.log(`Note: ${n}`);
    console.log();
    if (report.verdict === "clean") cleanLayouts++;
  }
  if (cleanLayouts === 0) {
    throw new Error("Expected at least one clean parseable layout.");
  }
  console.log(`PASS parseability smoke found ${cleanLayouts}/${LAYOUTS.length} clean layout(s).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
