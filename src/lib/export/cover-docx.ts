import { AlignmentType, Document, Packer, Paragraph, TextRun } from "docx";
import { format } from "date-fns";
import type { LayoutId } from "./layouts/types";

type CoverLetterInput = {
  greeting: string | null;
  paragraphs: string[];
  signOff: string;
  name: string;
  contactLine?: string;
  candidateName?: string;
  layout: LayoutId;
};

export async function coverLetterDocx(input: CoverLetterInput): Promise<Buffer> {
  const font = input.layout === "classic" ? "Times New Roman" : "Calibri";
  const accent =
    input.layout === "executive"
      ? "1A365D"
      : input.layout === "modern-two-column"
        ? "0F4C5C"
        : "111111";

  const children: Paragraph[] = [];

  children.push(
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { before: 0, after: 20 },
      children: [
        new TextRun({
          text: input.candidateName ?? input.name,
          bold: true,
          size: input.layout === "classic" ? 32 : 36,
          color: accent,
          font,
        }),
      ],
    }),
  );
  if (input.contactLine) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: { before: 0, after: 280 },
        children: [
          new TextRun({ text: input.contactLine, size: 20, color: "555555", font }),
        ],
      }),
    );
  }

  children.push(
    new Paragraph({
      spacing: { before: 0, after: 200 },
      children: [
        new TextRun({ text: format(new Date(), "PPP"), size: 22, font }),
      ],
    }),
  );

  if (input.greeting) {
    children.push(
      new Paragraph({
        spacing: { before: 0, after: 200 },
        children: [new TextRun({ text: input.greeting, size: 22, font })],
      }),
    );
  }

  for (const p of input.paragraphs) {
    children.push(
      new Paragraph({
        spacing: { before: 0, after: 200, line: 300 },
        children: [new TextRun({ text: p, size: 22, font })],
      }),
    );
  }

  children.push(
    new Paragraph({
      spacing: { before: 200, after: 0 },
      children: [new TextRun({ text: input.signOff, size: 22, font })],
    }),
  );
  children.push(
    new Paragraph({
      spacing: { before: 300, after: 0 },
      children: [
        new TextRun({
          text: input.name,
          bold: true,
          size: 22,
          color: accent,
          font,
        }),
      ],
    }),
  );

  const doc = new Document({
    creator: "Resume Talos",
    title: `${input.name} — Cover Letter`,
    styles: { default: { document: { run: { font, size: 22 } } } },
    sections: [
      {
        properties: {
          page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } },
        },
        children,
      },
    ],
  });
  return await Packer.toBuffer(doc);
}
