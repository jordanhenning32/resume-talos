import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env" });

import { neon } from "@neondatabase/serverless";
import { renderArtifacts } from "@/lib/export/render";
import { validatePdfParseability } from "@/lib/export/parseability";
import {
  summarizeResumeTrimChanges,
  trimResumeMarkdownOneStep,
  type ResumeTrimChange,
} from "@/lib/export/resume-trim";

const APP_ID = process.argv[2] ?? "7A-QQhU0n0pXN6EkLG4yI";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const [app] = (await sql.query(
    "select id, role, company, jd_analysis from applications where id = $1",
    [APP_ID],
  )) as Array<{
    id: string;
    role: string;
    company: string;
    jd_analysis: {
      roleTitle?: string;
      mustHaveSkills?: string[];
      niceToHaveSkills?: string[];
      keyLanguagePatterns?: string[];
      responsibilities?: string[];
    } | null;
  }>;
  const [version] = (await sql.query(
    "select id, resume_markdown, cover_letter_markdown from application_versions where application_id = $1 order by version_number desc, iteration desc limit 1",
    [APP_ID],
  )) as Array<{
    id: string;
    resume_markdown: string;
    cover_letter_markdown: string | null;
  }>;

  if (!app || !version?.resume_markdown) {
    throw new Error(`No resume markdown found for application ${APP_ID}.`);
  }

  const analysis = app.jd_analysis ?? {};
  const context = {
    variant: "long" as const,
    roleTitle: analysis.roleTitle ?? app.role,
    keywords: [
      ...(analysis.mustHaveSkills ?? []),
      ...(analysis.niceToHaveSkills ?? []),
      ...(analysis.keyLanguagePatterns ?? []),
      ...(analysis.responsibilities ?? []),
    ],
  };
  const original = version.resume_markdown;
  let markdown = original;
  const changes: ResumeTrimChange[] = [];

  for (let pass = 0; pass < 40; pass++) {
    const report = await renderAndValidate({
      markdown,
      coverLetterMarkdown: version.cover_letter_markdown ?? "",
      roleTitle: app.role,
      companyName: app.company,
      keywords: analysis.mustHaveSkills ?? [],
    });
    console.log(
      `pass ${pass}: ${report.pageCount} page(s), ${report.verdict}, ${wordCount(
        markdown,
      )} words`,
    );

    const overflow = report.artifacts.some((a) => a.kind === "page_overflow");
    if (report.pageCount <= 2 && !overflow && report.verdict !== "broken") {
      const summary = summarizeResumeTrimChanges(original, markdown, changes);
      console.log(
        `PASS classic fits after ${changes.length} trim(s): ${summary.wordCountBefore} -> ${summary.wordCountAfter} words.`,
      );
      return;
    }

    const next = trimResumeMarkdownOneStep(markdown, context);
    if (!next) break;
    changes.push(next.change);
    markdown = next.output;
  }

  throw new Error("Classic resume did not fit within 40 deterministic trim passes.");
}

async function renderAndValidate(opts: {
  markdown: string;
  coverLetterMarkdown: string;
  roleTitle: string;
  companyName: string;
  keywords: string[];
}) {
  const rendered = await renderArtifacts({
    resumeMarkdown: opts.markdown,
    coverLetterMarkdown: opts.coverLetterMarkdown,
    layout: "classic",
    pdfMetadata: {
      roleTitle: opts.roleTitle,
      companyName: opts.companyName,
      keywords: opts.keywords,
    },
  });
  return validatePdfParseability({
    pdfBuffer: rendered.resumePdf,
    sourceMarkdown: opts.markdown,
    layoutId: "classic",
    variant: "long",
  });
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
