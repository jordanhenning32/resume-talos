import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env" });

import { analyzeJobDescription } from "@/lib/agents/jd-analyzer";

const JD = `Summary
This position is located in the Department of Health & Human Services (HHS), Centers for Medicare & Medicaid Services (CMS), Center for Medicaid and CHIP Services(CMCS).

As a Information Technology Specialist (Systems Analysis), referred to here as a IT Product Manager, GS-2210-13, you will collaborates with cross-functional teams of IT, product, and project management professionals to build data-driven solutions addressing public needs within CMS's program and business areas.

Centers for Medicare & Medicaid Services
The Department of Health & Human Services (HHS), Centers for Medicare & Medicaid Services (CMS) works in partnership with the entire health care community to improve quality and efficiency in an evolving health care system and provides leadership in the broader health care marketplace.

CMS' effectiveness depends on the capabilities of a dedicated, professional staff that is committed to supporting these objectives. A career with CMS offers the opportunity to get involved in important national health care issues and be part of a dynamic, fast-paced, and highly visible organization.

Duties
Provide high-level technical expertise in support of new or existing applications software in one or multiple specialties.
Lead or consult with cross-functional teams of IT, data engineering, design, product, project management, and data science professionals to develop data-driven solutions addressing CMS program and business challenges.
Provide technical advice and support on solutions to critical problems, which require creativity in generating new hypotheses, approaches, and standards to be used agency- and nationwide by others.
Serve as an agency expert in new and emerging information technology tools, platforms, and methods.

Requirements
You must be a U.S. Citizen or National to apply for this position.
You will be subject to a background and suitability investigation.
One-year probationary period may be required.

Qualifications
BASIC REQUIREMENT: You must have IT-related experience, at the GS-14 grade level in the federal government, demonstrating each of the four competencies: Attention to Detail; Customer Service; Oral Communication; Problem Solving.

MINIMUM QUALIFICATION REQUIREMENT: In order to qualify for the GS-13, you must demonstrate in your resume at least one year (52 weeks) of qualifying specialized experience equivalent to the GS-12 grade level in the Federal government, to include:
1) Leading cross-functional teams throughout the IT product development life cycle to deliver user-centric products and implement process automation and continuous improvement initiatives for customer needs;
2) Managing end-to-end agile product roadmaps from ideation through post-launch, including operations and maintenance phases, using collaborative stakeholder engagement methods to prioritize features and deliver iterative product improvements;
3) Collaborating with product stakeholders to identify and prioritize critical business needs, applying user-centered design and agile development practices to develop product strategies and recommendations;
4) Applying human-centered design methods and data-driven analysis, including user research synthesis, to develop product artifacts such as user stories, acceptance criteria, and OKRs that deliver measurable business value.

Education
This job does not have an education qualification requirement.

Additional information
Bargaining Unit Position: Yes-American Federation of Government Employees, Local 1923
Tour of Duty: Flexible
Recruitment Incentive: Not Authorized
Relocation Incentive: Not Authorized
Financial Disclosure: Not Required

Workplace Flexibility at CMS: This position has a regular and recurring reporting requirement to the CMS office listed in this announcement. CMS offers flexible working arrangements and allows employees the opportunity to participate in alternative work schedules at the manager's discretion.

ICTAP/CTAP eligibility is on OPM's Career Transition Resources website at www.opm.gov/rif/employee_guides/career_transition.asp.`;

const ATTEMPTS = Number(process.argv[2] ?? 5);

async function main() {
  let successes = 0;
  let failures = 0;
  let lastAnalysis: any = null;
  for (let i = 1; i <= ATTEMPTS; i++) {
    try {
      const t0 = Date.now();
      const r = await analyzeJobDescription({ jdText: JD });
      const sec = ((Date.now() - t0) / 1000).toFixed(1);
      successes++;
      lastAnalysis = r.analysis;
      console.log(
        `#${i} OK  ${sec}s  $${r.costUsd.toFixed(4)}  must=${r.analysis.mustHaveSkills.length}  nice=${r.analysis.niceToHaveSkills.length}  resp=${r.analysis.responsibilities.length}  summaryLen=${r.analysis.oneSentenceSummary.length}`,
      );
    } catch (e) {
      failures++;
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`#${i} FAIL  ${msg.slice(0, 200)}`);
    }
  }
  console.log(`\nResult: ${successes}/${ATTEMPTS} succeeded, ${failures} failed`);
  if (lastAnalysis) {
    console.log("\nLast analysis snapshot:");
    console.log(`  roleTitle: ${lastAnalysis.roleTitle}`);
    console.log(`  seniority: ${lastAnalysis.seniorityLevel}`);
    console.log(`  company: ${lastAnalysis.companyName}`);
    console.log(`  oneSentenceSummary (${lastAnalysis.oneSentenceSummary.length} chars): ${lastAnalysis.oneSentenceSummary}`);
    console.log(`  mustHave (${lastAnalysis.mustHaveSkills.length}):`);
    for (const s of lastAnalysis.mustHaveSkills) console.log(`    - ${s}`);
  }
  if (failures > 0) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exit(1); });
