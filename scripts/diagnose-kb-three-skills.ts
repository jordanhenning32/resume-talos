import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env" });

import { neon } from "@neondatabase/serverless";
import { embedTexts } from "@/lib/models/embed";
import { detectKbGaps } from "@/lib/agents/kb-gap-detector";

const APP_ID = process.argv[2] ?? "gu2YHgg3PC2chM9FjPD4f";

const TARGET_SKILLS = [
  "executive communication",
  "Jira and Confluence proficiency",
  "bachelor's degree",
];

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  // 1. What KB facts mention executives, presenting, Jira, Confluence?
  console.log("=== Facts mentioning executive/presenting/Jira/Confluence ===\n");
  const matched = (await sql`
    SELECT id, fact_type, content, evidence_quote, document_id
    FROM kb_facts
    WHERE
      content ILIKE '%execut%' OR
      content ILIKE '%present%' OR
      content ILIKE '%C-suite%' OR
      content ILIKE '%SES%' OR
      content ILIKE '%commissioner%' OR
      content ILIKE '%senior leadership%' OR
      content ILIKE '%Jira%' OR
      content ILIKE '%Confluence%' OR
      content ILIKE '%Atlassian%'
    ORDER BY fact_type, content
    LIMIT 40
  `) as Array<{ id: string; fact_type: string; content: string; evidence_quote: string | null }>;
  for (const f of matched) {
    console.log(`  [${f.fact_type}] ${f.content.slice(0, 200)}`);
  }
  console.log(`\nTotal: ${matched.length}\n`);

  // 2. What does live gap detection say about these specific skills?
  console.log(`=== Live detectKbGaps run on the 3 target skills ===\n`);
  const report = await detectKbGaps({
    mustHaveSkills: TARGET_SKILLS,
    niceToHaveSkills: [],
    context: { roleTitle: "Data Program Manager", companyName: "Pearson" },
  });
  for (const c of report.mustHave) {
    console.log(`[${c.verdict}] ${c.skill}  strong=${c.strongMatches}  bestSim=${c.bestSimilarity.toFixed(3)}`);
    for (const s of c.topFactSnippets) {
      console.log(`  - ${s.slice(0, 160)}`);
    }
    console.log();
  }

  // 3. Direct vector probe — what's the actual top-5 nearest fact per skill?
  console.log(`=== Direct nearest-neighbor probe per skill ===\n`);
  const { embeddings } = await embedTexts(TARGET_SKILLS);
  for (let i = 0; i < TARGET_SKILLS.length; i++) {
    const vec = `[${embeddings[i].join(",")}]`;
    const rows = (await sql.query(
      `
      SELECT fact_type, content, 1 - (embedding <=> $1::vector) AS sim
      FROM kb_facts
      ORDER BY embedding <=> $1::vector
      LIMIT 5
      `,
      [vec],
    )) as Array<{ fact_type: string; content: string; sim: number }>;
    console.log(`Query: "${TARGET_SKILLS[i]}"`);
    for (const r of rows) {
      const tag = r.sim >= 0.5 ? "✓" : " ";
      console.log(`  ${tag} sim=${r.sim.toFixed(3)} [${r.fact_type}] ${r.content.slice(0, 140)}`);
    }
    console.log();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
