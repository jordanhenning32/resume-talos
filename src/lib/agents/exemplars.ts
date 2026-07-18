/**
 * Few-shot exemplars for the writer prompts.
 *
 * These are fully fabricated, anonymized examples from industries
 * INTENTIONALLY DIFFERENT from any plausible candidate's actual background
 * (biotech ops + consumer fintech) so the writer model pattern-matches
 * structure, bullet rhythm, verb choice, and quantification level — NOT
 * content. The writer system prompt explicitly forbids copying exemplar
 * content; the JD-vs-KB separation rules already enforce KB-grounding.
 *
 * Selected per-application by the candidate's target seniority (from JD
 * analysis). Lives inside the writer's cached prefix so the cost premium
 * is paid once per application, never on revisions.
 */

import type { SeniorityLevel } from "./jd-analyzer";

const SENIOR_RESUME_EXEMPLAR = `# Dana M. Calloway
Boston, MA · (617) 555-0142 · dana@calloway.work · calloway.work · linkedin.com/in/danacalloway

## Summary

Operations leader who has scaled four biopharma manufacturing programs from clinical to commercial — most recently delivering the first-in-class oncology launch for a $4B Phase-III asset while running a 220-person organization across three sites.

## Experience

### Vice President, Manufacturing Operations · Sentari Therapeutics · 2022–Present
- Owned $180M annual operations P&L across three GMP facilities; finished 2025 at 104% of plan while absorbing a 30% headcount expansion.
- Drove the first-in-class oncology launch (NDA approval Aug 2024) on the original commitment date despite a six-month FDA observation cycle on the lead site.
- Built and onboarded a 90-person commercial manufacturing team in 11 months by re-architecting the hire-train-deploy pipeline; voluntary attrition dropped from 18% to 7%.
- Negotiated a $42M long-lead capital approval with the board against a 9-month payback case, accelerating the second-product timeline by two quarters.

### Senior Director, Process Development · Sentari Therapeutics · 2019–2022
- Led the late-stage process team (40 engineers + scientists) through Phase-II readouts for three programs, all of which advanced to BLA submission.
- Cut release-test cycle time from 23 days to 9 days by re-architecting the QC sample flow with the analytical team — protected $30M in inventory risk.
- Stood up the company's first multi-site validation framework; passed two pre-approval inspections without a 483.

### Director, Manufacturing Sciences · Helix Bio (acquired 2021) · 2015–2019
- Owned tech transfer for the lead asset from a 200L pilot to two commercial sites; first commercial lot released within 14 months of green-light.
- Authored the CMC sections of two BLA submissions; both approved on first cycle with no major deficiencies.
- Mentored eight engineers who later moved into senior IC or director roles; three are now VPs in the industry.

### Senior Manufacturing Engineer · Genzyme · 2010–2015
- Re-engineered the chromatography step on the company's flagship enzyme replacement therapy, recovering 12% yield with no spec changes — direct $14M annual gross margin lift.

## Skills

GMP manufacturing strategy · Tech transfer · FDA / EMA inspections · Capital planning · S&OP at scale · CMC regulatory strategy · Six-Sigma Black Belt · Org design

## Education

M.S. Chemical Engineering, MIT · 2008
B.S. Chemical Engineering, Purdue · 2006`;

const IC_RESUME_EXEMPLAR = `# Priya Subramanian
San Francisco · (415) 555-0118 · priya@psubra.dev · psubra.dev · github.com/psubra

## Summary

Staff software engineer specializing in distributed systems for high-throughput payment platforms. Most recently led the redesign of Velora's settlement pipeline, cutting end-to-end latency from 14s to 380ms while serving 2.4B transactions per month.

## Experience

### Staff Software Engineer · Velora · 2022–Present
- Architected the v3 settlement pipeline (Go, Kafka, ScyllaDB) that replaced a five-year-old Python monolith; p99 latency dropped 36×, on-call paging volume dropped 71%.
- Shipped the cross-border real-time FX engine for 28 corridors, taking median settlement from T+2 to under 90 seconds; now powers 18% of total revenue.
- Drove the platform's move to deterministic event sourcing; the team detected and fixed two long-tail data-loss bugs that had been hidden for 18 months.
- Mentored four engineers from senior to staff; co-authored the company's distributed-systems interview rubric.

### Senior Software Engineer · Velora · 2020–2022
- Led the migration off a 600M-row Postgres cluster to a sharded ScyllaDB cluster; zero downtime, sub-2ms p99 reads at 3× the prior write throughput.
- Built the company's first chaos-testing framework; surfaced 14 production-grade fault modes that would have escaped staging.
- Owned the on-call rotation for the payments core; reduced false-positive page rate from 41% to 6% with signal-to-noise alerting rules.

### Software Engineer · Plaid · 2017–2020
- Implemented the institution-tier load-balancing logic that became the backbone of the bank-connection routing; handled 200M+ daily requests at 99.97% uptime.
- Wrote the first internal benchmark suite for retry/timeout tuning; results adopted across three teams and cut downstream timeout rates by 60%.

### Software Engineer I · Square · 2015–2017
- Shipped the merchant-side webhook delivery system that replaced manual polling; reduced average notification latency from 4 minutes to under 500ms.

## Skills

Distributed systems · Go · Rust · Kafka · ScyllaDB · Postgres · gRPC · Kubernetes · Observability (OTel, Grafana, Loki) · System design

## Education

B.S. Computer Science, Carnegie Mellon · 2015`;

