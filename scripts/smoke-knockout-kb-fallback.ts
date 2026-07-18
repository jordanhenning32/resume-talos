import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { runKnockoutScan } from "@/lib/agents/knockout-detector";
import type { JdAnalysis } from "@/lib/agents/jd-analyzer";

const JD_TEXT = `Federal Data Product Manager

Minimum qualifications:
- Must be a U.S. citizen.
- Must be able to maintain a Public Trust clearance.
- Requires 5+ years of federal IT product delivery experience.
- Bachelor's degree in computer science, information systems, or related field required.
- PMP certification required.`;

const JD_ANALYSIS: JdAnalysis = {
  companyName: "Resume Talos Smoke",
  roleTitle: "Federal Data Product Manager",
  seniorityLevel: "senior",
  teamFunction: "Federal Data Products",
  locationMode: "remote",
  primaryLocation: null,
  mustHaveSkills: [
    "U.S. citizenship",
    "Public Trust clearance",
    "5+ years federal IT product delivery",
    "bachelor's degree",
    "PMP certification",
  ],
  niceToHaveSkills: [],
  experienceYears: {
    min: 5,
    max: null,
    domain: "federal IT product delivery",
  },
  successSignals: ["clear eligibility", "federal delivery credibility"],
  keyLanguagePatterns: [
    "U.S. citizen",
    "Public Trust clearance",
    "federal IT product delivery",
    "PMP certification",
  ],
  responsibilities: ["Lead federal IT product delivery"],
  redFlags: [],
  compensationSignal: null,
  oneSentenceSummary:
    "Lead federal IT product delivery for a public-sector data platform.",
};

const KB_CONTEXT = `Jordan Henning is a U.S. citizen.

Jordan held a Public Trust Clearance - High Risk Tier from 2008-2025 and is reinstatement eligible.

Jordan has 17 years total federal IT experience, including 9+ years of federal IT leadership and product delivery.

Education: Bachelor of Science in Computer Information Systems.

Certification: Project Management Professional (PMP).`;

async function main() {
  const t0 = Date.now();
  const report = await runKnockoutScan({
    jdText: JD_TEXT,
    jdAnalysis: JD_ANALYSIS,
    resumeMarkdown: null,
    resumeVersionId: null,
    kbContext: KB_CONTEXT,
  });
  const sec = ((Date.now() - t0) / 1000).toFixed(1);

  const verifiedFromKb = report.knockouts.filter(
    (k) => k.coverage.verdict === "verified" && k.coverage.source === "kb",
  );
  if (report.knockouts.length === 0) {
    throw new Error("Expected the detector to find at least one knockout.");
  }
  if (verifiedFromKb.length === 0) {
    throw new Error(
      `Expected at least one knockout to verify from KB fallback evidence: ${JSON.stringify(report.knockouts)}`,
    );
  }

  console.log(
    `PASS knockout KB fallback verified ${verifiedFromKb.length}/${report.knockouts.length} knockout(s) from inline KB context in ${sec}s for $${report.costUsd.toFixed(4)}.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
