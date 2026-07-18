import { renderToBuffer } from "@react-pdf/renderer";
import { ClassicResumePdf } from "./layouts/pdf-classic";
import { ExecutiveResumePdf } from "./layouts/pdf-executive";
import { ModernResumePdf } from "./layouts/pdf-modern";
import { classicResumeDocx } from "./layouts/docx-classic";
import { executiveResumeDocx } from "./layouts/docx-executive";
import { modernResumeDocx } from "./layouts/docx-modern";
import { CoverLetterPdf } from "./cover-pdf";
import { coverLetterDocx } from "./cover-docx";
import {
  parseCoverLetterMarkdown,
  parseResumeMarkdown,
  type ParsedResume,
} from "./parse-resume";
import type { LayoutId } from "./layouts/types";

export type RenderedArtifacts = {
  resumePdf: Buffer;
  resumeDocx: Buffer;
  coverPdf: Buffer;
  coverDocx: Buffer;
};

/**
 * PDF document metadata context. The candidate's display name is parsed
 * from the resume markdown automatically — callers supply role + company
 * (so the Title can read "Jordan Henning — VP, Federal AI Services Delivery"
 * and Subject can read "Resume for VP, Federal AI Services Delivery at
 * General Dynamics IT"). Workday + Taleo read these fields when populating
 * the candidate profile.
 */
export type PdfMetadataContext = {
  /** JD role title, e.g. "VP, Federal AI Services Delivery". */
  roleTitle: string;
  /** Hiring company name, e.g. "General Dynamics IT". */
  companyName: string;
  /** Optional keyword list — typically the JD's must-have skills. */
  keywords?: string[];
};

export async function renderArtifacts(opts: {
  resumeMarkdown: string;
  coverLetterMarkdown: string;
  layout: LayoutId;
  pdfMetadata?: PdfMetadataContext;
}): Promise<RenderedArtifacts> {
  const resume = parseResumeMarkdown(opts.resumeMarkdown);
  const cover = parseCoverLetterMarkdown(opts.coverLetterMarkdown);

  // Compose PDF metadata. The candidate's display name comes from the
  // parsed resume header — that's what the candidate puts on the document
  // and what we want ATS systems to record. Role + company come from the
  // application context. If no PDF metadata is supplied (legacy callers),
  // we still set Title + Author from the parsed name so the PDFs aren't
  // completely anonymous in the file metadata.
  const candidateName = resume.name || "";
  const ctx = opts.pdfMetadata;
  const resumeMeta = ctx
    ? {
        title: candidateName
          ? `${candidateName} — ${ctx.roleTitle}`
          : `Resume — ${ctx.roleTitle}`,
        author: candidateName || undefined,
        subject: `Resume for ${ctx.roleTitle} at ${ctx.companyName}`,
        keywords:
          ctx.keywords && ctx.keywords.length > 0
            ? ctx.keywords.slice(0, 20).join(", ")
            : undefined,
        creator: "Resume Talos",
        producer: "Resume Talos",
      }
    : {
        title: candidateName || "Resume",
        author: candidateName || undefined,
        creator: "Resume Talos",
        producer: "Resume Talos",
      };

  const coverMeta = ctx
    ? {
        title: candidateName
          ? `${candidateName} — Cover letter for ${ctx.roleTitle}`
          : `Cover letter — ${ctx.roleTitle}`,
        author: candidateName || undefined,
        subject: `Cover letter for ${ctx.roleTitle} at ${ctx.companyName}`,
        creator: "Resume Talos",
        producer: "Resume Talos",
      }
    : {
        title: candidateName ? `${candidateName} — Cover letter` : "Cover letter",
        author: candidateName || undefined,
        creator: "Resume Talos",
        producer: "Resume Talos",
      };

  // Resume PDF
  const resumePdfElement = pickResumePdfElement(opts.layout, resume, resumeMeta);
  const resumePdfPromise = renderToBuffer(resumePdfElement);

  // Resume DOCX
  const resumeDocxPromise = pickResumeDocx(opts.layout, resume);

  // Cover PDF + DOCX (single style adapter, layout-aware)
  const coverPdfPromise = renderToBuffer(
    CoverLetterPdf({
      greeting: cover.greeting,
      paragraphs: cover.paragraphs,
      signOff: cover.signOff,
      name: cover.name,
      candidateName: resume.name,
      contactLine: resume.contactLine,
      layout: opts.layout,
      pdfMeta: coverMeta,
    }),
  );
  const coverDocxPromise = coverLetterDocx({
    greeting: cover.greeting,
    paragraphs: cover.paragraphs,
    signOff: cover.signOff,
    name: cover.name,
    candidateName: resume.name,
    contactLine: resume.contactLine,
    layout: opts.layout,
  });

  const [resumePdf, resumeDocx, coverPdf, coverDocx] = await Promise.all([
    resumePdfPromise,
    resumeDocxPromise,
    coverPdfPromise,
    coverDocxPromise,
  ]);

  // renderToBuffer can return Buffer | NodeJS.ReadableStream — coerce.
  return {
    resumePdf: await toBuffer(resumePdf),
    resumeDocx,
    coverPdf: await toBuffer(coverPdf),
    coverDocx,
  };
}

type PdfDocumentMeta = {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
};

function pickResumePdfElement(
  layout: LayoutId,
  resume: ParsedResume,
  pdfMeta: PdfDocumentMeta,
) {
  switch (layout) {
    case "classic":
      return ClassicResumePdf({ resume, pdfMeta });
    case "executive":
      return ExecutiveResumePdf({ resume, pdfMeta });
    case "modern-two-column":
      return ModernResumePdf({ resume, pdfMeta });
  }
}

function pickResumeDocx(layout: LayoutId, resume: ParsedResume): Promise<Buffer> {
  switch (layout) {
    case "classic":
      return classicResumeDocx(resume);
    case "executive":
      return executiveResumeDocx(resume);
    case "modern-two-column":
      return modernResumeDocx(resume);
  }
}

async function toBuffer(input: Buffer | NodeJS.ReadableStream): Promise<Buffer> {
  if (Buffer.isBuffer(input)) return input;
  const chunks: Buffer[] = [];
  for await (const chunk of input as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
