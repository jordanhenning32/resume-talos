import { detectResumeSections } from "@/lib/kb/section-detect";

const resume = `
Social Security Administration | Branch Chief | 2015-2024
- Led a federal IT portfolio.

## Quadratic Digital
Chief Growth Officer
2024-present
- Built a growth operating system.

Director, MTD Products
2020-2022
- Managed enterprise programs.
`;

const sections = detectResumeSections(resume);
const companies = sections.map((s) => s.company);

if (sections.length !== 3) {
  throw new Error(`Expected 3 sections, got ${sections.length}: ${JSON.stringify(sections)}`);
}
for (const expected of ["Social Security Administration", "Quadratic Digital", "MTD Products"]) {
  if (!companies.includes(expected)) {
    throw new Error(`Missing company ${expected}: ${JSON.stringify(sections)}`);
  }
}
if (!sections.every((s, i) => s.charEnd > s.charStart && (i === 0 || s.charStart >= sections[i - 1].charStart))) {
  throw new Error(`Invalid section boundaries: ${JSON.stringify(sections)}`);
}

const generatedHeadingResume = `
### Branch Chief · Social Security Administration · Jan 2022 - Apr 2025
- Led a federal IT portfolio.
`;
const [generatedHeading] = detectResumeSections(generatedHeadingResume);
if (
  generatedHeading?.company !== "Social Security Administration" ||
  generatedHeading.role !== "Branch Chief" ||
  generatedHeading.startDate !== "2022-01" ||
  generatedHeading.endDate !== "2025-04"
) {
  throw new Error(
    `Expected generated resume heading to parse role/company correctly: ${JSON.stringify(generatedHeading)}`,
  );
}

console.log("PASS section detection found synthetic resume sections and generated role-company headings.");
