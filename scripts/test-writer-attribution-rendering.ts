import { renderFactsForPromptWithIds } from "@/lib/agents/resume-writer";
import type { RetrievalGroup } from "@/lib/agents/retriever";

const groups: RetrievalGroup[] = [
  {
    factType: "achievement",
    facts: [
      {
        id: "attributed-1",
        factType: "achievement",
        content: "Led a 352-person organization.",
        evidenceQuote: null,
        metadata: { company: "Social Security Administration", role: "Branch Chief" },
        similarity: 0.9,
      },
      {
        id: "missing-1",
        factType: "achievement",
        content: "Built a reusable delivery operating model.",
        evidenceQuote: null,
        metadata: {},
        similarity: 0.8,
      },
    ],
  },
];

const rendered = renderFactsForPromptWithIds(groups);
const count = (rendered.match(/UNATTRIBUTED/g) ?? []).length;
if (count !== 1) {
  throw new Error(`Expected exactly one UNATTRIBUTED tag, got ${count}:\n${rendered}`);
}
if (rendered.includes("[attributed-1] (UNATTRIBUTED")) {
  throw new Error(`Attributed fact was incorrectly tagged:\n${rendered}`);
}

console.log("PASS writer fact rendering marks only missing-company facts as UNATTRIBUTED.");
