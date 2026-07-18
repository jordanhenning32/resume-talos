# Jordan Henning — Work Stories

## Story: Emergency COVID-19 medical document upload at SSA

**When & where:** Spring 2020, while serving as IT Project Manager at the Social Security Administration in Baltimore.

**The situation:** When COVID hit, every SSA field office closed in a single week. Disability claimants couldn't physically deliver medical evidence to the agency, and disability claim processing depends on that evidence. The entire disability pipeline was at risk of grinding to a halt while the Hearings Office backlog ballooned. Operations leadership was looking at IT for an answer. The typical enterprise cycle for any new public-facing capability at SSA was 12+ months — controls, accessibility review, paperwork reduction act clearance, the works.

**What I did:** I led the design and delivery of an emergency medical-document upload capability on MySSA, scoped tightly so it could ship in weeks rather than months. The work required explicit, sometimes-unpopular trade-offs about what *wouldn't* ship in version 1 — exactly the kind of "compressed timeline, hard scope discipline" decisions my combat-leadership training had prepared me to make.

**The outcome:** Delivered in weeks rather than the typical 12+ month enterprise cycle. The capability shipped to citizens during peak COVID restrictions and served as the medical-evidence conduit for the disability program. Acting Commissioner Kilolo Kijakazi presented me the SSA Commissioner Award in 2021 specifically for this delivery.

**What it shows:** I can compress federal enterprise delivery cycles when the stakes are real and I'm willing to make explicit trade-offs about scope.

---

## Story: Building RFP Factory at Quadratic Digital

**When & where:** 2024, at Quadratic Digital, in the Chief Growth Officer role.

**The situation:** As a small startup chasing federal and commercial contracts, we had 2–3 people working RFPs at a time, and even at full tilt they could only ship 1–2 proposals a month. That was the hard ceiling on our pipeline. We needed more shots on goal — more proposals out the door — without sacrificing the quality that wins contested deals. Larger competitors had whole proposal shops; we couldn't compete on headcount. The only path forward was a step-change in cycle time.

**What I did:** I personally designed and built RFP Factory in-house — a multi-agent system that ingests an RFP packet and produces a polished, SME-ready draft. Two things set it apart from a generic "agents in a chain" pipeline:

1. **A multi-model review loop.** I deliberately layered different LLM providers across stages so each model is used where its strengths matter, and only where they matter, to stay budget-disciplined. Drafting, critique, and polish each run on a different model. Cheaper models do the heavy lifting; expensive models only run on the high-leverage review passes.
2. **Costing agents grounded in real market research.** Most proposal tools treat pricing as an afterthought. RFP Factory has dedicated agents that do market research, derive cost ranges from real findings, factor in our delivery costs, and surface projected margin *before* we submit. We know the profitability of every offer going out the door, and we know it's competitively priced.

The system handles intake, strategy, outline and team selection, costing, drafting, review, polish, and final DOCX export across a 9-stage pipeline.

**The outcome:** Proposal labor dropped from ~40 hours to ~2 hours of human review per RFP — a 20× cycle-time compression — with quality the team agreed *exceeded* what we used to ship manually. When the team saw the first end-to-end run, they were amazed and the output exceeded everyone's expectations. We'd quietly moved from "small shop with a headcount ceiling" to "small shop that ships at large-shop volume."

**What it shows:** I see operational ceilings, build out of them rather than around them, and ship production multi-agent systems that pay back the same quarter.

---

## Story: Automating hearings case management as Branch Chief at SSA

**When & where:** 2022–2025, as Branch Chief, Hearings Office IT Oversight at the Social Security Administration, leading 12 direct reports overseeing 340 field IT staff across 170 nationwide Hearings Offices serving 7,000+ employees.

**The situation:** Branch Chief is a manager-of-managers role with constantly shifting weekly stakes — one week is annual budget planning, the next is hiring across the field, the next is responding to a Hearings Office IT escalation, the next is the performance-review cycle. The constant underneath all of it was throughput: the Hearings Offices have to process disability cases, and the IT systems supporting case management directly gate that throughput. We were also operating in a federal hiring environment with high turnover, which meant the *headcount* lever wasn't going to save us.

**What I did:** I made the call to push hard on case-management automation tooling for the field techs — tools to assist with hearings processing rather than asking the team to absorb more case volume manually. This wasn't a universally popular bet. My Division Director and I had multiple direct conversations where she pushed back on the investment; we worked through the disagreement case by case until we aligned. I held the line on the automation spend because the throughput math wouldn't work otherwise.

**The outcome:** Six months later we hit our annual hearings processing goals — *with reduced headcount*. The automation absorbed the workload the additional hires would have. Across the same three-year tenure: 99.9% availability across all 170 offices and 100% retention across my twelve direct reports.

**What it shows:** I'm comfortable making unpopular calls when the throughput math demands them, and I can work senior peers from "no" to "yes" without burning the relationship.

---

## Story: Holding fire on a minivan in Mosul — and what it taught me about civilian leadership

**When & where:** Night patrol around Mosul, Iraq, mid-2000s, as a combat infantryman with the 101st Airborne (one combat tour in Iraq).

**The situation:** Our element had been hit a few missions prior, and the team was still on edge. We were running a night patrol with no lights — the standard operating posture in that area at that time. A minivan approached our convoy from the right flank. By rules of engagement, we had every right to fire on it. The pressure to engage was real: my gunner was already on it, the team's nerves were raw, and the cost of being wrong on the dovish side could be lethal.

**What I did:** As the vehicle closed, I looked harder and could make out that it was full of people — a family. They almost certainly couldn't see us in the dark. I made the call to the gunner to hold fire. The gunner protested. I held the call. The minivan rolled past, full of civilians who never realized how close they'd come.

**The outcome:** No civilian casualties. Team integrity intact. A formative moment about how to weigh an unpopular call against a popular one when *being right* is what actually matters — and when the popular call would have been wrong.

**What it shows:** I'm trained to make unpopular calls under pressure when the data in front of me says the unpopular call is the right one. That reflex came back during the emergency COVID-19 MySSA project at SSA — I leaned into risker scope-and-trade-off decisions than I'd have made in a peacetime project cycle because the mission required it. The combat-decision-making reflex transfers: it sharpens executive judgment in compressed, high-stakes environments.
