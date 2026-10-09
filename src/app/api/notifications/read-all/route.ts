import { notificationBody, notificationHttp } from "@/lib/notification-access";
import { markAllNotificationsRead } from "@/lib/notifications";

export async function POST(request: Request) {
  return notificationHttp(async actorId => markAllNotificationsRead(actorId, await notificationBody(request)), request);
}
