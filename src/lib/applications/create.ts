import { eq } from "drizzle-orm";
import { db } from "@/db";
import { applications, type Application } from "@/db/schema";
import { analyzeJobDescription } from "@/lib/agents/jd-analyzer";
import { scoreFit } from "@/lib/agents/fit-scorer";
import { fetchAndExtract } from "@/lib/kb/url-ingest";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "untitled";
}

export type CreateApplicationInput =
  | { mode: "paste"; jdText: string }
  | { mode: "url"; jdUrl: string };

export type CreateApplicationResult = {
  applicationId: string;
  costUsd: number;
};

/**
 * End-to-end create flow:
 *   1. (URL mode) fetch + extract JD text
 *   2. Insert applications row with placeholders
 *   3. Run JD Analyzer (Opus) → update row
 *   4. Run Fit Scorer (Haiku, KB-grounded) → update row
 *   5. Return the application id
 *
 * Total wall-clock time: typically 15-30s. The user waits and sees the result page.
 */
export async function createAndAnalyzeApplication(
  input: CreateApplicationInput,
): Promise<CreateApplicationResult> {
  // 1. Resolve JD text from URL if needed.
  let jdText: string;
  let jdUrl: string | null = null;
  if (input.mode === "url") {
    const extracted = await fetchAndExtract(input.jdUrl);
    if (extracted.text.trim().length < 200) {
      throw new Error(
        `Page at ${input.jdUrl} produced only ${extracted.text.length} chars of text. ` +
          "It may be JS-rendered or behind auth. Paste the JD body directly instead.",
      );
    }
    jdText = `${extracted.title}\n\n${extracted.text}`;
    jdUrl = extracted.url;
  } else {
    jdText = input.jdText.trim();
    if (jdText.length < 200) {
      throw new Error("JD text is too short — paste the full body (>200 chars).");
    }
  }

  // 2. Insert placeholder application row so subsequent agent_runs can attribute to it.
  const [draft] = await db()
    .insert(applications)
    .values({
      company: "Pending analysis…",
      companySlug: "pending",
      role: "Pending analysis…",
      roleSlug: "pending",
      jdText,
      jdUrl,
      status: "draft",
    })
    .returning({ id: applications.id });
  const applicationId = draft.id;

  // 3. JD analyzer.
  const analyzer = await analyzeJobDescription({ jdText, applicationId });
  const a = analyzer.analysis;
  const company = a.companyName?.trim() || "Unknown company";
  const role = a.roleTitle?.trim() || "Unknown role";
  await db()
    .update(applications)
    .set({
      company,
      companySlug: slugify(company),
      role,
      roleSlug: slugify(role),
      jdAnalysis: a,
      updatedAt: new Date(),
    })
    .where(eq(applications.id, applicationId));

  // 4. Fit scorer (KB-grounded via retriever).
  const scorer = await scoreFit({ jdAnalysis: a, jdText, applicationId });
  const f = scorer.fitScore;
  await db()
    .update(applications)
    .set({
      fitScore: f.overall,
      fitScoreReasoning: f.reasoning,
      fitScoreDetail: {
        overall: f.overall,
        dimensions: f.dimensions,
        topStrengths: f.topStrengths,
        topGaps: f.topGaps,
        reasoning: f.reasoning,
        recommendation: f.recommendation,
      },
      updatedAt: new Date(),
    })
    .where(eq(applications.id, applicationId));

  return {
    applicationId,
    costUsd:
      Math.round((analyzer.costUsd + scorer.totalCostUsd) * 1_000_000) / 1_000_000,
  };
}

export async function getApplicationById(id: string): Promise<Application | null> {
  const [row] = await db()
    .select()
    .from(applications)
    .where(eq(applications.id, id))
    .limit(1);
  return row ?? null;
}
