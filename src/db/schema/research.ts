import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

export const marketResearch = pgTable(
  "market_research",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    companySlug: text("company_slug").notNull(),
    companyName: text("company_name").notNull(),
    findings: jsonb("findings").$type<{
      overview?: string;
      mission?: string | null;
      values?: string[] | null;
      culture?: string | null;
      recentNews?: Array<{
        title: string;
        url?: string | null;
        summary?: string | null;
        date?: string | null;
      }> | null;
      productsServices?: string[] | null;
      leadership?: string[] | null;
      [key: string]: unknown;
    } | null>(),
    toneProfile: jsonb("tone_profile").$type<{
      formality: number;
      technicalDensity: number;
      missionEmphasis: "low" | "medium" | "high";
      energyLevel: "low" | "medium" | "high";
      notes?: string | null;
    } | null>(),
    sources: jsonb("sources").$type<Array<{ url: string; title?: string | null }>>()
      .default([]),
    rawMarkdown: text("raw_markdown"),
    userApproved: text("user_approved").notNull().default("false"),
    userEdits: text("user_edits"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [
    index("market_research_company_idx").on(table.companySlug),
    index("market_research_created_idx").on(table.createdAt),
  ],
);

export type MarketResearch = typeof marketResearch.$inferSelect;
export type NewMarketResearch = typeof marketResearch.$inferInsert;
