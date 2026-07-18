// Comprehensive KB audit — assess whether there's enough grounded content
// to produce a strong resume + cover letter, and where the gaps are.
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { neon } from "@neondatabase/serverless";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  const sql = neon(process.env.DATABASE_URL);

  // 1. Fact type distribution
  console.log("\n=== Fact type distribution ===");
  const dist = await sql`
    SELECT fact_type, count(*)::int as count
    FROM kb_facts
    GROUP BY fact_type
    ORDER BY count DESC
  `;
  console.table(dist);

  // 2. Facts with quantified metrics
  console.log("\n=== Achievements with metrics (impact density) ===");
  const withMetrics = await sql`
    SELECT
      count(*) FILTER (
        WHERE fact_type = 'achievement'
          AND jsonb_array_length(coalesce(metadata->'metrics', '[]'::jsonb)) > 0
      )::int as achievements_with_metrics,
      count(*) FILTER (WHERE fact_type = 'achievement')::int as achievements_total
    FROM kb_facts
  `;
  console.table(withMetrics);

  // 3. Role coverage (companies + date ranges)
  console.log("\n=== Roles by company / date range ===");
  const roles = await sql`
    SELECT
      DISTINCT metadata->>'company' as company,
      metadata->>'role' as role,
      metadata->>'startDate' as start_date,
      metadata->>'endDate' as end_date
    FROM kb_facts
    WHERE fact_type = 'role'
      AND metadata->>'company' IS NOT NULL
    ORDER BY start_date DESC NULLS LAST
  `;
  console.table(roles);

  // 4. Distinct skills + tools
  console.log("\n=== Skills + tools coverage ===");
  const skillsTools = await sql`
    SELECT fact_type, count(DISTINCT content)::int as distinct_count
    FROM kb_facts
    WHERE fact_type IN ('skill', 'tool')
    GROUP BY fact_type
  `;
  console.table(skillsTools);

  // 5. Date span — earliest and latest roles
  console.log("\n=== Career date span (from role facts) ===");
  const dateSpan = await sql`
    SELECT
      min(metadata->>'startDate') as earliest_start,
      max(metadata->>'endDate') as latest_end,
      count(DISTINCT metadata->>'company') filter (where metadata->>'company' is not null) as distinct_companies
    FROM kb_facts
    WHERE fact_type = 'role'
  `;
  console.table(dateSpan);

  // 6. Story / context facts — the qualitative narrative material
  console.log("\n=== Narrative material (stories + context) ===");
  const narrative = await sql`
    SELECT fact_type, count(*)::int as count
    FROM kb_facts
    WHERE fact_type IN ('story', 'context')
    GROUP BY fact_type
  `;
  console.table(narrative);

  console.log("\n=== Sample of 'context' facts (target roles / preferences) ===");
  const contextFacts = await sql`
    SELECT content
    FROM kb_facts
    WHERE fact_type = 'context'
    ORDER BY length(content) DESC
    LIMIT 8
  `;
  for (const row of contextFacts as Array<{ content: string }>) {
    console.log(`  • ${row.content}`);
  }

  // 7. Top 8 strongest achievements (by metric count)
  console.log("\n=== Top achievements with quantified impact ===");
  const topAch = await sql`
    SELECT content, jsonb_array_length(coalesce(metadata->'metrics', '[]'::jsonb)) as metric_count
    FROM kb_facts
    WHERE fact_type = 'achievement'
    ORDER BY metric_count DESC, length(content) DESC
    LIMIT 8
  `;
  for (const row of topAch as Array<{ content: string; metric_count: number }>) {
    console.log(`  [${row.metric_count}m] ${row.content}`);
  }

  // 8. Projects
  console.log("\n=== Projects ===");
  const projects = await sql`
    SELECT DISTINCT ON (content)
      content,
      metadata->>'company' as company
    FROM kb_facts
    WHERE fact_type = 'project'
    ORDER BY content
  `;
  for (const row of projects as Array<{ content: string; company: string | null }>) {
    console.log(`  • ${row.content}${row.company ? ` — ${row.company}` : ""}`);
  }

  // 9. Education + certifications
  console.log("\n=== Education ===");
  const edu = await sql`
    SELECT DISTINCT ON (content) content FROM kb_facts WHERE fact_type = 'education'
  `;
  for (const row of edu as Array<{ content: string }>) console.log(`  • ${row.content}`);

  console.log("\n=== Certifications ===");
  const certs = await sql`
    SELECT DISTINCT ON (content) content FROM kb_facts WHERE fact_type = 'certification'
  `;
  for (const row of certs as Array<{ content: string }>) console.log(`  • ${row.content}`);

  // 10. Tag cloud (top 25)
  console.log("\n=== Top tags (signals of topical coverage) ===");
  const tags = await sql`
    SELECT tag, count(*)::int as count
    FROM kb_facts, jsonb_array_elements_text(coalesce(metadata->'tags', '[]'::jsonb)) as t(tag)
    GROUP BY tag
    ORDER BY count DESC
    LIMIT 25
  `;
  console.table(tags);
}

main().catch((e) => { console.error(e); process.exit(1); });
