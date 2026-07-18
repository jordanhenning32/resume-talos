/**
 * Correct the SSA Branch Chief span-of-control facts in the live KB.
 *
 * Ground truth (per candidate, 2026-06-18): 12 DIRECT reports only. The 340
 * field IT technicians across 170 Hearings Offices were NOT direct or indirect
 * reports — the HQ team set their IT governance, policy, and standards. Several
 * KB facts (extracted from prior generated resumes) inflated this into "led a
 * 352-person organization" / "manager-of-managers overseeing 340 field IT
 * staff" / "340 indirect reports". This rewrites those to accurate framing,
 * re-embeds them, and adds one pinned guardrail fact.
 *
 * Idempotent: corrected facts are stamped metadata.spanCorrected; the guardrail
 * is tagged metadata.spanGuardrail. Re-running skips already-applied changes.
 * Rollback: prior content preserved in metadata.contentRaw.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env", override: true });

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { kbFacts } from "@/db/schema";
import { embedText } from "@/lib/models/embed";

const STAMP = "2026-06-18";

const EV =
  "Candidate correction (2026-06-18): span reflects 12 direct reports + governance/policy authority over a 340-technician field operation, not direct supervision of the 340.";

// id -> corrected content + evidence.
const CORRECTIONS: Array<{ id: string; content: string; evidence: string }> = [
  {
    id: "vw_Zf5udGQ8Zqs9wSk52n",
    content:
      "As Branch Chief, directly managed 12 reports and set IT governance, policy, and standards for a 340-technician field IT operation across 170 Hearings Offices serving 7,000+ SSA employees — governance authority over the field operation, not direct supervision of the 340 technicians.",
    evidence:
      "Candidate correction (2026-06-18): 12 direct reports; team set governance/policy/standards for 340 field IT techs (not direct supervision).",
  },
  {
    id: "fzq7ZpEN3jxhXUbwRA9-Y",
    content:
      "As Branch Chief, directly managed 12 reports while owning IT governance, policy, and standards for field IT operations across 170 nationwide Hearings Offices — a 340-technician field footprint serving 7,000+ employees at 99.9% availability. Did not directly supervise the 340 field technicians.",
    evidence:
      "Candidate correction (2026-06-18): 12 direct reports; governance/policy authority over a 340-technician field operation, not direct supervision.",
  },
  {
    id: "EQoB0d15dMBPMTQhAsNuo",
    content:
      "Achieved 100% retention across 12 direct reports over a three-year tenure as Branch Chief at SSA. The 340 field IT technicians were covered by the team's IT governance and policy, not direct or indirect reports.",
    evidence:
      "Candidate correction (2026-06-18): 100% retention applies to the 12 direct reports; the 340 field techs were not reports.",
  },
  {
    id: "UZ9E_XAR6A8vazuDov1jP",
    content:
      "Led a 12-person HQ IT oversight team that set governance, policy, and standards for a 340-technician field IT operation across 170 nationwide Hearings Offices, supporting 7,000+ employees at 99.9% availability — governance authority, not direct supervision of the field technicians.",
    evidence:
      "Candidate correction (2026-06-18): 12-person HQ team set governance/policy for the 340-technician field operation; not direct supervision.",
  },
  {
    id: "rK3fUu1It3lyl0wAA0NSp",
    content:
      "Branch Chief, Hearings Office IT Oversight: directly managed a 12-person HQ team and owned IT governance, policy, and standards for a 340-technician field IT operation across 170 nationwide offices serving 7,000+ employees at 99.9% availability.",
    evidence:
      "Candidate correction (2026-06-18): 12 direct reports; governance/policy/standards authority over a 340-technician field operation.",
  },
  {
    id: "N5aYE7VLrYeE0Q7PeWIGH",
    content:
      "Served at SSA for 17 years total, including 9+ years in federal IT leadership, culminating as Branch Chief directly managing 12 reports and owning IT governance, policy, and standards for a 340-technician field IT operation across 170 nationwide Hearings Offices.",
    evidence:
      "Candidate correction (2026-06-18): 17 years at SSA; Branch Chief with 12 direct reports and governance authority over the 340-technician field operation.",
  },
  {
    id: "8O6auvEpdfZz1IoN0F4S7",
    content:
      "As Branch Chief, directly managed a 12-person team and owned IT governance and oversight for field IT operations delivering mission-critical IT to 170 nationwide offices at 99.9%+ availability — governance/policy authority over a 340-technician field footprint, not a 352-person organization led directly.",
    evidence:
      "Candidate correction (2026-06-18): replaces the inflated '352-person organization' claim; 12 direct reports + governance over a 340-technician field operation.",
  },
  // Second pass — additional inflated facts across work-highlight docs and quick-add notes.
  {
    id: "hrVGWZxJ9ldpFt7MlBFET",
    content:
      "Led a 12-person team that set IT governance, policy, and standards for a 340-technician field IT operation, supporting the IT needs of 7,000+ SSA employees.",
    evidence: EV,
  },
  {
    id: "K2szMT3XHVNL8YyO0KEJg",
    content:
      "As Branch Chief, directly managed 12 reports and set IT governance, policy, and standards for a 340-technician field IT operation across 170 nationwide Hearings Offices serving 7,000+ SSA employees.",
    evidence: EV,
  },
  {
    id: "eeIlNvssktlaQdRTNey2Q",
    content:
      "Set IT governance, policy, and standards for a 340-technician field IT operation across 170 nationwide Hearings Offices.",
    evidence: EV,
  },
  {
    id: "pd7LhVb7AuBPgWYdIMjac",
    content:
      "Served as Branch Chief, setting IT governance, policy, standards, and resource coordination for a 340-technician field IT operation across 170 nationwide offices.",
    evidence: EV,
  },
  {
    id: "xNDzptef6T00sXKwqVHk3",
    content:
      "Led a 12-person HQ team and set IT governance and standards for a 340-technician field IT operation supporting IT services across 170 nationwide Hearings Offices.",
    evidence: EV,
  },
  {
    id: "Oi0o8dJ2JKh3JPwjD-aLy",
    content:
      "Owned IT governance and standards for the field IT infrastructure and administrative systems supporting 170+ SSA Hearings Offices nationwide (12 direct reports; 340-technician field operation).",
    evidence: EV,
  },
  {
    id: "LqvkVHEFXaUuRX3zzKOkf",
    content:
      "Directly managed 12 senior staff and set IT governance, policy, and standards for a ~340-technician field IT operation across 170 nationwide offices.",
    evidence: EV,
  },
  {
    id: "Qu07nf4nGv3Ov_j6Sg0gJ",
    content:
      "Responsible for making timely and accurate referral determinations for complaints across the field IT operation supporting 170 nationwide offices.",
    evidence: EV,
  },
  {
    id: "DgPE8w5eToBEyYBBZE5_i",
    content:
      "Served as Branch Chief, setting IT governance and standards for field IT operations spanning 170 nationwide offices (12 direct reports; 340-technician field operation).",
    evidence: EV,
  },
  {
    id: "Si2E3NS8A7mahCEbULaqD",
    content:
      "Anticipated future PM and leadership gaps across the field IT organization (170 offices, 340-technician field operation) and worked on leadership pipeline and organizational development.",
    evidence: EV,
  },
  {
    id: "uZHpJrAAPgQLcuXghn-NP",
    content:
      "Held a leadership position directly managing 12 reports and setting IT governance, policy, and standards for a 340-technician field IT operation across 170 hearing offices.",
    evidence: EV,
  },
  {
    id: "OAUYBINR0h_HVHKYWUwMG",
    content:
      "The HQ division set IT governance and standards for a 340-technician field IT operation responsible for delivering mission-critical IT services to 170 nationwide field offices.",
    evidence: EV,
  },
  // "manager-of-managers" softened: only 2 of the 12 direct reports were team
  // leads (the rest non-supervisory). $200M+ portfolio phrasing kept verbatim
  // — portfolio size is a separate, pending decision.
  {
    id: "4w5IP2Sv9KLpXlhRDq1Pg",
    content:
      "Federal IT management experience — 12 direct reports (including 2 team leads) — spanning 170 offices and a $200M+ portfolio.",
    evidence: EV,
  },
  {
    id: "Xn7tizHz3FZ6CKZl7dxCj",
    content:
      "Branch Chief was a leadership role — 12 direct reports including 2 team leads — with weekly shifting priorities including annual budget planning, field hiring, IT escalations, and performance-review cycles.",
    evidence: EV,
  },
];

const GUARDRAIL = {
  factType: "context" as const,
  content:
    "SPAN OF CONTROL — SSA Branch Chief (Hearings Office IT Oversight): 12 DIRECT reports only (2 team leads + 10 non-supervisory staff). The 340 field IT technicians across 170 nationwide Hearings Offices were NOT direct or indirect reports; the HQ team set their IT governance, policy, and standards. Accurate framing: 'directly managed 12 reports (including 2 team leads)' and 'set IT governance/policy/standards for a 340-technician field operation.' Do NOT write 'led/managed a 352-person organization', '340 reports', or lead with 'manager-of-managers' (only 2 of 12 reports were supervisors).",
  evidence:
    "Candidate correction (2026-06-18): authoritative statement of true span of control.",
  metadata: {
    company: "Social Security Administration",
    role: "Branch Chief, Hearings Office IT Oversight",
    spanGuardrail: "true",
    source: "candidate-correction",
    correctedAt: STAMP,
  },
};

async function main() {
  let corrected = 0;
  let skipped = 0;

  for (const c of CORRECTIONS) {
    const [row] = await db()
      .select({ content: kbFacts.content, metadata: kbFacts.metadata })
      .from(kbFacts)
      .where(eq(kbFacts.id, c.id))
      .limit(1);
    if (!row) {
      console.log(`SKIP ${c.id} — not found`);
      skipped++;
      continue;
    }
    if ((row.metadata as Record<string, unknown> | null)?.spanCorrected === "true") {
      console.log(`SKIP ${c.id} — already spanCorrected`);
      skipped++;
      continue;
    }

    const { embedding } = await embedText(c.content);
    const patch = JSON.stringify({
      spanCorrected: "true",
      spanCorrectedAt: STAMP,
      contentRaw: row.content,
    });
    await db()
      .update(kbFacts)
      .set({
        content: c.content,
        evidenceQuote: c.evidence,
        embedding,
        metadata: sql`${kbFacts.metadata} || ${patch}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(kbFacts.id, c.id));

    console.log(`FIXED ${c.id}`);
    console.log(`   old: ${row.content}`);
    console.log(`   new: ${c.content}\n`);
    corrected++;
  }

  // Guardrail fact — insert once, or update in place if the text changed.
  const existing = (await db()
    .select({ id: kbFacts.id, content: kbFacts.content })
    .from(kbFacts)
    .where(sql`${kbFacts.metadata}->>'spanGuardrail' = 'true'`)
    .limit(1)) as Array<{ id: string; content: string }>;
  if (existing.length > 0) {
    if (existing[0].content === GUARDRAIL.content) {
      console.log(`SKIP guardrail — unchanged (${existing[0].id})`);
    } else {
      const { embedding } = await embedText(GUARDRAIL.content);
      await db()
        .update(kbFacts)
        .set({
          content: GUARDRAIL.content,
          evidenceQuote: GUARDRAIL.evidence,
          embedding,
          metadata: sql`${kbFacts.metadata} || ${JSON.stringify({ correctedAt: STAMP })}::jsonb`,
          updatedAt: new Date(),
        })
        .where(eq(kbFacts.id, existing[0].id));
      console.log(`UPDATED guardrail fact ${existing[0].id}`);
    }
  } else {
    const { embedding } = await embedText(GUARDRAIL.content);
    const [ins] = await db()
      .insert(kbFacts)
      .values({
        factType: GUARDRAIL.factType,
        content: GUARDRAIL.content,
        evidenceQuote: GUARDRAIL.evidence,
        embedding,
        userAdded: "true",
        pinned: "true",
        metadata: GUARDRAIL.metadata,
      })
      .returning({ id: kbFacts.id });
    console.log(`ADDED pinned guardrail fact ${ins.id}`);
  }

  console.log(`\nDone. corrected=${corrected} skipped=${skipped}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
