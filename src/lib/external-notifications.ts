import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  externalNotificationDeliveries as deliveries,
  notifications,
  users,
} from "@/db/schema";
import { NotificationDeliveryError } from "./notification-delivery-error";
import { sendCardMessage } from "./feishu";

function configured() {
  return !!process.env.FEISHU_APP_ID && !!process.env.FEISHU_APP_SECRET;
}
export async function getMyNotificationChannels(actorId: string) {
  z.uuid().parse(actorId);
  const [user] = await db
    .select({ openId: users.feishuOpenId })
    .from(users)
    .where(eq(users.id, actorId));
  const [last] = await db
    .select({ status: deliveries.status })
    .from(deliveries)
    .innerJoin(notifications, eq(notifications.id, deliveries.notificationId))
    .where(
      and(
        eq(notifications.recipientId, actorId),
        sql`exists(select 1 from projects p join team_members m on m.team_id=p.team_id where p.id=${notifications.projectId} and m.user_id=${actorId})`,
      ),
    )
    .orderBy(desc(deliveries.updatedAt))
    .limit(1);
  return {
    inAppEnabled: true as const,
    feishuBound: !!user?.openId,
    externalStatus: (!user?.openId
      ? "unbound"
      : !configured()
        ? "unconfigured"
        : last && ["failed", "uncertain"].includes(last.status)
          ? "failed"
          : "configured") as
      "unbound" | "unconfigured" | "failed" | "configured",
  };
}
type Match = { sourceId: string; type: string };
async function dispatch(limit: number, match?: Match) {
  z.number().int().min(1).max(100).parse(limit);
  let sent = 0,
    failed = 0,
    skipped = 0;
  if (!configured()) {
    const [pending] = await db.execute<{ count: number }>(
      sql`select count(*)::int count from external_notification_deliveries d join notifications n on n.id=d.notification_id where d.status in ('pending','failed') ${match ? sql`and n.source_id=${match.sourceId} and n.type=${match.type}` : sql``}`,
    );
    return { sent, failed, skipped: pending.count };
  }
  await db
    .update(deliveries)
    .set({
      status: "uncertain",
      errorCode: "WORKER_INTERRUPTED",
      updatedAt: sql`now()`,
    })
    .where(
      sql`${deliveries.status}='sending' and ${deliveries.leaseUntil}<now()`,
    );
  for (let i = 0; i < limit; i++) {
    const claimed = await db.transaction(async (tx) => {
      const rows = await tx.execute<{
        id: string;
        notificationId: string;
        attempts: number;
        openId: string;
      }>(sql`select d.id,d.notification_id as "notificationId",d.attempts,u.feishu_open_id as "openId" from external_notification_deliveries d join notifications n on n.id=d.notification_id join users u on u.id=n.recipient_id
        where d.status in ('pending','failed') and d.next_attempt_at<=now() and u.feishu_open_id is not null ${match ? sql`and n.source_id=${match.sourceId} and n.type=${match.type}` : sql``} order by d.next_attempt_at,d.id for update of d skip locked limit 1`);
      const row = rows[0];
      if (!row) return null;
      const [n] = await tx
        .select()
        .from(notifications)
        .where(eq(notifications.id, row.notificationId));
      const members = await tx.execute(
        sql`select m.user_id from projects p join team_members m on m.team_id=p.team_id where p.id=${n.projectId} and p.status<>'archived' and m.user_id=${n.recipientId} and (${n.type}<>'deliverable.submitted' or m.role in ('admin','teacher')) for share of p,m`,
      );
      const sourceTables: Record<string, string> = {
        task: "tasks",
        iteration: "iterations",
        comment: "task_comments",
        announcement: "announcements",
        deliverable: "deliverables",
        feedback: "deliverable_feedback",
      };
      const table = sourceTables[n.sourceType];
      const source = table
        ? await tx.execute(
            sql`select * from ${sql.identifier(table)} where id::text=${n.sourceId} and project_id=${n.projectId} ${n.sourceType === "comment" ? sql`and deleted_at is null` : n.sourceType === "announcement" ? sql`and status='published'` : sql``} for share`,
          )
        : [];
      const task = source[0];
      const staleDue =
        ["task.overdue", "task.due_soon"].includes(n.type) &&
        (!task ||
          task.status === "done" ||
          task.assignee_id !== n.recipientId ||
          !n.eventKey.includes(`:${task.due_date}:`));
      if (!members.length || !source.length || staleDue) {
        await tx
          .update(deliveries)
          .set({
            status: "skipped",
            errorCode: "SOURCE_OR_ACCESS_CHANGED",
            updatedAt: sql`now()`,
          })
          .where(eq(deliveries.id, row.id));
        return { skipped: true as const };
      }
      await tx
        .update(deliveries)
        .set({
          status: "sending",
          attempts: row.attempts + 1,
          leaseUntil: new Date(Date.now() + 60000),
          updatedAt: sql`now()`,
        })
        .where(eq(deliveries.id, row.id));
      return { ...row, notification: n, skipped: false as const };
    });
    if (!claimed) break;
    if (claimed.skipped) {
      skipped++;
      continue;
    }
    try {
      const n = claimed.notification,
        source = n.href || `/projects/${n.projectId}`;
      const card = {
        config: { wide_screen_mode: true },
        header: {
          template: "blue",
          title: { tag: "plain_text", content: n.title },
        },
        elements: [
          {
            tag: "div",
            text: { tag: "plain_text", content: n.summary ?? n.title },
          },
          {
            tag: "action",
            actions: [
              {
                tag: "button",
                text: { tag: "plain_text", content: "查看来源" },
                type: "primary",
                url: new URL(
                  source,
                  process.env.AGILECAMPUS_URL ?? "http://localhost:3000",
                ).href,
              },
            ],
          },
        ],
      };
      await sendCardMessage(claimed.openId, card);
      await db
        .update(deliveries)
        .set({
          status: "sent",
          deliveredAt: sql`now()`,
          leaseUntil: null,
          errorCode: null,
          updatedAt: sql`now()`,
        })
        .where(
          and(eq(deliveries.id, claimed.id), eq(deliveries.status, "sending")),
        );
      sent++;
    } catch (error) {
      const definite =
        error instanceof NotificationDeliveryError &&
        error.certainty === "rejected";
      const code =
        error instanceof NotificationDeliveryError
          ? error.code
          : "RESULT_UNKNOWN";
      await db
        .update(deliveries)
        .set({
          status: definite ? "failed" : "uncertain",
          errorCode: code,
          leaseUntil: null,
          nextAttemptAt: new Date(
            Date.now() +
              Math.min(3600000, 60000 * 2 ** Math.min(claimed.attempts, 6)),
          ),
          updatedAt: sql`now()`,
        })
        .where(
          and(eq(deliveries.id, claimed.id), eq(deliveries.status, "sending")),
        );
      failed++;
    }
  }
  return { sent, failed, skipped };
}
export async function dispatchExternalNotifications(limit = 50) {
  return dispatch(limit);
}
export async function dispatchTaskNotification(sourceId: string, type: string) {
  return dispatch(20, { sourceId, type });
}
