import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env" });

import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  console.log("\n========== KB HEALTH AUDIT ==========\n");

  // 1. Aggregate counts
  const [counts] = (await sql`
    SELECT
      (SELECT COUNT(*) FROM kb_documents) AS docs,
      (SELECT COUNT(*) FROM kb_documents WHERE metadata->>'kind' = 'voice') AS voice_docs,
      (SELECT COUNT(*) FROM kb_documents WHERE metadata->>'kind' IS NULL OR metadata->>'kind' = 'facts') AS facts_docs,
      (SELECT COUNT(*) FROM kb_chunks) AS chunks,
      (SELECT COUNT(*) FROM kb_facts) AS facts
  `) as Array<{
    docs: number;
    voice_docs: number;
    facts_docs: number;
    chunks: number;
    facts: number;
  }>;
  console.log(`📦 Storage:`);
  console.log(`   ${counts.docs} documents (${counts.facts_docs} facts-kind, ${counts.voice_docs} voice-kind)`);
  console.log(`   ${counts.chunks} chunks · ${counts.facts} facts`);

  // 2. Fact-type distribution
  console.log(`\n🏷️  Fact-type distribution:`);
  const typeDist = (await sql`
    SELECT fact_type, COUNT(*)::int AS n
    FROM kb_facts
    GROUP BY fact_type
    ORDER BY n DESC
  `) as Array<{ fact_type: string; n: number }>;
  for (const r of typeDist) {
    const bar = "█".repeat(Math.min(40, Math.round(r.n / 5)));
    console.log(`   ${r.fact_type.padEnd(16)} ${r.n.toString().padStart(4)}  ${bar}`);
  }

  // 3. Documents that failed extraction (0 facts)
  const failedDocs = (await sql`
    SELECT d.id, d.name, d.metadata,
      0 AS fact_count,
      (SELECT COUNT(*) FROM kb_chunks WHERE document_id = d.id)::int AS chunk_count
    FROM kb_documents d
    WHERE (d.metadata->>'kind' IS NULL OR d.metadata->>'kind' = 'facts')
      AND NOT EXISTS (SELECT 1 FROM kb_facts WHERE document_id = d.id)
      AND EXISTS (SELECT 1 FROM kb_chunks WHERE document_id = d.id)
    LIMIT 10
  `) as Array<{
    id: string;
    name: string;
    metadata: any;
    fact_count: number;
    chunk_count: number;
  }>;
  console.log(`\n⚠️  Facts-kind docs with chunks but 0 extracted facts:`);
  if (failedDocs.length === 0) {
    console.log(`   (none — fact extractor handled every facts-kind doc)`);
  } else {
    for (const d of failedDocs) {
      console.log(`   ${d.name}  (${d.chunk_count} chunks, 0 facts)`);
    }
  }

  // 4. Very-near-duplicate fact clusters (sim > 0.92, same type)
  console.log(`\n🔍 Near-duplicate fact pairs (sim > 0.92, same type):`);
  const dupes = (await sql`
    SELECT
      f1.id AS id1, f1.content AS c1, f1.fact_type AS t,
      f2.id AS id2, f2.content AS c2,
      1 - (f1.embedding <=> f2.embedding) AS sim
    FROM kb_facts f1
    JOIN kb_facts f2 ON f1.id < f2.id AND f1.fact_type = f2.fact_type
    WHERE 1 - (f1.embedding <=> f2.embedding) > 0.92
    ORDER BY sim DESC
    LIMIT 12
  `) as Array<{ id1: string; c1: string; id2: string; c2: string; t: string; sim: number }>;
  if (dupes.length === 0) {
    console.log(`   (none — dedup pass holding)`);
  } else {
    for (const d of dupes) {
      console.log(`   [${d.t}] sim=${d.sim.toFixed(3)}`);
      console.log(`     A: ${d.c1.slice(0, 120)}`);
      console.log(`     B: ${d.c2.slice(0, 120)}`);
    }
  }

  // 5. Facts with suspicious content quality
  const emptyEvidence = (await sql`
    SELECT COUNT(*)::int AS n FROM kb_facts WHERE evidence_quote IS NULL OR length(trim(evidence_quote)) < 10
  `) as Array<{ n: number }>;
  const shortContent = (await sql`
    SELECT COUNT(*)::int AS n FROM kb_facts WHERE length(content) < 30
  `) as Array<{ n: number }>;
  console.log(`\n🔬 Fact quality:`);
  console.log(`   ${emptyEvidence[0].n} facts with missing/very-short evidence quote (< 10 chars)`);
  console.log(`   ${shortContent[0].n} facts with very short content (< 30 chars)`);

  // 6. Recent agent_runs failures
  const recentFailures = (await sql`
    SELECT agent_name, COUNT(*)::int AS n,
      MAX(started_at) AS latest
    FROM agent_runs
    WHERE status = 'failed' AND started_at > NOW() - INTERVAL '14 days'
    GROUP BY agent_name
    ORDER BY n DESC
  `) as Array<{ agent_name: string; n: number; latest: string }>;
  console.log(`\n💥 Agent-run failures in last 14 days:`);
  if (recentFailures.length === 0) {
    console.log(`   (none)`);
  } else {
    for (const r of recentFailures) {
      console.log(`   ${r.agent_name.padEnd(36)} ${r.n.toString().padStart(3)}  last: ${r.latest}`);
    }
  }

  // 7. Recent Haiku-using runs (verifier / fit_score / knockout / kb_gap)
  console.log(`\n🤖 Recent runs by Haiku-routed roles (status + cost):`);
  const haikuRuns = (await sql`
    SELECT agent_name, model, status,
      AVG(cost_usd)::float AS avg_cost,
      AVG(EXTRACT(EPOCH FROM (completed_at - started_at)))::float AS avg_seconds,
      COUNT(*)::int AS n
    FROM agent_runs
    WHERE agent_name IN ('verifier', 'fit_scorer', 'fit_score', 'knockout_detector', 'kb_gap_query_expander')
      AND started_at > NOW() - INTERVAL '14 days'
    GROUP BY agent_name, model, status
    ORDER BY agent_name, n DESC
  `) as Array<{
    agent_name: string;
    model: string;
    status: string;
    avg_cost: number;
    avg_seconds: number;
    n: number;
  }>;
  for (const r of haikuRuns) {
    console.log(
      `   ${r.agent_name.padEnd(28)} model=${(r.model ?? "?").padEnd(20)} ${r.status.padEnd(9)} n=${r.n} avg=$${(r.avg_cost ?? 0).toFixed(4)} ${(r.avg_seconds ?? 0).toFixed(1)}s`,
    );
  }

  // 8. Cross-run variance for fit_scorer on the SAME application (the
  //    user's symptom: "different results on the same application").
  console.log(`\n📊 fit_scorer cross-run variance per application (last 14 days):`);
  const fitVariance = (await sql`
    SELECT a.id, a.role, a.company,
      COUNT(*)::int AS runs,
      MAX(ar.cost_usd)::float AS max_cost,
      MIN(ar.cost_usd)::float AS min_cost
    FROM agent_runs ar
    JOIN applications a ON a.id = ar.application_id
    WHERE ar.agent_name IN ('fit_scorer', 'fit_score')
      AND ar.status = 'completed'
      AND ar.started_at > NOW() - INTERVAL '14 days'
    GROUP BY a.id, a.role, a.company
    HAVING COUNT(*) > 1
    ORDER BY runs DESC
  `) as Array<{
    id: string;
    role: string;
    company: string;
    runs: number;
    max_cost: number;
    min_cost: number;
  }>;
  if (fitVariance.length === 0) {
    console.log(`   (no application has been fit-scored more than once recently)`);
  } else {
    for (const r of fitVariance) {
      console.log(
        `   ${r.runs}× scored — ${r.role} @ ${r.company} (id=${r.id})`,
      );
    }
  }

  // 9. KB-coverage cache freshness — when was the last scan and how stale?
  console.log(`\n🗂️  Cached KB-coverage report freshness (per application):`);
  const cacheFresh = (await sql`
    SELECT id, role, company,
      kb_gap_report_at,
      knockout_report_at,
      recruiter_screener_at,
      EXTRACT(EPOCH FROM (NOW() - kb_gap_report_at))::int AS kb_age_s,
      EXTRACT(EPOCH FROM (NOW() - knockout_report_at))::int AS ko_age_s
    FROM applications
    WHERE status NOT IN ('withdrawn','rejected','ghosted')
      AND (kb_gap_report IS NOT NULL OR knockout_report IS NOT NULL)
    ORDER BY updated_at DESC
    LIMIT 6
  `) as Array<{
    id: string;
    role: string;
    company: string;
    kb_age_s: number | null;
    ko_age_s: number | null;
  }>;
  for (const r of cacheFresh) {
    const kbAge = r.kb_age_s ? `${(r.kb_age_s / 3600).toFixed(1)}h` : "—";
    const koAge = r.ko_age_s ? `${(r.ko_age_s / 3600).toFixed(1)}h` : "—";
    console.log(
      `   ${r.role.slice(0, 50).padEnd(50)} kb-gap=${kbAge.padEnd(7)} knockout=${koAge}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
