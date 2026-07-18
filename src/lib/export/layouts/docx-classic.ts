import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TabStopPosition,
  TabStopType,
  TextRun,
} from "docx";
import type { ParsedResume } from "../parse-resume";

export async function classicResumeDocx(resume: ParsedResume): Promise<Buffer> {
  const doc = new Document({
    creator: "Resume Talos",
    title: `${resume.name} — Resume`,
    styles: {
      default: {
        document: {
          run: { font: "Times New Roman", size: 21 /* 10.5pt */ },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 720, bottom: 720, left: 900, right: 900 },
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

  out.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 120 },
      children: [
        new TextRun({ text: r.name, bold: true, size: 44 /* 22pt */, font: "Times New Roman" }),
      ],
    }),
  );
  if (r.contactLine) {
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 80 },
        children: [new TextRun({ text: r.contactLine, size: 20 })],
      }),
    );
  }
  out.push(
    new Paragraph({
      border: { bottom: { color: "000000", space: 1, style: BorderStyle.SINGLE, size: 8 } },
      spacing: { before: 60, after: 120 },
      children: [new TextRun("")],
    }),
  );

  if (r.summary) {
    out.push(sectionHeader("Summary"));
    out.push(plainParagraph(r.summary));
  }

  if (r.experience.length > 0) {
    out.push(sectionHeader("Experience"));
    for (const role of r.experience) {
      out.push(
        new Paragraph({
          spacing: { before: 160, after: 30 },
          tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
          children: [
            new TextRun({
              text: `${role.title}${role.company ? ` · ${role.company}` : ""}`,
              bold: true,
            }),
            new TextRun({
              text: role.dates ? `\t${role.dates}` : "",
            }),
          ],
        }),
      );
      for (const b of role.bullets) {
        out.push(bullet(b));
      }
    }
  }

  for (const s of r.otherSections) {
    out.push(sectionHeader(s.heading));
    for (const p of s.paragraphs) out.push(plainParagraph(p));
    for (const b of s.bullets) out.push(bullet(b));
  }

  return out;
}

function sectionHeader(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 60 },
    children: [
      new TextRun({
        text: text.toUpperCase(),
        bold: true,
        size: 22,
        characterSpacing: 30,
      }),
    ],
  });
}

function plainParagraph(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 30, after: 30 },
    children: [new TextRun(text)],
  });
}

function bullet(text: string): Paragraph {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { before: 20, after: 20 },
    children: [new TextRun(text)],
  });
}
