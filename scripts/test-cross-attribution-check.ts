import { checkCrossAttribution } from "@/lib/agents/verifier";

const resume = `
## Experience

### Director | Quadratic Digital | 2024-present
- Led a 352-person organization and reviewed 40 artifact packages per quarter.
`;

const issues = checkCrossAttribution(resume, [
  {
    id: "ssa-fact",
    content: "Led a 352-person organization and reviewed 40 artifact packages per quarter at Social Security Administration.",
    metadata: { company: "Social Security Administration" },
  },
]);

if (issues.length !== 1) {
  throw new Error(`Expected one cross-attribution issue, got ${issues.length}.`);
}
if (!issues[0].reason.includes("ssa-fact")) {
  throw new Error(`Expected issue to cite ssa-fact: ${JSON.stringify(issues[0])}`);
}

const aliasResume = `
## Experience

### Branch Chief | SSA | 2015-2024
- Led a 352-person organization and reviewed 40 artifact packages per quarter.
`;

const aliasIssues = checkCrossAttribution(aliasResume, [
  {
    id: "ssa-alias-fact",
    content: "Led a 352-person organization and reviewed 40 artifact packages per quarter at Social Security Administration.",
    metadata: { company: "Social Security Administration" },
  },
]);

if (aliasIssues.length !== 0) {
  throw new Error(`Expected SSA alias not to be flagged: ${JSON.stringify(aliasIssues)}`);
}

const skillsResume = `
## Experience

### Branch Chief | Social Security Administration | 2022-2025
- Led a 352-person organization and reviewed 40 artifact packages per quarter.

## Skills
- Built two production multi-agent AI systems end-to-end.
`;

const skillsIssues = checkCrossAttribution(skillsResume, [
  {
    id: "ssa-org-fact",
    content: "Led a 352-person organization and reviewed 40 artifact packages per quarter at Social Security Administration.",
    metadata: { company: "Social Security Administration" },
  },
  {
    id: "transferable-ai-fact",
    content: "Built two production multi-agent AI systems end-to-end.",
    metadata: { attribution: "transferable" },
  },
]);

if (skillsIssues.length !== 0) {
  throw new Error(`Expected Skills bullets not to inherit last employer: ${JSON.stringify(skillsIssues)}`);
}

console.log("PASS cross-attribution verifier check detects mismatches, accepts SSA aliases, and resets outside Experience.");
