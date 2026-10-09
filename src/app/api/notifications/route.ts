import { notificationFilters, notificationHttp } from "@/lib/notification-access";
import { listMyNotifications } from "@/lib/notifications";
export async function GET(request: Request) {
  return notificationHttp(actorId => listMyNotifications(actorId, notificationFilters(new URL(request.url).searchParams)));
}
