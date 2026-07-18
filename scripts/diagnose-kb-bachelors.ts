import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env" });

import { neon } from "@neondatabase/serverless";
import { embedTexts } from "@/lib/models/embed";

const APP_ID = process.argv[2] ?? "gu2YHgg3PC2chM9FjPD4f"; // Pearson PM

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  // 1) What's in the cached kbGapReport for this app?
  const [app] = (await sql`
    SELECT id, role, company, kb_gap_report
    FROM applications WHERE id = ${APP_ID}
  `) as Array<{ id: string; role: string; company: string; kb_gap_report: any }>;
  if (!app) throw new Error(`App ${APP_ID} not found`);
  console.log(`=== ${app.role} @ ${app.company} ===\n`);

  const report = app.kb_gap_report;
  if (report?.mustHave) {
    console.log("Must-have skills (verdict / strongMatches / bestSimilarity):");
    for (const s of report.mustHave) {
      console.log(
        `  [${s.verdict}] ${s.skill}  strong=${s.strongMatches}  bestSim=${s.bestSimilarity?.toFixed(3)}`,
      );
      if (s.topFactSnippets?.length) {
        for (const snip of s.topFactSnippets.slice(0, 2)) {
          console.log(`     - ${snip.slice(0, 140)}`);
        }
      }
    }
  } else {
    console.log("(no kb_gap_report cached on this app)");
  }

  // 2) ANY facts mentioning education / degree / bachelor / MBA / university?
  const eduFacts = (await sql`
    SELECT id, fact_type, content, evidence_quote, document_id
    FROM kb_facts
    WHERE
      content ILIKE '%bachelor%' OR
      content ILIKE '%b.s.%' OR
      content ILIKE '%b.a.%' OR
      content ILIKE '%bsc%' OR
      content ILIKE '%mba%' OR
      content ILIKE '%m.b.a.%' OR
      content ILIKE '%master%' OR
      content ILIKE '%degree%' OR
      content ILIKE '%university%' OR
      content ILIKE '%college%' OR
      fact_type = 'education'
    ORDER BY fact_type, content
    LIMIT 30
  `) as Array<{
    id: string;
    fact_type: string;
    content: string;
    evidence_quote: string | null;
    document_id: string;
  }>;
  console.log(`\n--- KB facts mentioning education-related terms (${eduFacts.length}) ---`);
  for (const f of eduFacts) {
    console.log(`  [${f.fact_type}] ${f.content.slice(0, 160)}`);
    if (f.evidence_quote)
      console.log(`     quote: "${f.evidence_quote.slice(0, 120)}"`);
  }

  // 3) ANY chunks mentioning these terms even if not extracted as facts?
  const eduChunks = (await sql`
    SELECT c.id, c.content, c.document_id, d.name
    FROM kb_chunks c
    JOIN kb_documents d ON d.id = c.document_id
    WHERE
      c.content ILIKE '%bachelor%' OR
      c.content ILIKE '%B.S.%' OR
      c.content ILIKE '%B.A.%' OR
      c.content ILIKE '%MBA%' OR
      c.content ILIKE '%M.B.A%' OR
      c.content ILIKE '%university%' OR
      c.content ILIKE '%college%'
    LIMIT 10
  `) as Array<{ id: string; content: string; document_id: string; name: string }>;
  console.log(`\n--- Chunks mentioning education-related terms (${eduChunks.length}) ---`);
  for (const c of eduChunks) {
    // Pull just the relevant snippet
    const m = c.content.match(/.{0,80}(bachelor|B\.S\.|B\.A\.|MBA|M\.B\.A|university|college).{0,80}/i);
    const snippet = m ? m[0].replace(/\s+/g, " ").trim() : c.content.slice(0, 200);
    console.log(`  doc=${c.name}`);
    console.log(`    "${snippet}"`);
  }

  // 4) Live vector search: "bachelor's degree" → nearest facts in KB
  console.log(`\n--- Live vector search: "bachelor's degree" → top 8 nearest facts ---`);
  const { embeddings } = await embedTexts(["bachelor's degree", "B.S. degree", "bachelor's in computer science"]);
  for (let i = 0; i < embeddings.length; i++) {
    const query = ["bachelor's degree", "B.S. degree", "bachelor's in computer science"][i];
    const vec = `[${embeddings[i].join(",")}]`;
    const rows = (await sql.query(
      `
      SELECT id, fact_type, content, 1 - (embedding <=> $1::vector) AS similarity
      FROM kb_facts
      ORDER BY embedding <=> $1::vector
      LIMIT 8
    `,
      [vec],
    )) as Array<{ id: string; fact_type: string; content: string; similarity: number }>;
    console.log(`\n  Query: "${query}"`);
    for (const r of rows) {
      console.log(`    sim=${r.similarity.toFixed(3)}  [${r.fact_type}]  ${r.content.slice(0, 130)}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
