import { NextResponse } from "next/server";
import { scanAndRecordDueReminders } from "@/lib/notification-reminders";
import { dispatchExternalNotifications } from "@/lib/notification";
import { dispatchDeliverableEvents } from "@/lib/deliverable-events";
import { handleDeliverableEvent } from "@/lib/deliverable-sink";

// 定时提醒端点：外部调度每日打一次。CRON_SECRET 为唯一护栏。
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  const provided = header
    ? /^Bearer\s+(.+)$/i.exec(header.trim())?.[1]?.trim()
    : null;
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  try {
    const outbox = await dispatchDeliverableEvents(handleDeliverableEvent);
    const reminders = await scanAndRecordDueReminders();
    const external = await dispatchExternalNotifications();
    return NextResponse.json({
      notified: external.sent,
      tasksScanned: reminders.scanned,
      reminders,
      external,
      outboxDelivered: outbox.delivered,
      outboxFailed: outbox.failed,
    });
  } catch (e) {
    console.error("[/api/cron/reminders]", e);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
