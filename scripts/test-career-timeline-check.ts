import { checkCareerTimeline } from "@/lib/agents/verifier";
import type { CanonicalCareerRole } from "@/lib/kb/career-timeline";

const timeline: CanonicalCareerRole[] = [
  {
    company: "Quadratic Digital",
    role: "Chief Growth Officer",
    startDate: "2025",
    endDate: "present",
    displayDate: "2025 to Present",
    factIds: ["quadratic-role"],
    evidenceQuotes: ["Chief Growth Officer · Quadratic Digital 2025-Present"],
  },
  {
    company: "Social Security Administration",
    role: "Branch Chief, Hearings Office IT Oversight",
    startDate: "2022-01",
    endDate: "2025-04",
    displayDate: "Jan 2022 to Apr 2025",
    factIds: ["branch-role"],
    evidenceQuotes: [
      "Branch Chief, Hearings Office IT Oversight | Social Security Administration | Jan 2022 - Apr 2025",
    ],
  },
  {
    company: "Social Security Administration",
    role: "IT Project Manager",
    startDate: "2016-09",
    endDate: "2022-01",
    displayDate: "Sep 2016 to Jan 2022",
    factIds: ["itpm-role"],
    evidenceQuotes: [
      "IT Project Manager | Social Security Administration | Sep 2016 - Jan 2022",
    ],
  },
];

const badResume = `
# Jordan Henning
York, PA

## Summary
Project lead.

## Experience
### Chief Growth Officer · Quadratic Digital · 2023-Present
- Built RFP Factory.

### Branch Chief · Social Security Administration · 2020-2023
- Led field IT operations.

### IT Project Manager · Social Security Administration · 2015-2020
- Directed Agile IT portfolios.
`;

const badIssues = checkCareerTimeline(badResume, timeline);
if (badIssues.length !== 3) {
  throw new Error(`Expected 3 bad-date issues, got ${badIssues.length}`);
}

const goodResume = `
# Jordan Henning
York, PA

## Summary
Project lead.

## Experience
### Chief Growth Officer · Quadratic Digital · 2025 to Present
- Built RFP Factory.

### Branch Chief · Social Security Administration · Jan 2022 to Apr 2025
- Led field IT operations.

### IT Project Manager · Social Security Administration · Sep 2016 to Jan 2022
- Directed Agile IT portfolios.
`;

const goodIssues = checkCareerTimeline(goodResume, timeline);
if (goodIssues.length !== 0) {
  throw new Error(`Expected no issues for canonical dates: ${JSON.stringify(goodIssues)}`);
}

// Year-only granularity is accurate, just less precise. "2022-2025" must be
// accepted against canonical "Jan 2022 to Apr 2025" — but a wrong year (the
// badResume above) must still fail.
const yearOnlyResume = `
# Jordan Henning
York, PA

## Summary
Project lead.

## Experience
### Chief Growth Officer · Quadratic Digital · 2025-Present
- Built RFP Factory.

### Branch Chief · Social Security Administration · 2022-2025
- Led field IT operations.

### IT Project Manager · Social Security Administration · 2016-2022
- Directed Agile IT portfolios.
`;

const yearOnlyIssues = checkCareerTimeline(yearOnlyResume, timeline);
if (yearOnlyIssues.length !== 0) {
  throw new Error(`Expected no issues for year-only dates: ${JSON.stringify(yearOnlyIssues)}`);
}

console.log(
  "PASS career timeline verifier catches invented role dates and accepts year-only granularity.",
);
