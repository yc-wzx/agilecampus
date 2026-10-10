ALTER TABLE "personal_schedule_events" ADD COLUMN "share_busy" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "personal_schedule_state" ADD COLUMN "sharing_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "personal_schedule_state" ADD COLUMN "shared_team_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "personal_schedule_state" ADD COLUMN "share_work_plans" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "personal_work_plans" ADD COLUMN "replaces_plan_id" uuid;