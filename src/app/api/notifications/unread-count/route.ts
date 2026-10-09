import { notificationHttp } from "@/lib/notification-access";
import { getUnreadNotificationCount } from "@/lib/notifications";
export async function GET() {
  return notificationHttp(actorId => getUnreadNotificationCount(actorId));
}
