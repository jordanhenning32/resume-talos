import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env" });
import { neon } from "@neondatabase/serverless";

const APP_ID = "NQP2fHmUoerjbEEvsuXrw";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const [app] = (await sql`
    SELECT jd_text, jd_analysis, market_research_id
    FROM applications WHERE id = ${APP_ID}
  `) as Array<{ jd_text: string; jd_analysis: any; market_research_id: string | null }>;

  const jdHasOneGov = /onegov/i.test(app.jd_text ?? "");
  console.log(`JD text mentions OneGov: ${jdHasOneGov}`);
  if (jdHasOneGov) {
    const m = app.jd_text.match(/.{0,120}onegov.{0,120}/i);
    console.log(`JD context: "${m?.[0]}"`);
  }

  // Also check market research for the JD's company
  if (app.market_research_id) {
    const [mr] = (await sql`
      SELECT findings, raw_markdown, user_edits
      FROM market_research WHERE id = ${app.market_research_id}
    `) as Array<{ findings: any; raw_markdown: string | null; user_edits: string | null }>;
    const mrText = JSON.stringify(mr?.findings ?? "") + (mr?.raw_markdown ?? "") + (mr?.user_edits ?? "");
    const mrHasOneGov = /onegov/i.test(mrText);
    console.log(`Market research mentions OneGov: ${mrHasOneGov}`);
    if (mrHasOneGov) {
      const m = mrText.match(/.{0,120}onegov.{0,120}/i);
      console.log(`MR context: "${m?.[0]}"`);
    }
  }

  // Also check KB facts in case anything references it
  const kbHits = (await sql`
    SELECT id, value
    FROM kb_facts
    WHERE value ILIKE '%onegov%'
    LIMIT 5
  `) as Array<{ id: string; value: string }>;
  console.log(`KB facts containing OneGov: ${kbHits.length}`);
  for (const f of kbHits) console.log(`  ${f.id}: ${f.value.slice(0, 200)}`);

  // Show the actual cover letter snippet that uses OneGov, for context
  const [v] = (await sql`
    SELECT cover_letter_markdown
    FROM application_versions
    WHERE application_id = ${APP_ID}
    ORDER BY version_number DESC, iteration DESC
    LIMIT 1
  `) as Array<{ cover_letter_markdown: string }>;
  const m = v.cover_letter_markdown.match(/.{0,200}onegov.{0,200}/i);
  console.log(`\nCover letter context:\n"${m?.[0] ?? "(no match)"}"`);
}

main().catch((e) => { console.error(e); process.exit(1); });
