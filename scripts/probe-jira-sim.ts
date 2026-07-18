import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env" });
import { neon } from "@neondatabase/serverless";
import { embedTexts } from "@/lib/models/embed";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const queries = [
    "Jira and Confluence proficiency",
    "Jira",
    "Jira proficiency",
    "Confluence proficiency",
    "Confluence",
    "Atlassian Jira",
    "issue tracking with Jira",
  ];
  const { embeddings } = await embedTexts(queries);
  for (let i = 0; i < queries.length; i++) {
    const vec = `[${embeddings[i].join(",")}]`;
    const rows = (await sql.query(
      `SELECT fact_type, content, 1 - (embedding <=> $1::vector) AS sim
       FROM kb_facts
       WHERE content ILIKE '%jira%' OR content ILIKE '%confluence%'
       ORDER BY embedding <=> $1::vector LIMIT 3`,
      [vec],
    )) as Array<{ fact_type: string; content: string; sim: number }>;
    console.log(`\nQuery: "${queries[i]}"`);
    for (const r of rows) {
      const tag = r.sim >= 0.5 ? "✓" : " ";
      console.log(`  ${tag} sim=${r.sim.toFixed(3)} ${r.content.slice(0, 130)}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
