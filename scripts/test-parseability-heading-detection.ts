import { renderArtifacts } from "@/lib/export/render";
import { validatePdfParseability } from "@/lib/export/parseability";

const resumeMarkdown = `# Jordan Henning
York, PA | jordan@example.com | 555-555-0100

## Summary
Federal IT leader with experience translating policy, planning, cloud security, and delivery governance into operating rhythms for public-sector teams.

## Skills
- Policy and planning
- Cloud security
- Program governance

## Experience
### Chief Growth Officer - Quadratic Digital - Apr 2025 to Present
- Built delivery playbooks for public-sector AI initiatives, including intake, governance, implementation planning, and operational risk controls.
- Served with the 101st Airborne Division, completing one combat tour in Iraq. Post-separation period was dedicated to education and federal transition prior to SSA appointment.

## Education
- Bachelor of Arts, Kent State University

## Certifications
- AWS Certified AI Practitioner

## Clearances
- Public Trust Clearance - High Risk
`;

const coverLetterMarkdown = `Dear Hiring Team,

Thank you for your consideration.

Sincerely,
Jordan Henning
`;

async function main() {
  const rendered = await renderArtifacts({
    resumeMarkdown,
    coverLetterMarkdown,
    layout: "classic",
  });
  const report = await validatePdfParseability({
    pdfBuffer: rendered.resumePdf,
    sourceMarkdown: resumeMarkdown,
    layoutId: "classic",
    variant: "long",
  });

  const sectionOrderIssue = report.artifacts.find(
    (artifact) => artifact.kind === "section_out_of_order",
  );
  if (sectionOrderIssue) {
    throw new Error(
      `Expected prose-only "education" mention not to count as a heading: ${sectionOrderIssue.sample}`,
    );
  }
  if (report.verdict === "broken") {
    throw new Error(`Expected parseability not to be broken: ${report.notes.join(" ")}`);
  }

  const skillsIndex = report.sectionOrder.extractedOrder.indexOf("Skills");
  const educationIndex = report.sectionOrder.extractedOrder.indexOf("Education");
  if (skillsIndex >= 0 && educationIndex >= 0 && educationIndex < skillsIndex) {
    throw new Error(
      `Expected Education heading after Skills, got [${report.sectionOrder.extractedOrder.join(
        " -> ",
      )}]`,
    );
  }

  console.log(
    `PASS parseability heading detector ignores body prose section words (${report.verdict}, ${Math.round(
      report.contentCoverage * 100,
    )}% coverage).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
