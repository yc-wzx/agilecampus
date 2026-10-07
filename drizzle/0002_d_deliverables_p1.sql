CREATE TYPE "public"."deliverable_feedback_decision" AS ENUM('approved', 'changes_requested', 'comment');--> statement-breakpoint
ALTER TYPE "public"."deliverable_status" ADD VALUE 'approved';--> statement-breakpoint
ALTER TYPE "public"."deliverable_status" ADD VALUE 'changes_requested';--> statement-breakpoint
CREATE TABLE "deliverable_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"deliverable_id" uuid,
	"version_id" uuid,
	"milestone_id" uuid,
	"milestone_title" text,
	"reviewer_id" uuid NOT NULL,
	"decision" "deliverable_feedback_decision" NOT NULL,
	"comment" text NOT NULL,
	"request_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliverable_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" text NOT NULL,
	"project_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"recipient_ids" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "deliverable_outbox_event_key_unique" UNIQUE("event_key")
);
--> statement-breakpoint
CREATE TABLE "feedback_task_links" (
	"feedback_id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid,
	"original_task_id" uuid NOT NULL,
	"created_by_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deliverables" ADD COLUMN "working_copy" jsonb;--> statement-breakpoint
ALTER TABLE "deliverable_feedback" ADD CONSTRAINT "deliverable_feedback_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverable_feedback" ADD CONSTRAINT "deliverable_feedback_deliverable_id_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deliverables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverable_feedback" ADD CONSTRAINT "deliverable_feedback_version_id_deliverable_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."deliverable_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverable_feedback" ADD CONSTRAINT "deliverable_feedback_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverable_outbox" ADD CONSTRAINT "deliverable_outbox_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_task_links" ADD CONSTRAINT "feedback_task_links_feedback_id_deliverable_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."deliverable_feedback"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_task_links" ADD CONSTRAINT "feedback_task_links_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deliverable_feedback_version_unique" ON "deliverable_feedback" USING btree ("version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deliverable_feedback_request_unique" ON "deliverable_feedback" USING btree ("project_id","reviewer_id","request_id");--> statement-breakpoint
CREATE INDEX "deliverable_feedback_project_idx" ON "deliverable_feedback" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "deliverable_outbox_pending_idx" ON "deliverable_outbox" USING btree ("delivered_at","created_at");--> statement-breakpoint
CREATE INDEX "feedback_task_links_task_idx" ON "feedback_task_links" USING btree ("task_id");