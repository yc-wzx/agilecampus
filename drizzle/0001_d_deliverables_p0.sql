CREATE TYPE "public"."deliverable_status" AS ENUM('draft', 'submitted');--> statement-breakpoint
CREATE TYPE "public"."deliverable_type" AS ENUM('report', 'presentation', 'video', 'survey', 'code', 'prototype', 'demo', 'other');--> statement-breakpoint
CREATE TABLE "deliverable_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deliverable_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"draft_revision" integer NOT NULL,
	"submission_key" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"submitted_by_id" uuid NOT NULL,
	"milestone_id" uuid,
	"milestone_title" text,
	"title" text NOT NULL,
	"type" "deliverable_type" NOT NULL,
	"url" text NOT NULL,
	"description" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliverables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"milestone_id" uuid,
	"title" text NOT NULL,
	"type" "deliverable_type" NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" "deliverable_status" DEFAULT 'draft' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"creation_key" uuid NOT NULL,
	"creation_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "deliverable_versions" ADD CONSTRAINT "deliverable_versions_deliverable_id_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deliverables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deliverable_versions_number_unique" ON "deliverable_versions" USING btree ("deliverable_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "deliverable_versions_submission_unique" ON "deliverable_versions" USING btree ("deliverable_id","submission_key");--> statement-breakpoint
CREATE INDEX "deliverables_project_idx" ON "deliverables" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "deliverables_author_idx" ON "deliverables" USING btree ("author_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deliverables_creation_unique" ON "deliverables" USING btree ("project_id","author_id","creation_key");