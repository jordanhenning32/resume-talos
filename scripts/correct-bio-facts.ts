/**
 * Candidate-confirmed bio corrections to the live KB (2026-06-18):
 *  1. Military: "three combat tours in Iraq and Afghanistan" -> ONE combat tour in Iraq
 *     (Bronze Star + Purple Heart unchanged).
 *  2. Futures Bot: remove unverifiable performance claims (62% win / ~500–503 trades /
 *     net-positive PnL / "live since Feb 2026"); keep it as a personal multi-agent build.
 *  3. Delete one hallucinated junk fact ("whistleblower retaliation complaint processing").
 *  4. AWS Certified AI Practitioner year 2025 -> 2026.
 *
 * Reframes re-embed and stamp metadata.bioCorrected + bioContentRaw for rollback.
 * The delete is backed up first. Idempotent on re-run.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env", override: true });

import { writeFileSync } from "fs";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { kbFacts } from "@/db/schema";
import { embedText } from "@/lib/models/embed";

const STAMP = "2026-06-18";

function fixTours(s: string): string {
  let out = s;
  out = out.replace(/three combat tours in Iraq and Afghanistan/gi, "one combat tour in Iraq");
  out = out.replace(/three tours in Iraq and Afghanistan/gi, "one combat tour in Iraq");
  out = out.replace(/three combat tours/gi, "one combat tour in Iraq");
  out = out.replace(/three tours/gi, "one combat tour in Iraq");
  out = out.replace(/Iraq and Afghanistan/gi, "Iraq");
  out = out.replace(/\bin Iraq in Iraq\b/gi, "in Iraq");
  return out;
}

// Tailored Futures Bot rewrites (perf claims removed, build kept).
const FUTURES: Array<{ id: string; content: string }> = [
  {
    id: "OdLOsn0AhbmMhaepcBUbH",
    content:
      "Futures Bot is a personal multi-agent trading desk that ingests market data, generates signals, manages risk, and manages orders autonomously across a 24-hour cycle — built end-to-end as an R&D platform for multi-agent design patterns.",
  },
  {
    id: "d6FsvkXrD7sW_HWf5tssF",
    content:
      "Futures Bot includes operator-level analytics with equity-curve and drawdown observability.",
  },
  {
    id: "wt_lUmtz5kOKp5DxGs-lv",
    content:
      "Futures Bot is a personal multi-agent trading desk built end-to-end as an R&D platform for pressure-testing multi-agent system design.",
  },
  {
    id: "T--_ogSg0l2bxsjfYPQui",
    content:
      "Futures Bot autonomously runs a multi-agent trading loop across a 24-hour cycle, with hard-coded risk guardrails and operator-level observability.",
  },
  {
    id: "6i6WmiRaS_f5M43vS2ulh",
    content:
      "Built Futures Bot — a personal multi-agent trading desk (an agent committee for signal generation, risk management, and execution), designed end-to-end to pressure-test multi-agent system patterns under live-market conditions.",
  },
];

const DELETE_IDS = ["n7tjOSU_-4733qXXf9Qj_"];
const AWS_ID = "MY2K6Oo3q0VoT5BFDh0b6";

async function reframe(id: string, content: string, raw: string) {
  const { embedding } = await embedText(content);
  await db()
    .update(kbFacts)
    .set({
      content,
      embedding,
      metadata: sql`${kbFacts.metadata} || ${JSON.stringify({
        bioCorrected: "true",
        bioCorrectedAt: STAMP,
        bioContentRaw: raw,
      })}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(kbFacts.id, id));
}

async function main() {
  // 1. Military — find all three-tours / Afghanistan facts and fix.
  const mil = (await db()
    .select({ id: kbFacts.id, content: kbFacts.content, metadata: kbFacts.metadata })
    .from(kbFacts)
    .where(
      sql`${kbFacts.content} ILIKE '%three combat tour%' OR ${kbFacts.content} ILIKE '%three tours%' OR ${kbFacts.content} ILIKE '%Afghanistan%'`,
    )) as Array<{ id: string; content: string; metadata: Record<string, unknown> | null }>;
  let milFixed = 0;
  for (const f of mil) {
    if (f.metadata?.bioCorrected === "true") continue;
    const next = fixTours(f.content);
    if (next === f.content) continue;
    await reframe(f.id, next, f.content);
    console.log(`MILITARY ${f.id}\n   old: ${f.content}\n   new: ${next}\n`);
    milFixed++;
  }

  // 2. Futures Bot perf scrub.
  let futFixed = 0;
  for (const r of FUTURES) {
    const [row] = await db()
      .select({ content: kbFacts.content, metadata: kbFacts.metadata })
      .from(kbFacts)
      .where(eq(kbFacts.id, r.id))
      .limit(1);
    if (!row) { console.log(`SKIP futures ${r.id} — not found`); continue; }
    if (row.metadata?.bioCorrected === "true") { console.log(`SKIP futures ${r.id} — already`); continue; }
    await reframe(r.id, r.content, row.content);
    console.log(`FUTURES ${r.id}`);
    futFixed++;
  }

  // 3. Delete junk fact (backup first).
  const backup = await db()
    .select()
    .from(kbFacts)
    .where(inArray(kbFacts.id, DELETE_IDS));
  if (backup.length > 0) {
    const safe = backup.map(({ embedding, ...rest }) => rest);
    writeFileSync(`.pipeline/bio-deletes-backup-${STAMP}.json`, JSON.stringify(safe, null, 2));
  }
  const del = await db().delete(kbFacts).where(inArray(kbFacts.id, DELETE_IDS)).returning({ id: kbFacts.id });

  // 4. AWS year 2025 -> 2026.
  const [aws] = await db()
    .select({ content: kbFacts.content })
    .from(kbFacts)
    .where(eq(kbFacts.id, AWS_ID))
    .limit(1);
  if (aws) {
    const newContent = aws.content.replace(/2025/g, "2026");
    const { embedding } = await embedText(newContent);
    await db()
      .update(kbFacts)
      .set({
        content: newContent,
        embedding,
        metadata: sql`${kbFacts.metadata} || ${JSON.stringify({ year: "2026" })}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(kbFacts.id, AWS_ID));
    console.log(`AWS year -> 2026`);
  }

  // Verify no Futures perf tokens remain.
  const leftover = (await db()
    .select({ id: kbFacts.id, content: kbFacts.content })
    .from(kbFacts)
    .where(
      sql`${kbFacts.content} ILIKE '%62% win%' OR ${kbFacts.content} ILIKE '%win rate%' OR ${kbFacts.content} ILIKE '%503 trades%' OR ${kbFacts.content} ILIKE '%net-positive%' OR ${kbFacts.content} ILIKE '%~500 trades%'`,
    )) as Array<{ id: string; content: string }>;
  if (leftover.length) {
    console.log(`\nWARN — perf tokens still present in ${leftover.length} fact(s):`);
    for (const l of leftover) console.log(`  [${l.id}] ${l.content.slice(0, 120)}`);
  }

  console.log(`\nDone. military=${milFixed} futures=${futFixed} deleted=${del.length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
