import { checkExperienceTenureClaims } from "@/lib/kb/experience-tenure";

const badResume = `
## Summary
Federal IT leader with 17+ years of federal IT leadership across large-scale operations.
`;

const badIssues = checkExperienceTenureClaims(badResume, "resume");
if (badIssues.length !== 1) {
  throw new Error(`Expected one leadership tenure issue, got ${badIssues.length}`);
}
if (!badIssues[0].reason.includes("9+ years")) {
  throw new Error(`Expected issue to explain 9+ year leadership cap: ${badIssues[0].reason}`);
}

const goodResume = `
## Summary
Federal IT leader with 17 years total federal IT experience, including 9+ years in federal IT leadership.
`;

const goodIssues = checkExperienceTenureClaims(goodResume, "resume");
if (goodIssues.length !== 0) {
  throw new Error(`Expected no issues for split total/leadership tenure: ${JSON.stringify(goodIssues)}`);
}

const subtleBad = `
Across a 17-year arc of leading and coordinating complex technology projects at SSA, including 9+ years in federal IT leadership, Jordan built disciplined delivery habits.
`;

const subtleBadIssues = checkExperienceTenureClaims(subtleBad, "cover_letter");
if (subtleBadIssues.length !== 1) {
  throw new Error(`Expected one issue for subtle 17-year leadership wording, got ${subtleBadIssues.length}`);
}

const totalOnly = `
## Summary
Project lead with 17 years total federal IT experience at SSA.
`;

const totalIssues = checkExperienceTenureClaims(totalOnly, "resume");
if (totalIssues.length !== 0) {
  throw new Error(`Expected no issues for total experience only: ${JSON.stringify(totalIssues)}`);
}

const e2ePhrase = `
That's 17 years of federal IT delivery inside the benefits domain, including 9+ years in formal federal IT leadership.
`;

const e2ePhraseIssues = checkExperienceTenureClaims(e2ePhrase, "cover_letter");
if (e2ePhraseIssues.length !== 0) {
  throw new Error(`Expected no issues for split E2E phrasing: ${JSON.stringify(e2ePhraseIssues)}`);
}

console.log("PASS experience tenure verifier catches 17-year leadership overclaims and accepts split total/leadership phrasing.");
