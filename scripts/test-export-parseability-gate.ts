import { assertExportParseabilityAllowed } from "@/lib/applications/export";
import type {
  ParseabilityAutoFix,
} from "@/lib/applications/export";
import type { ParseabilityReport } from "@/lib/export/parseability";

const brokenReport: ParseabilityReport = {
  layoutId: "classic",
  pageCount: 4,
  extractedTextLength: 1000,
  contentCoverage: 0.7,
  missingTokens: ["summary"],
  sectionOrder: {
    sourceOrder: ["Summary", "Experience"],
    extractedOrder: ["Experience"],
    inOrder: false,
  },
  artifacts: [{ kind: "page_overflow", detail: "too many pages" }],
  verdict: "broken",
  notes: [],
};

const autoFix: ParseabilityAutoFix = {
  applied: false,
  requestedLayout: "classic",
  finalLayout: "classic",
  headerChanges: [],
  trimChanges: null,
  savedVersionId: null,
  savedVersionNumber: null,
  attempts: [
    {
      layout: "classic",
      source: "original",
      verdict: "broken",
      contentCoverage: 0.7,
      pageCount: 4,
    },
  ],
  message: null,
};

let blocked = false;
try {
  assertExportParseabilityAllowed(brokenReport, autoFix);
} catch {
  blocked = true;
}
if (!blocked) {
  throw new Error("Expected broken parseability report to block export.");
}

assertExportParseabilityAllowed({ ...brokenReport, verdict: "warning" }, autoFix);
assertExportParseabilityAllowed({ ...brokenReport, verdict: "clean" }, autoFix);

console.log("PASS export parseability gate blocks broken PDFs and allows warning/clean reports.");
