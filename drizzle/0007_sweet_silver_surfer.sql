CREATE TABLE "iteration_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"created_by_id" uuid NOT NULL,
	"conversation_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"goal" text,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"candidate_tasks" jsonb NOT NULL,
	"source_refs" jsonb,
	"confirmed_iteration_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iteration_histories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"iteration_id" uuid NOT NULL,
	"iteration_snapshot" jsonb NOT NULL,
	"task_snapshots" jsonb NOT NULL,
	"stats" jsonb NOT NULL,
	"dispositions" jsonb NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "iteration_drafts" ADD CONSTRAINT "iteration_drafts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iteration_drafts" ADD CONSTRAINT "iteration_drafts_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iteration_drafts" ADD CONSTRAINT "iteration_drafts_confirmed_iteration_id_iterations_id_fk" FOREIGN KEY ("confirmed_iteration_id") REFERENCES "public"."iterations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iteration_histories" ADD CONSTRAINT "iteration_histories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iteration_histories" ADD CONSTRAINT "iteration_histories_iteration_id_iterations_id_fk" FOREIGN KEY ("iteration_id") REFERENCES "public"."iterations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "iteration_drafts_project_idx" ON "iteration_drafts" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "iteration_drafts_creator_idx" ON "iteration_drafts" USING btree ("created_by_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "iteration_histories_iteration_unique" ON "iteration_histories" USING btree ("iteration_id");--> statement-breakpoint
CREATE INDEX "iteration_histories_project_idx" ON "iteration_histories" USING btree ("project_id","closed_at");