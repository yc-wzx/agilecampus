CREATE TYPE "public"."iteration_status" AS ENUM('planned', 'active', 'completed');--> statement-breakpoint
CREATE TABLE "iterations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"goal" text,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" "iteration_status" DEFAULT 'planned' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "write_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"request_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "sprint_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "acceptance_criteria" text;--> statement-breakpoint
ALTER TABLE "iterations" ADD CONSTRAINT "iterations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "write_requests" ADD CONSTRAINT "write_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "iterations_one_active_per_project" ON "iterations" USING btree ("project_id") WHERE "iterations"."status" = 'active';--> statement-breakpoint
CREATE INDEX "iterations_project_idx" ON "iterations" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "write_requests_unique" ON "write_requests" USING btree ("project_id","actor_id","operation","request_id");--> statement-breakpoint
CREATE INDEX "write_requests_created_idx" ON "write_requests" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_sprint_id_iterations_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."iterations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_sprint_idx" ON "tasks" USING btree ("sprint_id");