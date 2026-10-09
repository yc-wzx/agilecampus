"use server";
import { revalidatePath } from "next/cache";
import { notificationResult } from "@/lib/notification-access";
import { markNotificationRead, markAllNotificationsRead } from "@/lib/notifications";
import type { MarkAllNotificationsInput } from "@/contracts/p0-p2";

function refresh() {
  try { revalidatePath("/", "layout"); }
  catch { console.error("[notifications] cache refresh failed"); }
}
export async function markNotificationReadAction(notificationId: string) {
  const result = await notificationResult(actorId => markNotificationRead(actorId, notificationId));
  if (result.ok) refresh();
  return result;
}
export async function markAllNotificationsReadAction(input: MarkAllNotificationsInput) {
  const result = await notificationResult(actorId => markAllNotificationsRead(actorId, input));
  if (result.ok) refresh();
  return result;
}
