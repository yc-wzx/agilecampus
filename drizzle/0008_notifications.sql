CREATE TABLE IF NOT EXISTS "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "recipient_id" uuid NOT NULL,
  "type" text NOT NULL,
  "title" text NOT NULL,
  "summary" text,
  "source_type" text NOT NULL,
  "source_id" text NOT NULL,
  "href" text NOT NULL,
  "event_key" text NOT NULL,
  "channel" text DEFAULT 'in_app' NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "read_at" timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS "notifications_event_recipient_channel_uq"
ON "notifications" ("event_key", "recipient_id", "channel");

CREATE INDEX IF NOT EXISTS "notifications_recipient_created_idx"
ON "notifications" ("recipient_id", "created_at");

CREATE INDEX IF NOT EXISTS "notifications_recipient_read_idx"
ON "notifications" ("recipient_id", "read_at");
