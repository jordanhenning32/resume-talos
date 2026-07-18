CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "kb_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"token_count" integer,
	"embedding" vector(1536),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"file_type" text NOT NULL,
	"raw_content" text NOT NULL,
	"content_hash" text NOT NULL,
	"source_path" text,
	"byte_size" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_facts" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text,
	"fact_type" text NOT NULL,
	"content" text NOT NULL,
	"evidence_quote" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"embedding" vector(1536),
	"user_added" text DEFAULT 'false' NOT NULL,
	"pinned" text DEFAULT 'false' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text,
	"application_version_id" text,
	"agent_name" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0,
	"output_tokens" integer DEFAULT 0,
	"cached_input_tokens" integer DEFAULT 0,
	"cost_usd" real DEFAULT 0,
	"status" text DEFAULT 'running' NOT NULL,
	"error" text,
	"input" jsonb,
	"output" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "application_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"iteration" integer DEFAULT 0 NOT NULL,
	"resume_markdown" text,
	"cover_letter_markdown" text,
	"resume_docx_path" text,
	"resume_pdf_path" text,
	"cover_letter_docx_path" text,
	"cover_letter_pdf_path" text,
	"screener_score" jsonb,
	"qc_a_score" jsonb,
	"qc_b_score" jsonb,
	"cited_fact_ids" jsonb DEFAULT '[]'::jsonb,
	"verifier_passed" text DEFAULT 'pending',
	"verifier_issues" jsonb DEFAULT '[]'::jsonb,
	"is_final" text DEFAULT 'false' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" text PRIMARY KEY NOT NULL,
	"company" text NOT NULL,
	"company_slug" text NOT NULL,
	"role" text NOT NULL,
	"role_slug" text NOT NULL,
	"jd_text" text NOT NULL,
	"jd_url" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"variant" text,
	"jd_analysis" jsonb,
	"fit_score" real,
	"fit_score_reasoning" text,
	"fit_score_detail" jsonb,
	"fit_approved" text DEFAULT 'false' NOT NULL,
	"kb_gap_report" jsonb,
	"kb_gap_report_at" timestamp with time zone,
	"recruiter_screener_result" jsonb,
	"recruiter_screener_at" timestamp with time zone,
	"knockout_report" jsonb,
	"knockout_report_at" timestamp with time zone,
	"market_research_id" text,
	"market_research_approved" text DEFAULT 'false' NOT NULL,
	"final_version_id" text,
	"notes" text,
	"outcome_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qc_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"application_version_id" text NOT NULL,
	"reviewer" text NOT NULL,
	"document_kind" text NOT NULL,
	"critical_issues" jsonb DEFAULT '[]'::jsonb,
	"important_improvements" jsonb DEFAULT '[]'::jsonb,
	"minor_suggestions" jsonb DEFAULT '[]'::jsonb,
	"overall_score" real,
	"dimension_scores" jsonb,
	"raw_response" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_research" (
	"id" text PRIMARY KEY NOT NULL,
	"company_slug" text NOT NULL,
	"company_name" text NOT NULL,
	"findings" jsonb,
	"tone_profile" jsonb,
	"sources" jsonb DEFAULT '[]'::jsonb,
	"raw_markdown" text,
	"user_approved" text DEFAULT 'false' NOT NULL,
	"user_edits" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_document_id_kb_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."kb_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_facts" ADD CONSTRAINT "kb_facts_document_id_kb_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."kb_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_application_version_id_application_versions_id_fk" FOREIGN KEY ("application_version_id") REFERENCES "public"."application_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_versions" ADD CONSTRAINT "application_versions_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_reviews" ADD CONSTRAINT "qc_reviews_application_version_id_application_versions_id_fk" FOREIGN KEY ("application_version_id") REFERENCES "public"."application_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kb_chunks_embedding_idx" ON "kb_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "kb_chunks_document_idx" ON "kb_chunks" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kb_documents_content_hash_unique" ON "kb_documents" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "kb_facts_embedding_idx" ON "kb_facts" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "kb_facts_document_idx" ON "kb_facts" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "kb_facts_type_idx" ON "kb_facts" USING btree ("fact_type");--> statement-breakpoint
CREATE INDEX "agent_runs_app_idx" ON "agent_runs" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "agent_runs_started_idx" ON "agent_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "application_versions_app_idx" ON "application_versions" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "application_versions_app_version_iteration_unique" ON "application_versions" USING btree ("application_id","version_number","iteration");--> statement-breakpoint
CREATE INDEX "applications_status_idx" ON "applications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "applications_company_idx" ON "applications" USING btree ("company_slug");--> statement-breakpoint
CREATE INDEX "applications_created_idx" ON "applications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "qc_reviews_version_idx" ON "qc_reviews" USING btree ("application_version_id");--> statement-breakpoint
CREATE INDEX "qc_reviews_reviewer_idx" ON "qc_reviews" USING btree ("reviewer");--> statement-breakpoint
CREATE INDEX "market_research_company_idx" ON "market_research" USING btree ("company_slug");--> statement-breakpoint
CREATE INDEX "market_research_created_idx" ON "market_research" USING btree ("created_at");
