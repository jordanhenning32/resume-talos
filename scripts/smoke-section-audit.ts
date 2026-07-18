import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env" });

import { renderToBuffer } from "@react-pdf/renderer";
import { ClassicResumePdf } from "@/lib/export/layouts/pdf-classic";
import { parseResumeMarkdown } from "@/lib/export/parse-resume";
import { validatePdfParseability } from "@/lib/export/parseability";

// Synthetic resume with INTENTIONALLY non-canonical headers
const NON_CANONICAL_MARKDOWN = `# Jordan Henning
Baltimore, MD · jordan@jordanhenning.com · jordanhenning.com

## Career Highlights
Federal AI Services Delivery executive with 17+ years inside SSA. Built two production multi-agent systems personally; led $200M+ Agile IT portfolio.

## Professional Background

### Chief Growth Officer · Quadratic Digital · 2025 – Present
- Built two production multi-agent AI systems personally — RFP Factory and Futures Bot.
- Spearheading capture and BD partnership across federal AI services delivery.

### Branch Chief · SSA · 2022 – 2025
- Owned $200M+ Agile IT portfolio across 170 nationwide offices.

## Tech Toolkit
Python · TypeScript · Claude API · OpenAI API · LangChain · React · Node.js · AWS · FedRAMP · ATO

## What Drives Me
Federal AI service delivery at scale, with hands-on technical fluency rather than slideware.

## Schools
- M.B.A., Malone University · 2012
- B.A., Computer Information Systems, Kent State University · 2008
`;

async function main() {
  const resume = parseResumeMarkdown(NON_CANONICAL_MARKDOWN);
  const pdfElement = ClassicResumePdf({
    resume,
    pdfMeta: {
      title: "Synthetic test",
      author: "Jordan Henning",
      creator: "Resume Talos smoke test",
    },
  });
  const pdfBuffer = await renderToBuffer(pdfElement);
  const buf = Buffer.isBuffer(pdfBuffer)
    ? pdfBuffer
    : await streamToBuffer(pdfBuffer as NodeJS.ReadableStream);

  const report = await validatePdfParseability({
    pdfBuffer: buf,
    sourceMarkdown: NON_CANONICAL_MARKDOWN,
    layoutId: "classic",
  });

  console.log(`Verdict: ${report.verdict}`);
  console.log(`Total artifacts: ${report.artifacts.length}\n`);
  for (const a of report.artifacts) {
    console.log(`  [${a.kind}] ${a.detail}`);
    if (a.sample) console.log(`     sample: "${a.sample}"`);
  }
  const missingCanonical = report.artifacts.filter((a) => a.kind === "missing_canonical_section").length;
  const nonCanonical = report.artifacts.filter((a) => a.kind === "non_canonical_section_header").length;
  if (report.verdict !== "broken" || missingCanonical !== 4 || nonCanonical !== 5) {
    throw new Error(
      `Expected broken section audit with 4 missing canonical and 5 non-canonical artifacts; got verdict=${report.verdict}, missing=${missingCanonical}, nonCanonical=${nonCanonical}.`,
    );
  }
  console.log("\nPASS section audit detected the expected synthetic header issues.");
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

main().catch((e) => { console.error(e); process.exit(1); });
