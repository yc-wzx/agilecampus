import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";

export async function createNotification(input: {
  recipientId: string; type: string; title: string;
  summary?: string | null; sourceType: string; sourceId: string;
  href: string; eventKey: string;
}) {
  const [row] = await db.insert(notifications).values({
    ...input, summary: input.summary ?? null, channel: "in_app",
  }).onConflictDoNothing().returning();
  return row ?? null;
}

export async function listNotifications(userId: string, limit = 50) {
  return db.select().from(notifications)
    .where(eq(notifications.recipientId, userId))
    .orderBy(desc(notifications.createdAt)).limit(limit);
}

export async function getUnreadCount(userId: string) {
  const [row] = await db.select({ c: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.recipientId, userId), isNull(notifications.readAt)));
  return row?.c ?? 0;
}

export async function markNotificationRead(id: string, userId: string) {
  const [row] = await db.update(notifications).set({ readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.recipientId, userId)))
    .returning();
  return row ?? null;
}

export async function markAllNotificationsRead(userId: string) {
  await db.update(notifications).set({ readAt: new Date() })
    .where(and(eq(notifications.recipientId, userId), isNull(notifications.readAt)));
}
