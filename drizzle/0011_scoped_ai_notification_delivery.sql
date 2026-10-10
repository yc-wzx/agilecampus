CREATE TABLE "external_notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"error_code" text,
	"delivered_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "scope" text DEFAULT 'project' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "seq" bigserial NOT NULL;--> statement-breakpoint
ALTER TABLE "external_notification_deliveries" ADD CONSTRAINT "external_notification_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_deliveries_notification_unique" ON "external_notification_deliveries" USING btree ("notification_id");--> statement-breakpoint
CREATE INDEX "external_deliveries_retry_idx" ON "external_notification_deliveries" USING btree ("status","next_attempt_at");