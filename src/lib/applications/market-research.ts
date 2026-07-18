import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import {
  applications,
  marketResearch,
  type MarketResearch,
} from "@/db/schema";
import { runMarketResearch } from "@/lib/agents/market-research";

const CACHE_TTL_DAYS = 30;

export type MarketResearchOutcome = {
  marketResearchId: string;
  cacheHit: boolean;
  research: MarketResearch;
  costUsd: number;
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "unknown";
}

export async function findFreshCachedResearch(
  companySlug: string,
): Promise<MarketResearch | null> {
  const cutoff = new Date(Date.now() - CACHE_TTL_DAYS * 24 * 60 * 60 * 1000);
  const [row] = await db()
    .select()
    .from(marketResearch)
    .where(
      and(
        eq(marketResearch.companySlug, companySlug),
        gt(marketResearch.createdAt, cutoff),
      ),
    )
    .orderBy(desc(marketResearch.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * Run market research for the application's company. Honors the 30-day cache
 * keyed on companySlug. Links the resulting market_research row to the
 * application via applications.marketResearchId.
 */
export async function runMarketResearchForApplication(
  applicationId: string,
): Promise<MarketResearchOutcome> {
  const [app] = await db()
    .select()
    .from(applications)
    .where(eq(applications.id, applicationId))
    .limit(1);
  if (!app) throw new Error(`Application ${applicationId} not found.`);
  if (!app.company || app.companySlug === "pending") {
    throw new Error("Application has no resolved company yet.");
  }

  // 1. Cache check.
  const cached = await findFreshCachedResearch(app.companySlug);
  if (cached) {
    await db()
      .update(applications)
      .set({
        marketResearchId: cached.id,
        updatedAt: new Date(),
      })
      .where(eq(applications.id, applicationId));
    return {
      marketResearchId: cached.id,
      cacheHit: true,
      research: cached,
      costUsd: 0,
    };
  }

  // 2. Cache miss — run the agent.
  const agentResult = await runMarketResearch({
    companyName: app.company,
    applicationId,
  });

  const expiresAt = new Date(Date.now() + CACHE_TTL_DAYS * 24 * 60 * 60 * 1000);
  const [inserted] = await db()
    .insert(marketResearch)
    .values({
      companySlug: app.companySlug,
      companyName: app.company,
      findings: agentResult.result.findings,
      toneProfile: agentResult.result.toneProfile,
      sources: agentResult.result.sources,
      rawMarkdown: agentResult.rawMarkdown,
      userApproved: "false",
      expiresAt,
    })
    .returning();

  await db()
    .update(applications)
    .set({
      marketResearchId: inserted.id,
      updatedAt: new Date(),
    })
    .where(eq(applications.id, applicationId));

  return {
    marketResearchId: inserted.id,
    cacheHit: false,
    research: inserted,
    costUsd: agentResult.costUsd,
  };
}

export async function getMarketResearchById(
  id: string,
): Promise<MarketResearch | null> {
  const [row] = await db()
    .select()
    .from(marketResearch)
    .where(eq(marketResearch.id, id))
    .limit(1);
  return row ?? null;
}

export async function approveMarketResearch(
  applicationId: string,
  edits?: string,
): Promise<void> {
  const [app] = await db()
    .select()
    .from(applications)
    .where(eq(applications.id, applicationId))
    .limit(1);
  if (!app?.marketResearchId) {
    throw new Error("No market research linked to this application.");
  }
  await db()
    .update(marketResearch)
    .set({
      userApproved: "true",
      userEdits: edits ?? null,
    })
    .where(eq(marketResearch.id, app.marketResearchId));
  await db()
    .update(applications)
    .set({
      marketResearchApproved: "true",
      updatedAt: new Date(),
    })
    .where(eq(applications.id, applicationId));
}

// Re-export the slugify for any caller that needs it.
export { slugify as marketResearchSlugify };
