import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env" });

import { neon } from "@neondatabase/serverless";
import { runQuestionnaireHelper } from "@/lib/agents/questionnaire-helper";
import type { JdAnalysis } from "@/lib/agents/jd-analyzer";
import type { KnockoutReportShape } from "@/db/schema";

const APP_ID = process.argv[2] ?? "NQP2fHmUoerjbEEvsuXrw"; // GDIT

// A realistic Workday-style screening-questionnaire paste — mix of yes/no,
// multi-select, years matrix, short-answer, salary, self-ID.
const SAMPLE_QUESTIONS = `1. Are you a U.S. citizen?  Yes / No

2. Will you now or in the future require sponsorship for employment visa status? Yes / No

3. Do you hold an active or reinstatement-eligible federal security clearance?
   - None
   - Public Trust
   - Secret
   - Top Secret
   - TS/SCI

4. How many years of federal services delivery leadership experience do you have?
   - Less than 5
   - 5-9
   - 10-14
   - 15+

5. Which of the following federal contract vehicles have you delivered work under? (select all that apply)
   - GSA MAS
   - OASIS+
   - STARS III
   - 8(a)
   - SDVOSB
   - HUBZone
   - IDIQ/BPA
   - None of the above

6. Describe in 100 words or less a time you owned P&L responsibility for a federal services portfolio. Include the dollar scale.

7. What is your desired base salary range for this role?

8. Are you willing to travel up to 25% to client sites?

9. Self-identification (voluntary):
   - Are you a protected veteran?
   - Do you have a disability?
   - Race/ethnicity

10. When can you start if offered?`;

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const [app] = (await sql`
    SELECT id, role, company, jd_analysis, knockout_report
    FROM applications WHERE id = ${APP_ID}
  `) as Array<{
    id: string;
    role: string;
    company: string;
    jd_analysis: any;
    knockout_report: any;
  }>;
  if (!app?.jd_analysis) throw new Error("App or JD analysis missing");
  console.log(`=== ${app.role} @ ${app.company} ===\n`);

  const knockout = app.knockout_report as KnockoutReportShape | null;
  const t0 = Date.now();
  const result = await runQuestionnaireHelper({
    rawQuestions: SAMPLE_QUESTIONS,
    jdAnalysis: app.jd_analysis as JdAnalysis,
    knockoutReport: knockout as any,
  });
  const sec = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(
    `Generated ${result.answers.length} answers (${result.factsRetrieved} facts retrieved, $${result.costUsd.toFixed(4)}, ${sec}s)\n`,
  );
  for (let i = 0; i < result.answers.length; i++) {
    const a = result.answers[i];
    const badge =
      a.confidence === "high"
        ? "✓"
        : a.confidence === "medium"
          ? "~"
          : a.confidence === "low"
            ? "?"
            : "!";
    console.log(`${badge} [${a.confidence.toUpperCase()}/${a.questionType}]  Q: ${a.question.slice(0, 100)}`);
    console.log(`   A: ${a.suggestedAnswer}`);
    console.log(`   Notes: ${a.groundingNotes}`);
    if (a.warnings.length > 0) {
      for (const w of a.warnings) console.log(`   ⚠ ${w}`);
    }
    if (a.groundingFactIds.length > 0) {
      console.log(`   Cites: ${a.groundingFactIds.length} fact(s)`);
    }
    console.log();
  }
  if (result.generalNotes.length > 0) {
    console.log("General notes:");
    for (const n of result.generalNotes) console.log(`  - ${n}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
