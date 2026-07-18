import { normalizeResumeHeaders } from "@/lib/export/parseability";

// Matches the user's screenshot — VA Office of Information / Supervisory IT
// Program Manager resume with "Clearances & Eligibility" + "Certifications
// & Awards" non-canonical headers.
const INPUT = `# Jordan Henning
York, PA · jordan@jordanhenning.com · 555-555-0100 · jordanhenning.com

## Summary
Federal IT program manager...

## Clearances & Eligibility
- Public Trust Clearance — High Risk Tier (2008-2025)
- Veterans Preference

## Experience

### Branch Chief · SSA · 2022 – 2025
- Owned $200M+ Agile IT portfolio.

## Skills
- Federal IT delivery · FedRAMP · ATO governance

## Education
- M.B.A., Malone University · 2012

## Certifications & Awards
- FAC-P/PM
- Bronze Star · 2006

## Professional Summary
extra duplicate header that should also normalize

## Tech Toolkit
JavaScript · Python

## Work Experience
Some legacy section name
`;

const { output, changes } = normalizeResumeHeaders(INPUT);

console.log("=== Changes applied ===");
for (const c of changes) {
  console.log(`  line ${c.lineIndex}: "${c.from}" → "${c.to}"`);
}
console.log(`\nTotal: ${changes.length} rename(s)\n`);

console.log("=== Output (headers only) ===");
for (const line of output.split("\n")) {
  if (line.startsWith("## ")) console.log(line);
}

const expectedRenames = 5;
if (changes.length !== expectedRenames) {
  throw new Error(`Expected ${expectedRenames} header renames, got ${changes.length}.`);
}
if (!output.includes("## Clearances") || !output.includes("## Certifications")) {
  throw new Error("Expected normalized Clearances and Certifications headings.");
}
console.log(`\nPASS header normalizer applied ${changes.length} expected renames.`);
