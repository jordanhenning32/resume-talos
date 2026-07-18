import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env" });
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  // Every fact mentioning Jira / Confluence / Atlassian
  console.log("=== Every kb_fact mentioning Jira / Confluence / Atlassian ===");
  const facts = (await sql`
    SELECT id, fact_type, content, document_id
    FROM kb_facts
    WHERE content ILIKE '%jira%' OR content ILIKE '%confluence%' OR content ILIKE '%atlassian%'
    ORDER BY fact_type, content
  `) as Array<{ id: string; fact_type: string; content: string; document_id: string }>;
  for (const f of facts) {
    console.log(`  [${f.fact_type}] ${f.content}`);
  }
  console.log(`Total facts: ${facts.length}\n`);

  // Every chunk mentioning Jira / Confluence
  console.log("=== Every kb_chunk mentioning Jira / Confluence / Atlassian (top 5) ===");
  const chunks = (await sql`
    SELECT c.id, d.name, c.content
    FROM kb_chunks c JOIN kb_documents d ON d.id = c.document_id
    WHERE c.content ILIKE '%jira%' OR c.content ILIKE '%confluence%' OR c.content ILIKE '%atlassian%'
    ORDER BY length(c.content) DESC
    LIMIT 5
  `) as Array<{ id: string; name: string; content: string }>;
  for (const c of chunks) {
    const m = c.content.match(/.{0,140}(jira|confluence|atlassian).{0,140}/i);
    console.log(`  doc=${c.name}`);
    console.log(`    "${(m?.[0] ?? c.content.slice(0, 280)).replace(/\s+/g, " ").trim()}"`);
  }

  // Recent kb_documents (last hour) — to see if user added one via Quick Add
  console.log("\n=== kb_documents from last 60 min ===");
  const recent = (await sql`
    SELECT id, name, metadata, created_at
    FROM kb_documents
    WHERE created_at > NOW() - INTERVAL '60 minutes'
    ORDER BY created_at DESC
  `) as Array<{ id: string; name: string; metadata: any; created_at: string }>;
  for (const d of recent) {
    console.log(`  ${d.created_at}  ${d.name}  source=${d.metadata?.source ?? "?"}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