const SENIOR_COVER_LETTER_EXEMPLAR = `Dear Sentari Hiring Team,

The CMC section of the Velora-2 BLA was approved on first cycle last fall — a moment I'm still proud of because the team had spent the prior eighteen months convinced we'd need a second filing. When I read the VP of Manufacturing Operations posting, the line about "delivering commercial-readiness for first-in-class assets under FDA scrutiny" caught me. That's exactly the work I want to keep doing.

At Sentari, the program I'd inherit looks remarkably like Helix Bio's lead asset in 2019: a Phase-III candidate, two pre-approval inspections looming, and a manufacturing organization still scaling. There I built the multi-site validation framework that carried us through both PAIs without a 483 and onboarded the commercial team in time for launch. The pattern — choose the smallest set of process controls an inspector can defend, make them the foundation of everything else — has worked in three companies now.

What's drawing me to Sentari specifically is the published commitment to keep manufacturing in-house through commercial. The industry default of outsourcing late-stage CMC is a mistake I've watched destroy two competitors' first launches. The fact that your CEO has been vocal about owning the manufacturing function tells me there's an internal coalition that takes operations seriously — that's the conversation I'd want to be inside.

The next step that would help me is fifteen minutes with the search lead, or a written deep-dive on the lead asset's CMC posture. My recent work and case studies are at calloway.work.

Sincerely,
Dana M. Calloway`;

const IC_COVER_LETTER_EXEMPLAR = `Dear Velora Engineering Team,

I read the Staff Engineer, Payments Core posting last Tuesday and stopped on the line about "predictable latency at scale, not best-case benchmarks." I've spent four years rebuilding payment infrastructure at companies that learned that distinction the hard way — and I want to keep doing it somewhere it actually matters.

At my current company we replaced a five-year-old Python settlement monolith with a Go + Kafka + ScyllaDB pipeline. The numbers I'm proud of are not the headline (p99 14s → 380ms); they're the ones underneath. False-positive on-call pages dropped 71%. Two long-tail data-loss bugs that had hidden for eighteen months in the old monolith showed up in the first week of event-sourced traces. The redesign worked because we instrumented for the questions we couldn't yet ask.

What draws me to Velora specifically is the public engineering blog's posts on deterministic replay. Most companies talk about it as a stretch goal; you've shipped it as table stakes. The interview rubric I co-authored asks candidates to design a payments system where every state transition is replayable from log — I'd happily come help defend that bar from inside.

The most useful next step would be a thirty-minute system-design discussion with the team. My recent work is at psubra.dev and the chaos-testing framework I built is open-source on GitHub.

Sincerely,
Priya Subramanian`;

/**
 * Pick the resume exemplar that matches the JD's seniority bucket. Manager
 * and above use the SENIOR exemplar; everything else (including
 * unspecified) uses the IC exemplar.
 */
export function pickResumeExemplar(seniority: SeniorityLevel): string {
  if (
    seniority === "manager" ||
    seniority === "senior_manager" ||
    seniority === "director" ||
    seniority === "vp" ||
    seniority === "c_level"
  ) {
    return SENIOR_RESUME_EXEMPLAR;
  }
  return IC_RESUME_EXEMPLAR;
}

export function pickCoverLetterExemplar(seniority: SeniorityLevel): string {
  if (
    seniority === "manager" ||
    seniority === "senior_manager" ||
    seniority === "director" ||
    seniority === "vp" ||
    seniority === "c_level"
  ) {
    return SENIOR_COVER_LETTER_EXEMPLAR;
  }
  return IC_COVER_LETTER_EXEMPLAR;
}
