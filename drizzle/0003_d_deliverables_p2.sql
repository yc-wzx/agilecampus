ALTER TABLE "deliverable_feedback" ADD COLUMN "milestone_snapshot_id" uuid;
--> statement-breakpoint
-- Backfill only verifiable identities. Do not infer a deleted milestone from its title.
UPDATE "deliverable_feedback" f
SET "milestone_snapshot_id" = COALESCE(
  (SELECT v."milestone_id" FROM "deliverable_versions" v
   WHERE v."id" = f."version_id" AND v."deliverable_id" = f."deliverable_id"),
  f."milestone_id"
);
--> statement-breakpoint
-- P1's transactional outbox retains the ID of deleted milestone feedback targets.
UPDATE "deliverable_feedback" f
SET "milestone_snapshot_id" = CASE
  WHEN e."payload"->>'milestoneId' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  THEN (e."payload"->>'milestoneId')::uuid ELSE NULL END
FROM "deliverable_outbox" e
WHERE f."milestone_snapshot_id" IS NULL AND f."version_id" IS NULL AND f."deliverable_id" IS NULL
  AND e."project_id" = f."project_id" AND e."type" = 'milestone.feedback'
  AND e."event_key" = 'milestone.feedback:' || f."id"::text
  AND e."payload"->>'feedbackId' = f."id"::text;
