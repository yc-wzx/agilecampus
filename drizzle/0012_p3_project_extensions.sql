CREATE TYPE "public"."project_reference_type" AS ENUM('meeting', 'document', 'video', 'prototype', 'other');--> statement-breakpoint
CREATE TABLE "project_creation_requests" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"request_hash" text NOT NULL,
	"project_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_lead_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_name" text NOT NULL,
	"previous_leader_id" uuid,
	"previous_leader_name" text,
	"leader_id" uuid,
	"leader_name" text,
	"revision" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"created_by_id" uuid,
	"title" text NOT NULL,
	"type" "project_reference_type" NOT NULL,
	"url" text NOT NULL,
	"minutes_url" text,
	"recording_url" text,
	"meeting_date" date,
	"participants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"milestone_id" uuid,
	"milestone_title" text,
	"note" text DEFAULT '' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"request_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_references_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "template_id" text DEFAULT 'blank' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "leader_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "leader_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "project_creation_requests" ADD CONSTRAINT "project_creation_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_lead_changes" ADD CONSTRAINT "project_lead_changes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_references" ADD CONSTRAINT "project_references_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_references" ADD CONSTRAINT "project_references_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_references" ADD CONSTRAINT "project_references_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_lead_changes_revision_unique" ON "project_lead_changes" USING btree ("project_id","revision");--> statement-breakpoint
CREATE INDEX "project_references_project_idx" ON "project_references" USING btree ("project_id","created_at");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_leader_id_users_id_fk" FOREIGN KEY ("leader_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;