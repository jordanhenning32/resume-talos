import { detectAtsVendor, adviceForLayout } from "@/lib/agents/ats-vendor";
import type { LayoutId } from "@/lib/export/layouts/types";

const TEST_URLS: Array<{ url: string | null; expect: string }> = [
  { url: "https://gdit.wd5.myworkdayjobs.com/External/job/Falls-Church/VP--Federal-AI_RQ158972", expect: "workday" },
  { url: "https://kpmg.wd1.myworkdayjobs.com/...", expect: "workday" },
  { url: "https://boards.greenhouse.io/anthropic/jobs/4283719", expect: "greenhouse" },
  { url: "https://anthropic.greenhouse.io/jobs/4283719", expect: "greenhouse" },
  { url: "https://jobs.lever.co/scale/abc123", expect: "lever" },
  { url: "https://jobs.ashbyhq.com/perplexity/abc123", expect: "ashby" },
  { url: "https://careers-cms.icims.com/jobs/12345/data-program-manager", expect: "icims" },
  { url: "https://www.usajobs.gov/job/123456789", expect: "usajobs" },
  { url: "https://jobs.smartrecruiters.com/Bosch/12345-software-engineer", expect: "smartrecruiters" },
  { url: "https://apply.workable.com/example/j/ABC123", expect: "workable" },
  { url: "https://career5.successfactors.com/sfcareer/abc", expect: "successfactors" },
  { url: "https://eeho.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/X/job/123", expect: "oracle_hcm" },
  { url: "https://corp.taleo.net/careersection/123/jobdetail.ftl?job=ABC", expect: "taleo" },
  { url: "https://example.taleo.net/careersection/ex/jobdetail.ftl?job=ABC", expect: "taleo" },
  { url: "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=abc", expect: "adp" },
  { url: "https://example.bamboohr.com/careers/123", expect: "bamboohr" },
  { url: "https://example.personio.de/jobs/123", expect: "personio" },
  { url: "https://jobs.jobvite.com/example/job/abc", expect: "jobvite" },
  { url: "https://www.linkedin.com/jobs/view/3812345678", expect: "unknown" },
  { url: "https://www.example.com/careers/12345", expect: "unknown" },
  { url: null, expect: "unknown" },
  { url: "", expect: "unknown" },
];

const LAYOUTS: LayoutId[] = ["classic", "executive", "modern-two-column"];

function main() {
  let pass = 0;
  let fail = 0;
  console.log("=== Vendor detection ===\n");
  for (const { url, expect } of TEST_URLS) {
    const d = detectAtsVendor(url);
    const ok = d.vendor === expect;
    if (ok) pass++;
    else fail++;
    const tag = ok ? "PASS" : "FAIL";
    const urlLabel = (url ?? "(null)").slice(0, 70);
    console.log(`${tag} ${urlLabel}  →  ${d.vendor}  ${ok ? "" : `(expected ${expect})`}`);
  }

  console.log(`\n${pass}/${pass + fail} matched.`);

  console.log("\n=== Per-vendor layout advice (sample) ===");
  for (const expectedVendor of ["workday", "taleo", "greenhouse", "usajobs", "unknown"]) {
    const probe = TEST_URLS.find((t) => t.expect === expectedVendor);
    if (!probe) continue;
    const d = detectAtsVendor(probe.url);
    console.log(`\n${d.displayName}  (risk: ${d.rules.riskLevel}, recommends: [${d.rules.recommendedLayouts.join(", ")}])`);
    for (const layout of LAYOUTS) {
      const a = adviceForLayout(d, layout);
      const badge = a.recommended ? "✓" : a.discouraged ? "✗" : "?";
      console.log(`  ${badge} ${layout}: ${a.reason ?? "recommended"}`);
    }
  }
  if (fail > 0) process.exitCode = 1;
  else console.log(`\nPASS vendor detection matched ${pass} cases.`);
}

main();
