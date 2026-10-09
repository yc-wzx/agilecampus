import { notificationHttp } from "@/lib/notification-access";
import { markNotificationRead } from "@/lib/notifications";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return notificationHttp(actorId => markNotificationRead(actorId, id), request);
}
