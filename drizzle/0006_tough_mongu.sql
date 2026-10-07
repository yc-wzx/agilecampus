DROP INDEX "iteration_events_iteration_idx";--> statement-breakpoint
ALTER TABLE "iteration_events" ADD COLUMN "seq" bigserial NOT NULL;--> statement-breakpoint
CREATE INDEX "iteration_events_iteration_idx" ON "iteration_events" USING btree ("iteration_id","seq");