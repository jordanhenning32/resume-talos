import {
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TabStopPosition,
  TabStopType,
  TextRun,
  WidthType,
} from "docx";
import type { ParsedResume, ResumeSection } from "../parse-resume";

const ACCENT = "0F4C5C";
const SIDEBAR_BG = "F4F6F8";

export async function modernResumeDocx(resume: ParsedResume): Promise<Buffer> {
  const sidebarSections: ResumeSection[] = [];
  const mainExtras: ResumeSection[] = [];
  for (const s of resume.otherSections) {
    const lower = s.heading.toLowerCase();
    if (
      lower.includes("skill") ||
      lower.includes("certif") ||
      lower.includes("educa") ||
      lower.includes("clear") ||
      lower.includes("award")
    ) {
      sidebarSections.push(s);
    } else {
      mainExtras.push(s);
    }
  }

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: noBorders(),
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 32, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.CLEAR, color: "auto", fill: SIDEBAR_BG },
            margins: { top: 220, bottom: 220, left: 220, right: 180 },
            children: buildSidebar(resume, sidebarSections),
          }),
          new TableCell({
            width: { size: 68, type: WidthType.PERCENTAGE },
            margins: { top: 220, bottom: 220, left: 240, right: 220 },
            children: buildMain(resume, mainExtras),
          }),
        ],
      }),
    ],
  });

  const doc = new Document({
    creator: "Resume Talos",
    title: `${resume.name} — Resume`,
    styles: {
      default: { document: { run: { font: "Calibri", size: 20 } } },
    },
    sections: [
      {
        properties: { page: { margin: { top: 0, bottom: 0, left: 0, right: 0 } } },
        children: [table],
      },
    ],
  });
  return await Packer.toBuffer(doc);
}

function buildSidebar(r: ParsedResume, sections: ResumeSection[]): Paragraph[] {
  const out: Paragraph[] = [];

  out.push(
    new Paragraph({
      spacing: { before: 0, after: 40 },
      children: [
        new TextRun({ text: r.name, bold: true, size: 40, color: ACCENT, font: "Calibri" }),
      ],
    }),
  );
  out.push(
    new Paragraph({
      border: { bottom: { color: ACCENT, space: 1, style: BorderStyle.SINGLE, size: 18 } },
      spacing: { before: 0, after: 200 },
      children: [new TextRun("")],
    }),
  );

  if (r.contactLine) {
    out.push(sidebarHeader("Contact"));
    for (const bit of r.contactLine
      .split(/\s+[·•|]\s+/)
      .map((s) => s.trim())
      .filter(Boolean)) {
      out.push(
        new Paragraph({
          spacing: { before: 20, after: 20 },
          children: [new TextRun({ text: bit, size: 19 })],
        }),
      );
    }
  }

  for (const s of sections) {
    out.push(sidebarHeader(s.heading));
    for (const p of s.paragraphs) {
      out.push(
        new Paragraph({
          spacing: { before: 30, after: 30 },
          children: [new TextRun({ text: p, size: 19 })],
        }),
      );
    }
    for (const b of s.bullets) {
      out.push(
        new Paragraph({
          spacing: { before: 20, after: 20 },
          children: [new TextRun({ text: `• ${b}`, size: 19 })],
        }),
      );
    }
  }
  return out;
}

function buildMain(r: ParsedResume, extras: ResumeSection[]): Paragraph[] {
  const out: Paragraph[] = [];

  if (r.summary) {
    out.push(mainHeader("Summary"));
    out.push(
      new Paragraph({
        spacing: { before: 60, after: 60 },
        children: [new TextRun({ text: r.summary, size: 21 })],
      }),
    );
  }

  if (r.experience.length > 0) {
    out.push(mainHeader("Experience"));
    for (const role of r.experience) {
      out.push(
        new Paragraph({
          spacing: { before: 180, after: 0 },
          tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
          children: [
            new TextRun({ text: role.title, bold: true, size: 22 }),
            new TextRun({
              text: role.dates ? `\t${role.dates}` : "",
              color: "555555",
              size: 19,
            }),
          ],
        }),
      );
      if (role.company) {
        out.push(
          new Paragraph({
            spacing: { before: 0, after: 30 },
            children: [new TextRun({ text: role.company, color: "444444", size: 20 })],
          }),
        );
      }
      for (const b of role.bullets) {
        out.push(
          new Paragraph({
            bullet: { level: 0 },
            spacing: { before: 30, after: 30 },
            children: [new TextRun({ text: b, size: 20 })],
          }),
        );
      }
    }
  }

  for (const s of extras) {
    out.push(mainHeader(s.heading));
    for (const p of s.paragraphs) {
      out.push(
        new Paragraph({
          spacing: { before: 30, after: 30 },
          children: [new TextRun({ text: p, size: 20 })],
        }),
      );
    }
    for (const b of s.bullets) {
      out.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: { before: 30, after: 30 },
          children: [new TextRun({ text: b, size: 20 })],
        }),
      );
    }
  }

  return out;
}

function sidebarHeader(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 220, after: 40 },
    children: [
      new TextRun({
        text: text.toUpperCase(),
        bold: true,
        size: 19,
        color: ACCENT,
        characterSpacing: 30,
      }),
    ],
  });
}

function mainHeader(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 120, after: 40 },
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

function noBorders() {
  return {
    top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  } as const;
}
