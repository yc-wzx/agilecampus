import {
  index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipientId: uuid("recipient_id").notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    href: text("href").notNull(),
    eventKey: text("event_key").notNull(),
    channel: text("channel").notNull().default("in_app"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("notifications_event_recipient_channel_uq")
      .on(t.eventKey, t.recipientId, t.channel),
    index("notifications_recipient_created_idx").on(t.recipientId, t.createdAt),
    index("notifications_recipient_read_idx").on(t.recipientId, t.readAt),
  ],
);
export * from "./schema/notifications";
