import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { agentRuns, applications, kbFacts } from "@/db/schema";

export type DashboardStats = {
  applications: number;
  inProgress: number;
  facts: number;
  monthCostUsd: number;
};

export async function getDashboardStats(): Promise<DashboardStats> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [apps, inProgress, facts, costRow] = await Promise.all([
    db()
      .select({ count: sql<number>`count(*)::int` })
      .from(applications),
    db()
      .select({ count: sql<number>`count(*)::int` })
      .from(applications)
      .where(eq(applications.status, "in_progress")),
    db()
      .select({ count: sql<number>`count(*)::int` })
      .from(kbFacts),
    db()
      .select({
        sum: sql<number>`coalesce(sum(${agentRuns.costUsd}), 0)::float`,
      })
      .from(agentRuns)
      .where(and(gte(agentRuns.startedAt, monthStart), eq(agentRuns.status, "completed"))),
  ]);

  return {
    applications: apps[0]?.count ?? 0,
    inProgress: inProgress[0]?.count ?? 0,
    facts: facts[0]?.count ?? 0,
    monthCostUsd: costRow[0]?.sum ?? 0,
  };
}
