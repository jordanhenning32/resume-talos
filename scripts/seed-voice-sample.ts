import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });

import { ingestDocument } from "@/lib/kb/ingest";

// A short, deliberately-Jordan-voiced sample. In real use you'd upload your
// own LinkedIn essays / blog posts / interview transcripts through the UI.
const VOICE_SAMPLE = `When people ask me what I learned running federal IT for SSA, the honest answer is uncomfortable: the gap between reported uptime and felt uptime is where service organizations die. Dashboards stay green because they're measuring what's instrumented, and what's instrumented is whatever the last incident demanded. Real users hit timeouts that never show up in the SLO. I learned to ask three questions before trusting any operational report: what's not in the denominator, what cohort is over-represented, and which leadership audience is this dashboard actually optimizing for. None of those questions are technical — they're cultural. The technical work that follows them, though, has been some of the most satisfying of my career.

Federal delivery is a craft more than a science. The interesting decisions are about who you put on which slice of the work, when to escalate, and how to make a 352-person organization feel small to the person on the other end of the support call. I've spent most of my career building the muscle for those decisions, and the second half of it teaching that muscle to other people.

The reason I'm spending my own time now on multi-agent AI systems isn't because I think the agents are the product. It's because the leverage is in the orchestration — picking which agent gets which slice of the problem and on what evidence — and that's the same skill I've been practicing for twenty years on humans. Production AI work, to me, just feels like federal delivery with faster iteration cycles. You still have to choose the smallest set of controls a reviewer can defend, and you still have to know when to override the model.`;

async function main() {
  console.log("Ingesting sample voice document for Jordan...");
  const result = await ingestDocument({
    name: "Jordan voice sample — operational craft",
    fileType: "md",
    buffer: Buffer.from(VOICE_SAMPLE, "utf-8"),
    kind: "voice",
  });
  console.log(
    `${result.status}: doc=${result.documentId} chunks=${result.chunkCount} facts=${result.factCount} ($${result.costUsd.toFixed(4)})`,
  );
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
