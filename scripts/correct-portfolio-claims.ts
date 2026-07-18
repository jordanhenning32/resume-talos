/**
 * Consolidate the $200M / portfolio facts in the live KB (Option B).
 *
 * Ground truth (per candidate, 2026-06-18): the $200M+ figure is CUMULATIVE IT
 * project value delivered over the ~5-year IT Project Manager tenure (2016-2022)
 * — NOT a standing/concurrent portfolio, and NOT a Branch Chief portfolio. The
 * KB had 38 portfolio facts: mostly redundant "standing $200M portfolio"
 * variants (many duplicate quick-add notes) plus one hallucinated junk fact.
 *
 * Actions: reframe 8 to accurate framing (+ detach $200M from Branch Chief),
 * delete 21 redundant/junk facts (backed up to JSON first), refine + pin the
 * portfolio guardrail. Reframes stamp metadata.portfolioCorrected +
 * portfolioContentRaw for rollback; deletes are recoverable from the backup.
 *
 * Idempotent: reframes skip if already portfolioCorrected; deletes no-op once
 * the rows are gone.
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

const REFRAMES: Array<{ id: string; content: string }> = [
  {
    id: "1UmQ6ygbM0chAi3im9Bs4",
    content:
      "As IT Project Manager (2016–2022), delivered $200M+ in IT projects cumulatively over the tenure — on-time and under-budget — generating millions in savings across nationwide claims and hearings systems.",
  },
  {
    id: "BDj2QcR0dK0eGiZ_q-JcE",
    content:
      "Ran up to 7 concurrent IT projects at peak as IT Project Manager, managing full scope, resources, risks, dependencies, and stakeholder alignment.",
  },
  {
    id: "9_SfG_64mLBSErIkekTdm",
    content:
      "As IT Project Manager, delivered major SSA IT modernizations: agency-wide Tableau + WebFocus BI platform, Centralized Print consolidation, and Appeals Database consolidation (7 legacy systems into 1).",
  },
  {
    id: "1QCOrZFITWgmwU7cuwfPL",
    content:
      "As IT Project Manager, evaluated alternatives for complex IT issues through alternatives analysis, vendor evaluations, cost-benefit assessments, and stakeholder consultations — improving system efficiency across mission-critical platforms.",
  },
  {
    // Detach $200M from Branch Chief.
    id: "4w5IP2Sv9KLpXlhRDq1Pg",
    content:
      "Federal IT management experience — 12 direct reports (including 2 team leads) — spanning 170 nationwide offices.",
  },
  {
    // Detach $200M from Branch Chief.
    id: "LLiQnt1F-YbohLdKBu7EO",
    content:
      "As SSA Branch Chief, owned the full project artifact suite (charters, RAID logs, release notes) across the field IT portfolio.",
  },
  {
    id: "zs7DZV8A7SCttE3Qy17XN",
    content:
      "Target roles: VP/Director Federal Services Delivery, GM Federal AI Services, or Senior Director Federal Programs at federal primes and services firms — where 99.9% uptime discipline, federal portfolio delivery at scale, and hands-on AI capability all matter together.",
  },
];

const GUARDRAIL = {
  id: "K-kTU3yyhi4hVsyxWwuS7",
  content:
    "PORTFOLIO SCOPE GUARDRAIL (federal scale, not corporate P&L): the $200M+ figure is CUMULATIVE IT project value delivered over the ~5-year IT Project Manager tenure (2016–2022) — NOT a standing/concurrent portfolio and NOT a Branch Chief portfolio. It is spending-side delivery (appropriated federal dollars, on-time/under-budget, 99.9% availability), NOT revenue/margin P&L ownership. At Quadratic Digital (CGO) the budget is small-startup scale. When VP/Director Federal Services Delivery JDs require $50M+ P&L ownership, treat this as a real accountability gap, not a stretchable claim: lead with portfolio scope and delivery discipline, name the distinction honestly, and position the CGO role as the bridge into corporate P&L.",
};

const DELETE_IDS = [
  "GOZf3K-HHlVHRj-MD13Br",
  "WYdUjSxqYKAZlc7UIpFDg",
  "RZv7lzITIqQIULQYEIck0",
  "-ehtyxJYIoVaCCBIDA_pj",
  "63P1xjJDhYQzQCwrgYcYx",
  "IPGuRz8LyPwp4jS_KMBA2",
  "ne52Lwnm3f9VlB2N2pylH",
  "HDhXy7f6l5LKCHwOPRi_X",
  "QH759i63VShqt9n4s-q_S",
  "RJNqLaReCmx2jziaA6wju",
  "3dN9tvPKI4XsZZOjyMyQo",
  "qMpeSIk7b34eoPXj1w1bK",
  "OC0rnnHrr0fxcWRxXi549",
  "EH7QWPwvo6iJfnCxUKW1E",
  "ZSb3ZUe3U_XatKL3Jaweh",
  "2FiDWHQEij3rIB5ITYbbo",
  "QeXzP8AFDk5NqPkPEIWVE",
  "bzRNdEa6q29vMGSU2TBwO",
  "28rhPs0KmQupS1aFDgFLj",
  "f8e-6bNXg83HKIg6mvgXJ",
  "1wfBgL2UXa2rEadwUjFjM",
];

async function main() {
  // 1. Back up the to-delete facts (everything except the embedding vector,
  //    which re-embeds trivially on restore).
  const backup = await db()
    .select({
      id: kbFacts.id,
      factType: kbFacts.factType,
      content: kbFacts.content,
      evidenceQuote: kbFacts.evidenceQuote,
      metadata: kbFacts.metadata,
      documentId: kbFacts.documentId,
      userAdded: kbFacts.userAdded,
      pinned: kbFacts.pinned,
    })
    .from(kbFacts)
    .where(inArray(kbFacts.id, DELETE_IDS));
  if (backup.length > 0) {
    const path = `.pipeline/portfolio-deletes-backup-${STAMP}.json`;
    writeFileSync(path, JSON.stringify(backup, null, 2));
    console.log(`Backed up ${backup.length} facts to ${path}`);
  }

  // 2. Reframes.
  let reframed = 0;
  for (const r of REFRAMES) {
    const [row] = await db()
      .select({ content: kbFacts.content, metadata: kbFacts.metadata })
      .from(kbFacts)
      .where(eq(kbFacts.id, r.id))
      .limit(1);
    if (!row) {
      console.log(`SKIP reframe ${r.id} — not found`);
      continue;
    }
    if ((row.metadata as Record<string, unknown> | null)?.portfolioCorrected === "true") {
      console.log(`SKIP reframe ${r.id} — already portfolioCorrected`);
      continue;
    }
    const { embedding } = await embedText(r.content);
    const patch = JSON.stringify({
      portfolioCorrected: "true",
      portfolioCorrectedAt: STAMP,
      portfolioContentRaw: row.content,
    });
    await db()
      .update(kbFacts)
      .set({
        content: r.content,
        embedding,
        metadata: sql`${kbFacts.metadata} || ${patch}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(kbFacts.id, r.id));
    console.log(`REFRAMED ${r.id}`);
    reframed++;
  }

  // 3. Guardrail — refine content + pin.
  const [g] = await db()
    .select({ content: kbFacts.content })
    .from(kbFacts)
    .where(eq(kbFacts.id, GUARDRAIL.id))
    .limit(1);
  if (!g) {
    console.log(`SKIP guardrail — ${GUARDRAIL.id} not found`);
  } else if (g.content === GUARDRAIL.content) {
    console.log(`SKIP guardrail — unchanged`);
  } else {
    const { embedding } = await embedText(GUARDRAIL.content);
    await db()
      .update(kbFacts)
      .set({
        content: GUARDRAIL.content,
        embedding,
        pinned: "true",
        metadata: sql`${kbFacts.metadata} || ${JSON.stringify({
          portfolioGuardrail: "true",
          contentRaw: g.content,
          correctedAt: STAMP,
        })}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(kbFacts.id, GUARDRAIL.id));
    console.log(`UPDATED + PINNED guardrail ${GUARDRAIL.id}`);
  }

  // 4. Deletes.
  const del = await db()
    .delete(kbFacts)
    .where(inArray(kbFacts.id, DELETE_IDS))
    .returning({ id: kbFacts.id });

  console.log(`\nDone. reframed=${reframed} deleted=${del.length} (of ${DELETE_IDS.length})`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
