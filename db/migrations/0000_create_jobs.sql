CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"progress" real DEFAULT 0 NOT NULL,
	"message" text,
	"input" jsonb NOT NULL,
	"result" jsonb,
	"stats" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "jobs_kind_check" CHECK ("jobs"."kind" in ('detect', 'segment')),
	CONSTRAINT "jobs_status_check" CHECK ("jobs"."status" in ('queued', 'running', 'done', 'error', 'cancelled')),
	CONSTRAINT "jobs_progress_check" CHECK ("jobs"."progress" between 0 and 1)
);
--> statement-breakpoint
CREATE INDEX "jobs_created_at_idx" ON "jobs" USING btree ("created_at" DESC NULLS LAST);