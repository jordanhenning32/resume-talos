import {
  checkKnockoutCoverage,
  type Knockout,
} from "@/lib/agents/knockout-detector";

function knockout(
  category: Knockout["category"],
  requirement: string,
): Omit<Knockout, "coverage"> {
  return {
    id: `${category}-${requirement}`,
    category,
    requirement,
    jdEvidenceQuote: requirement,
    scalarMinimum: null,
    scalarUnit: null,
  };
}

const checks = checkKnockoutCoverage(
  [
    knockout("citizenship", "U.S. citizenship"),
    knockout("clearance", "Public Trust clearance"),
    knockout("work_authorization", "Authorized to work without sponsorship"),
  ],
  {
    resumeMarkdown: [
      "I am not a U.S. citizen.",
      "I do not hold a Public Trust clearance.",
      "I am not authorized to work without sponsorship.",
    ].join("\n"),
    kbContext: "",
  },
);

for (const check of checks) {
  if (check.coverage.verdict !== "blocking") {
    throw new Error(
      `Expected ${check.category} negation to be blocking, got ${check.coverage.verdict}: ${JSON.stringify(check.coverage)}`,
    );
  }
}

console.log("PASS knockout coverage treats negated citizenship, clearance, and work authorization as blocking.");
