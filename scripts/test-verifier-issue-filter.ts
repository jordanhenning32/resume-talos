import {
  filterSelfContradictingIssues,
  type VerifierOutput,
} from "@/lib/agents/verifier";

const issues: VerifierOutput["issuesFound"] = [
  {
    doc: "cover_letter",
    severity: "critical",
    quote: "GDIT serves CMS through OneGov.",
    location: "paragraph 2",
    reason:
      "Unsupported because: SOURCE 2 does mention CMS OneGov savings, but does not say GDIT serves this healthcare territory through OneGov.",
  },
  {
    doc: "resume",
    severity: "warning",
    quote: "Public Trust clearance.",
    location: "Clearances",
    reason: "The claim is supported by SOURCE 1.",
  },
];

const filtered = filterSelfContradictingIssues(issues);

if (filtered.length !== 1) {
  throw new Error(`Expected exactly one issue to remain, got ${filtered.length}.`);
}
if (filtered[0].quote !== issues[0].quote) {
  throw new Error(`Expected partial-support issue to remain: ${JSON.stringify(filtered)}`);
}

console.log("PASS verifier issue filter keeps partial-support findings and drops unconditional supported findings.");
