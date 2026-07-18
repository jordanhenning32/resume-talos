// Targeted KB cleanup:
//   1. Delete sample-bio* test fixtures + all their facts/chunks
//   2. Belt-and-suspenders sweep of any remaining Acumen / Memphis facts
//   3. Consolidate duplicate role facts within (canonical-company × similar-role) groups
//   4. Normalize "SSA" → "Social Security Administration" on remaining facts
//   5. Report final state.
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { neon } from "@neondatabase/serverless";

const TEST_FIXTURE_DOC_NAMES = ["sample-bio.txt", "sample-bio-v2.txt"];

type Embedding = number[];

function parseVectorLiteral(v: unknown): Embedding | null {
  if (Array.isArray(v)) return v as number[];
  if (typeof v !== "string") return null;
  // pgvector returns "[0.1, 0.2, ...]" string form via neon HTTP.
  return v
    .replace(/[[\]]/g, "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
}

function cosine(a: Embedding, b: Embedding): number {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const den = Math.sqrt(na) * Math.sqrt(nb);
  return den === 0 ? 0 : dot / den;
}

function normalizeCompany(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (/^ssa\b/i.test(t) || /social security/i.test(t)) return "Social Security Administration";
  if (/^u\.?s\.?\s*army/i.test(t) || /101st airborne/i.test(t)) return "U.S. Army";
  if (/quadratic/i.test(t)) return "Quadratic Digital";
  if (/mtd/i.test(t)) return "MTD Products";
  return t;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  const sql = neon(process.env.DATABASE_URL);

  // ─────────────────────────────────────────────
  // Phase 1: delete sample-bio* documents
  // ─────────────────────────────────────────────
  console.log("\n──── Phase 1: Delete sample-bio test fixtures ────");
  for (const name of TEST_FIXTURE_DOC_NAMES) {
    const docs = await sql`SELECT id, name FROM kb_documents WHERE name = ${name}` as Array<{ id: string; name: string }>;
    for (const doc of docs) {
      // kb_facts has ON DELETE SET NULL — explicitly delete dependent facts first.
      const factRes = await sql`DELETE FROM kb_facts WHERE document_id = ${doc.id} RETURNING id` as Array<{ id: string }>;
      const chunkRes = await sql`DELETE FROM kb_chunks WHERE document_id = ${doc.id} RETURNING id` as Array<{ id: string }>;
      await sql`DELETE FROM kb_documents WHERE id = ${doc.id}`;
      console.log(`  ✗ deleted "${doc.name}": ${factRes.length} facts, ${chunkRes.length} chunks`);
    }
  }

  // ─────────────────────────────────────────────
  // Phase 2: sweep any orphan-ish facts still mentioning the bad companies/schools
  // ─────────────────────────────────────────────
  console.log("\n──── Phase 2: Sweep remaining Acumen / Memphis facts ────");
  const orphans = await sql`
    DELETE FROM kb_facts
    WHERE (content ILIKE '%acumen%' OR evidence_quote ILIKE '%acumen%' OR (metadata->>'company') ILIKE '%acumen%')
       OR (content ILIKE '%university of memphis%' OR evidence_quote ILIKE '%university of memphis%')
    RETURNING id, content
  ` as Array<{ id: string; content: string }>;
  console.log(`  Removed ${orphans.length} stray facts:`);
  for (const f of orphans) console.log(`    - ${f.content.slice(0, 90)}`);

  // ─────────────────────────────────────────────
  // Phase 3: normalize company names on remaining role facts
  // ─────────────────────────────────────────────
  console.log("\n──── Phase 3: Normalize company names ────");
  const factsWithCompany = await sql`
    SELECT id, metadata FROM kb_facts WHERE fact_type = 'role' AND metadata->>'company' IS NOT NULL
  ` as Array<{ id: string; metadata: Record<string, unknown> }>;
  let normalizedCount = 0;
  for (const f of factsWithCompany) {
    const original = (f.metadata.company as string | undefined) ?? null;
    const norm = normalizeCompany(original);
    if (norm && norm !== original) {
      const newMeta = { ...f.metadata, company: norm };
      await sql`UPDATE kb_facts SET metadata = ${JSON.stringify(newMeta)}::jsonb WHERE id = ${f.id}`;
      normalizedCount++;
    }
  }
  console.log(`  ✓ Normalized company name on ${normalizedCount} role facts`);

  // ─────────────────────────────────────────────
  // Phase 4: consolidate duplicate role facts
  // Within (normalized_company), cluster role facts by embedding similarity > 0.78
  // and keep the single most detailed entry per cluster.
  // ─────────────────────────────────────────────
  console.log("\n──── Phase 4: Consolidate role-fact duplicates ────");
  const roleFacts = await sql`
    SELECT
      id,
      content,
      evidence_quote,
      metadata,
      embedding,
      length(content) as content_len
    FROM kb_facts
    WHERE fact_type = 'role'
  ` as Array<{
    id: string;
    content: string;
    evidence_quote: string | null;
    metadata: Record<string, unknown>;
    embedding: unknown;
    content_len: number;
  }>;

  // Score each role: presence of dates > evidence quote > length
  function score(f: typeof roleFacts[number]): number {
    const md = f.metadata as { startDate?: string; endDate?: string };
    let s = 0;
    if (md.startDate) s += 100;
    if (md.endDate) s += 100;
    if (f.evidence_quote) s += 30;
    s += f.content_len;
    return s;
  }

  // Bucket by normalized company. Null company gets its own bucket.
  const buckets = new Map<string, typeof roleFacts>();
  for (const f of roleFacts) {
    const company = (f.metadata.company as string | undefined) ?? "__nocompany__";
    if (!buckets.has(company)) buckets.set(company, []);
    buckets.get(company)!.push(f);
  }

  const toDelete = new Set<string>();
  for (const [company, facts] of buckets) {
    if (facts.length <= 1) continue;
    // Sort by score desc so the strongest entry is candidate-zero in each cluster.
    facts.sort((a, b) => score(b) - score(a));
    const remaining = [...facts];
    const clusters: (typeof roleFacts)[] = [];
    const SIM_THRESHOLD = 0.78;
    while (remaining.length > 0) {
      const head = remaining.shift()!;
      const cluster = [head];
      const headEmb = parseVectorLiteral(head.embedding);
      if (!headEmb) continue;
      for (let i = remaining.length - 1; i >= 0; i--) {
        const other = remaining[i];
        const oEmb = parseVectorLiteral(other.embedding);
        if (!oEmb) continue;
        if (cosine(headEmb, oEmb) > SIM_THRESHOLD) {
          cluster.push(other);
          remaining.splice(i, 1);
        }
      }
      clusters.push(cluster);
    }
    for (const cluster of clusters) {
      if (cluster.length <= 1) continue;
      // Keep cluster[0] (highest score), delete the rest.
      const keeper = cluster[0];
      console.log(`  [${company}] cluster of ${cluster.length}:`);
      console.log(`    KEEP: ${keeper.content.slice(0, 100)}`);
      for (let i = 1; i < cluster.length; i++) {
        toDelete.add(cluster[i].id);
        console.log(`    drop: ${cluster[i].content.slice(0, 100)}`);
      }
    }
  }

  if (toDelete.size === 0) {
    console.log("  (no duplicate role facts to drop)");
  } else {
    const ids = Array.from(toDelete);
    await sql`DELETE FROM kb_facts WHERE id = ANY(${ids})`;
    console.log(`  ✓ Deleted ${ids.length} duplicate role facts.`);
  }

  // ─────────────────────────────────────────────
  // Phase 5: final report
  // ─────────────────────────────────────────────
  console.log("\n──── Final state ────");
  const totals = await sql`
    SELECT
      (SELECT count(*)::int FROM kb_documents) as docs,
      (SELECT count(*)::int FROM kb_chunks)    as chunks,
      (SELECT count(*)::int FROM kb_facts)     as facts
  `;
  console.table(totals);

  const distribution = await sql`
    SELECT fact_type, count(*)::int as count
    FROM kb_facts
    GROUP BY fact_type
    ORDER BY count DESC
  `;
  console.table(distribution);

  console.log("\n=== Companies in remaining role facts ===");
  const companies = await sql`
    SELECT DISTINCT metadata->>'company' as company, count(*)::int as count
    FROM kb_facts
    WHERE fact_type = 'role'
    GROUP BY metadata->>'company'
    ORDER BY count DESC
  `;
  console.table(companies);

  console.log("\n=== Education facts (should be exactly 2: Kent State CIS + Malone MBA) ===");
  const edu = await sql`SELECT content FROM kb_facts WHERE fact_type = 'education'`;
  for (const r of edu as Array<{ content: string }>) console.log(`  • ${r.content}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
