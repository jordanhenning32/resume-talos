import {
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

export const applicationStatusValues = [
  "draft",
  "in_progress",
  "ready",
  "applied",
  "phone_screen",
  "interview",
  "offer",
  "rejected",
  "ghosted",
  "withdrawn",
] as const;

export type ApplicationStatus = (typeof applicationStatusValues)[number];

export const resumeVariantValues = ["long", "short"] as const;
export type ResumeVariant = (typeof resumeVariantValues)[number];

/** Shape of the cached recruiter-simulator result (mirrors RecruiterScreenerOutput). */
export type RecruiterScreenerShape = {
  advanceScore: number;
  recommendation: "advance" | "borderline" | "pass";
  twoSentenceRationale: string;
  topStrengths: string[];
  topConcerns: string[];
  firstImpressionNotes: string;
  internalConsistencyNotes: string;
  storyCoherence: string;
  resumeVersionId?: string;
};

/**
 * Shape of the cached knockout-questions report (mirrors KnockoutReport in
 * knockout-detector.ts). Surfaces hard JD requirements (citizenship,
 * clearance, years, degree, certifications) and whether the resume answers
 * each one explicitly — a knockout the resume is silent on can mean
 * instant-reject from many ATS regardless of keyword score.
 */
export type KnockoutReportShape = {
  knockouts: Array<{
    id: string;
    category:
      | "citizenship"
      | "clearance"
      | "experience_years"
      | "degree"
      | "certification"
      | "work_authorization"
      | "other";
    requirement: string;
    jdEvidenceQuote: string;
    scalarMinimum: number | null;
    scalarUnit: "years" | "months" | null;
    coverage: {
      verdict:
        | "verified"
        | "partial"
        | "missing"
        | "blocking"
        | "cannot_determine";
      resumeSnippet: string | null;
      notes: string | null;
      /**
       * Where the evidence came from. Optional for backward compatibility
       * with reports cached before this field was introduced — those
       * implicitly came from the resume.
       */
      source?: "resume" | "kb" | "none";
    };
  }>;
  missingCount: number;
  partialCount: number;
  verifiedCount: number;
  blockingCount: number;
  cannotDetermineCount: number;
  resumeVersionId: string | null;
  costUsd: number;
};

/** Shape of the cached KB gap report (mirrors KbGapReport in kb-gap-detector.ts). */
export type KbGapReportShape = {
  mustHave: Array<{
    skill: string;
    strongMatches: number;
    topFactIds: string[];
    topFactSnippets: string[];
    bestSimilarity: number;
    verdict: "well_covered" | "thin" | "missing";
  }>;
  niceToHave: Array<{
    skill: string;
    strongMatches: number;
    topFactIds: string[];
    topFactSnippets: string[];
    bestSimilarity: number;
    verdict: "well_covered" | "thin" | "missing";
  }>;
  missingMustHaveCount: number;
  thinMustHaveCount: number;
  wellCoveredMustHaveCount: number;
  embedCostUsd: number;
};

export type ApplicationScoreShape = {
  overall: number;
  dimensions?: Record<string, number>;
  feedback?: string[];
  model?: string;
  provider?: string;
  fallbackFrom?: {
    model?: string;
    provider?: string;
    reason?: string;
  } | null;
};

export const applications = pgTable(
  "applications",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    company: text("company").notNull(),
    companySlug: text("company_slug").notNull(),
    role: text("role").notNull(),
    roleSlug: text("role_slug").notNull(),
    jdText: text("jd_text").notNull(),
    jdUrl: text("jd_url"),

    status: text("status").$type<ApplicationStatus>().notNull().default("draft"),
    variant: text("variant").$type<ResumeVariant>(),

    // JD analysis (cached on the application — see system spec). Typed loosely
    // at the column level because the agent's Zod schema is the source of truth;
    // strong typing in pages comes from re-casting to JdAnalysis.
    jdAnalysis: jsonb("jd_analysis").$type<Record<string, unknown> | null>(),

    fitScore: real("fit_score"),
    fitScoreReasoning: text("fit_score_reasoning"),
    fitScoreDetail: jsonb("fit_score_detail").$type<{
      overall: number;
      dimensions: Array<{ name: string; score: number; reasoning: string }>;
      topStrengths: string[];
      topGaps: string[];
      reasoning: string;
      recommendation: "strong_proceed" | "proceed" | "borderline" | "pass";
    } | null>(),
    fitApproved: text("fit_approved").notNull().default("false"),

    // KB coverage report — cached output of the gap detector so we don't pay
    // 20+ seconds of LLM latency on every page view. Recomputed on demand
    // via the "Re-scan KB coverage" action when the user adds new facts.
    kbGapReport: jsonb("kb_gap_report").$type<KbGapReportShape | null>(),
    kbGapReportAt: timestamp("kb_gap_report_at", { withTimezone: true }),

    // Recruiter-simulator (LLM screener) result — cached because the Sonnet
    // call is ~$0.02 each. Defeated by user adding new drafts; user can
    // re-run via a button.
    recruiterScreenerResult: jsonb("recruiter_screener_result").$type<RecruiterScreenerShape | null>(),
    recruiterScreenerAt: timestamp("recruiter_screener_at", { withTimezone: true }),

    // Knockout-question report — hard JD requirements (citizenship, clearance,
    // experience years, degree, certifications) plus whether the resume
    // explicitly answers each. A missing knockout = instant-reject risk from
    // many ATS regardless of keyword score, so this feeds into QC at the
    // highest priority. Recomputed on demand.
    knockoutReport: jsonb("knockout_report").$type<KnockoutReportShape | null>(),
    knockoutReportAt: timestamp("knockout_report_at", { withTimezone: true }),

    marketResearchId: text("market_research_id"),
    marketResearchApproved: text("market_research_approved")
      .notNull()
      .default("false"),

    finalVersionId: text("final_version_id"),

    notes: text("notes"),
    outcomeNotes: text("outcome_notes"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    statusUpdatedAt: timestamp("status_updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("applications_status_idx").on(table.status),
    index("applications_company_idx").on(table.companySlug),
    index("applications_created_idx").on(table.createdAt),
  ],
);

export const applicationVersions = pgTable(
  "application_versions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    iteration: integer("iteration").notNull().default(0),

    resumeMarkdown: text("resume_markdown"),
    coverLetterMarkdown: text("cover_letter_markdown"),

    resumeDocxPath: text("resume_docx_path"),
    resumePdfPath: text("resume_pdf_path"),
    coverLetterDocxPath: text("cover_letter_docx_path"),
    coverLetterPdfPath: text("cover_letter_pdf_path"),

    screenerScore: jsonb("screener_score").$type<ApplicationScoreShape | null>(),
    qcAScore: jsonb("qc_a_score").$type<ApplicationScoreShape | null>(),
    qcBScore: jsonb("qc_b_score").$type<ApplicationScoreShape | null>(),

    citedFactIds: jsonb("cited_fact_ids").$type<string[]>().default([]),
    verifierPassed: text("verifier_passed").default("pending"),
    verifierIssues: jsonb("verifier_issues").$type<
      Array<{ claim: string; reason: string; severity: string }>
    >().default([]),

    isFinal: text("is_final").notNull().default("false"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("application_versions_app_idx").on(table.applicationId),
    uniqueIndex("application_versions_app_version_iteration_unique").on(
      table.applicationId,
      table.versionNumber,
      table.iteration,
    ),
  ],
);

export const reviewerKindValues = [
  "qc_a",
  "qc_b",
  "screener",
  "verifier",
] as const;
export type ReviewerKind = (typeof reviewerKindValues)[number];

export const qcReviews = pgTable(
  "qc_reviews",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    applicationVersionId: text("application_version_id")
      .notNull()
      .references(() => applicationVersions.id, { onDelete: "cascade" }),
    reviewer: text("reviewer").$type<ReviewerKind>().notNull(),
    documentKind: text("document_kind").notNull(), // "resume" | "cover_letter"
    criticalIssues: jsonb("critical_issues").$type<string[]>().default([]),
    importantImprovements: jsonb("important_improvements")
      .$type<string[]>()
      .default([]),
    minorSuggestions: jsonb("minor_suggestions").$type<string[]>().default([]),
    overallScore: real("overall_score"),
    dimensionScores: jsonb("dimension_scores").$type<Record<string, number>>(),
    rawResponse: text("raw_response"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("qc_reviews_version_idx").on(table.applicationVersionId),
    index("qc_reviews_reviewer_idx").on(table.reviewer),
  ],
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    applicationId: text("application_id").references(() => applications.id, {
      onDelete: "cascade",
    }),
    applicationVersionId: text("application_version_id").references(
      () => applicationVersions.id,
      { onDelete: "cascade" },
    ),
    agentName: text("agent_name").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").default(0),
    outputTokens: integer("output_tokens").default(0),
    cachedInputTokens: integer("cached_input_tokens").default(0),
    costUsd: real("cost_usd").default(0),
    status: text("status").notNull().default("running"),
    error: text("error"),
    input: jsonb("input"),
    output: jsonb("output"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("agent_runs_app_idx").on(table.applicationId),
    index("agent_runs_started_idx").on(table.startedAt),
  ],
);

export type Application = typeof applications.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;
export type ApplicationVersion = typeof applicationVersions.$inferSelect;
export type NewApplicationVersion = typeof applicationVersions.$inferInsert;
export type QcReview = typeof qcReviews.$inferSelect;
export type NewQcReview = typeof qcReviews.$inferInsert;
export type AgentRun = typeof agentRuns.$inferSelect;
export type NewAgentRun = typeof agentRuns.$inferInsert;
