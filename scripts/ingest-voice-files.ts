import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { ingestDocument } from "@/lib/kb/ingest";
import { fileTypeFromName } from "@/lib/kb/parsers";

const FILES = [
  String.raw`C:\Users\jorda\OneDrive\Documents\Robert Tackett Buddy Letter -Jordan Henning.docx`,
  String.raw`C:\Users\jorda\OneDrive\Documents\writing sample.docx`,
];

async function main() {
  for (const path of FILES) {
    const buffer = readFileSync(path);
    const name = basename(path);
    const fileType = fileTypeFromName(name);
    if (!fileType) {
      console.log(`SKIP ${name}: unsupported file type`);
      continue;
    }
    console.log(`Ingesting ${name} as voice (${buffer.byteLength} bytes)…`);
    try {
      const r = await ingestDocument({
        name,
        fileType,
        buffer,
        kind: "voice",
      });
      console.log(
        `  → ${r.status}: doc=${r.documentId} chunks=${r.chunkCount} facts=${r.factCount} $${r.costUsd.toFixed(4)}`,
      );
      for (const w of r.warnings) console.log(`    warning: ${w}`);
    } catch (e) {
      console.error(`  FAILED: ${e instanceof Error ? e.message : e}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
