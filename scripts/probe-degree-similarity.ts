import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env" });
import { neon } from "@neondatabase/serverless";
import { embedTexts } from "@/lib/models/embed";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const candidates = [
    "bachelor's degree",
    "undergraduate degree",
    "four-year degree",
    "bachelor's qualification",
    "B.A.",
    "B.S.",
    "BA",
    "BS",
    "Bachelor of Arts",
    "Bachelor of Science",
    "B.A. degree",
    "B.S. degree",
    "bachelor's in computer science",
    "bachelor's in computer information systems",
  ];
  const { embeddings } = await embedTexts(candidates);
  console.log("Cosine similarity to the B.A. fact:\n");
  for (let i = 0; i < candidates.length; i++) {
    const vec = `[${embeddings[i].join(",")}]`;
    const rows = (await sql.query(
      `
      SELECT 1 - (embedding <=> $1::vector) AS sim
      FROM kb_facts
      WHERE content = 'Earned a B.A. in Computer Information Systems from Kent State University in 2008.'
      LIMIT 1
    `,
      [vec],
    )) as Array<{ sim: number }>;
    const sim = rows[0]?.sim ?? 0;
    const tag = sim >= 0.5 ? "✓" : " ";
    console.log(`  ${tag} sim=${sim.toFixed(3)}  "${candidates[i]}"`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
