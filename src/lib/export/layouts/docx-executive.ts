import {
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  TabStopPosition,
  TabStopType,
  TextRun,
} from "docx";
import type { ParsedResume } from "../parse-resume";

const ACCENT = "1A365D";

export async function executiveResumeDocx(resume: ParsedResume): Promise<Buffer> {
  const doc = new Document({
    creator: "Resume Talos",
    title: `${resume.name} — Resume`,
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: 21 },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 720, bottom: 720, left: 1000, right: 1000 },
          },
        },
        children: build(resume),
      },
    ],
  });
  return await Packer.toBuffer(doc);
}

function build(r: ParsedResume): Paragraph[] {
  const out: Paragraph[] = [];

  // Name + contact split (header row using a tab stop)
  out.push(
    new Paragraph({
      spacing: { before: 0, after: 60 },
      tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
      children: [
        new TextRun({
          text: r.name,
          bold: true,
          size: 52,
          color: ACCENT,
          font: "Calibri",
        }),
        new TextRun({
          text: r.contactLine ? `\t${r.contactLine}` : "",
          size: 19,
          color: "555555",
          font: "Calibri",
        }),
      ],
    }),
  );
  out.push(
    new Paragraph({
      border: {
        bottom: { color: ACCENT, space: 1, style: BorderStyle.SINGLE, size: 18 },
      },
      spacing: { before: 0, after: 120 },
      children: [new TextRun("")],
    }),
  );

  if (r.summary) {
    out.push(sectionHeader("Summary"));
    out.push(
      new Paragraph({
        spacing: { before: 60, after: 60 },
        children: [new TextRun({ text: r.summary, size: 21 })],
      }),
    );
  }

  if (r.experience.length > 0) {
    out.push(sectionHeader("Experience"));
    for (const role of r.experience) {
      out.push(
        new Paragraph({
          spacing: { before: 200, after: 0 },
          tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
          children: [
            new TextRun({ text: role.title, bold: true, size: 22 }),
            new TextRun({
              text: role.dates ? `\t${role.dates}` : "",
              italics: true,
              color: "555555",
              size: 20,
            }),
          ],
        }),
      );
      if (role.company) {
        out.push(
          new Paragraph({
            spacing: { before: 0, after: 30 },
            children: [
              new TextRun({ text: role.company, italics: true, color: "444444", size: 21 }),
            ],
          }),
        );
      }
      for (const b of role.bullets) {
        out.push(bullet(b));
      }
    }
  }

  for (const s of r.otherSections) {
    out.push(sectionHeader(s.heading));
    for (const p of s.paragraphs) {
      out.push(
        new Paragraph({
          spacing: { before: 30, after: 30 },
          children: [new TextRun({ text: p, size: 21 })],
        }),
      );
    }
    for (const b of s.bullets) out.push(bullet(b));
  }

  return out;
}

function sectionHeader(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 220, after: 40 },
    border: { bottom: { color: "888888", space: 2, style: BorderStyle.SINGLE, size: 6 } },
    children: [
      new TextRun({
        text: text.toUpperCase(),
        bold: true,
        size: 24,
        color: ACCENT,
        characterSpacing: 40,
      }),
    ],
  });
}

function bullet(text: string): Paragraph {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { before: 30, after: 30 },
    children: [new TextRun({ text, size: 21 })],
  });
}
