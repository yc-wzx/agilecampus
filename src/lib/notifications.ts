import { and, asc, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbTx } from "@/db";
import {
  notifications,
  externalNotificationDeliveries,
  notificationReadRequests,
  projects,
  teamMembers,
  tasks,
  iterations,
  deliverables,
  deliverableFeedback,
  taskComments,
  announcements,
} from "@/db/schema";
export {
  dispatchExternalNotifications,
  getMyNotificationChannels,
} from "./external-notifications";
import {
  SOURCE_KINDS,
  type MarkAllNotificationsInput,
  type NotificationFilters,
  type NotificationItem,
  type RecordNotificationIntentInput,
  type SourceRef,
} from "@/contracts/p0-p2";
import { ConflictError, ForbiddenError, ValidationError } from "./errors";
import { pageResult } from "./pagination";
import { hashRequest } from "./write-request";

const uuid = z.uuid();
const filterSchema = z.strictObject({
  offset: z.number().int().min(0).max(100000).default(0),
  limit: z.number().int().min(1).max(100).default(50),
  unreadOnly: z.boolean().optional(),
  projectId: uuid.optional(),
});
const sourceSchema = z.strictObject({
  sourceKind: z.enum(SOURCE_KINDS),
  sourceId: uuid,
  projectId: uuid,
  sourceHref: z.string().max(1000).nullable(),
  evidenceKey: z.string().max(300),
  availability: z.enum(["available", "deleted", "unavailable"]),
});
const intentSchema = z.strictObject({
  eventKey: z.string().min(1).max(300),
  projectId: uuid,
  actorId: uuid,
  type: z.string().min(1).max(100),
  recipientIds: z.array(uuid).max(1000),
  sourceRef: sourceSchema,
  summary: z.string().trim().min(1).max(500),
});
const allSchema = z.strictObject({
  requestId: uuid,
  beforeCreatedAt: z.iso.datetime({ offset: true }),
  projectId: uuid.optional(),
});
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new ValidationError(parsed.error.issues[0].message);
  return parsed.data;
}

// 每次读取 SQL 都核验当前成员；被降为学生后不再读取审核者收到的提交摘要。
function visible(actorId: string, projectId?: string) {
  return and(
    eq(notifications.recipientId, actorId),
    projectId ? eq(notifications.projectId, projectId) : undefined,
    sql`exists (select 1 from ${projects} p join ${teamMembers} m on m.team_id = p.team_id
      where p.id = ${notifications.projectId} and m.user_id = ${actorId}
      and (${notifications.type} <> 'deliverable.submitted' or m.role in ('admin', 'teacher')))`,
  );
}
async function requireProject(actorId: string, projectId: string) {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .innerJoin(teamMembers, eq(teamMembers.teamId, projects.teamId))
    .where(and(eq(projects.id, projectId), eq(teamMembers.userId, actorId)));
  if (!rows.length) throw new ForbiddenError("项目不存在或无权访问");
}
const TITLES: Record<string, string> = {
  "task.assigned": "任务指派",
  "iteration.completed": "迭代已结束",
  "deliverable.submitted": "成果待验收",
  "deliverable.approved": "成果已通过",
  "deliverable.changes_requested": "成果需要修改",
  "milestone.feedback": "新的阶段反馈",
  "feedback.task_created": "反馈已关联修改任务",
  "comment.mentioned": "评论中提及你",
  "announcement.published": "项目公告",
  "task.completed": "任务已完成",
  "task.due_soon": "任务即将到期",
  "task.overdue": "任务逾期提醒",
};

export async function recordNotificationIntent(
  tx: DbTx,
  input: RecordNotificationIntentInput,
): Promise<{ createdCount: number }> {
  const data = parse(intentSchema, input);
  const root = `/projects/${data.projectId}`;
  if (
    data.sourceRef.projectId !== data.projectId ||
    (data.sourceRef.sourceHref !== null &&
      data.sourceRef.sourceHref !== root &&
      !data.sourceRef.sourceHref.startsWith(root + "/") &&
      !data.sourceRef.sourceHref.startsWith(root + "?"))
  )
    throw new ValidationError("通知来源不属于项目");
  const recipients = [...new Set(data.recipientIds)].filter(
    (id) => id !== data.actorId,
  );
  if (!recipients.length) return { createdCount: 0 };
  const members = await tx
    .select({ id: teamMembers.userId, role: teamMembers.role })
    .from(teamMembers)
    .innerJoin(projects, eq(projects.teamId, teamMembers.teamId))
    .where(
      and(
        eq(projects.id, data.projectId),
        inArray(teamMembers.userId, recipients),
      ),
    )
    .for("share", { of: [projects, teamMembers] });
  const rows = members.filter(
    (m) => data.type !== "deliverable.submitted" || m.role !== "student",
  );
  if (!rows.length) return { createdCount: 0 };
  const inserted = await tx
    .insert(notifications)
    .values(
      rows.map((m) => ({
        eventKey: data.eventKey,
        recipientId: m.id,
        projectId: data.projectId,
        type: data.type,
        title: TITLES[data.type] ?? "项目通知",
        summary: data.summary,
        sourceType: data.sourceRef.sourceKind,
        sourceId: data.sourceRef.sourceId,
        href: data.sourceRef.sourceHref ?? "",
        metadata: { sourceRef: data.sourceRef },
        channel: "in_app",
      })),
    )
    .onConflictDoNothing()
    .returning({ id: notifications.id });
  if (inserted.length)
    await tx
      .insert(externalNotificationDeliveries)
      .values(inserted.map((row) => ({ notificationId: row.id })))
      .onConflictDoNothing();
  return { createdCount: inserted.length };
}
type Row = typeof notifications.$inferSelect;
async function item(row: Row): Promise<NotificationItem> {
  const tables = {
    task: tasks,
    iteration: iterations,
    deliverable: deliverables,
    feedback: deliverableFeedback,
    comment: taskComments,
    announcement: announcements,
  };
  const table = tables[row.sourceType as keyof typeof tables];
  const exists = table
    ? (
        await db
          .select({ id: table.id })
          .from(table)
          .where(
            and(
              eq(table.id, row.sourceId),
              eq(table.projectId, row.projectId),
              row.sourceType === "comment"
                ? isNull(taskComments.deletedAt)
                : row.sourceType === "announcement"
                  ? eq(announcements.status, "published")
                  : undefined,
            ),
          )
          .limit(1)
      ).length > 0
    : false;
  const stored = row.metadata?.sourceRef as SourceRef | undefined;
  const sourceRef: SourceRef = {
    sourceKind: row.sourceType as SourceRef["sourceKind"],
    sourceId: row.sourceId,
    projectId: row.projectId,
    sourceHref: exists ? row.href || null : null,
    evidenceKey: stored?.evidenceKey ?? `notification:${row.id}`,
    availability: exists ? "available" : "deleted",
  };
  return {
    id: row.id,
    eventKey: row.eventKey,
    recipientId: row.recipientId,
    projectId: row.projectId,
    type: row.type,
    title: row.title,
    summary: exists ? row.summary : "来源已删除",
    sourceRef,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
  };
}
export async function listMyNotifications(
  actorId: string,
  filters: NotificationFilters = {},
) {
  parse(uuid, actorId);
  const data = parse(filterSchema, filters);
  if (data.projectId) await requireProject(actorId, data.projectId);
  const where = and(
    visible(actorId, data.projectId),
    data.unreadOnly ? isNull(notifications.readAt) : undefined,
  );
  const [count] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(notifications)
    .where(where);
  const rows = await db
    .select()
    .from(notifications)
    .where(where)
    .orderBy(desc(notifications.createdAt), asc(notifications.id))
    .limit(data.limit)
    .offset(data.offset);
  return pageResult(
    await Promise.all(rows.map(item)),
    count.total,
    data.offset,
    data.limit,
  );
}
export async function getUnreadNotificationCount(
  actorId: string,
): Promise<{ count: number; asOf: string }> {
  parse(uuid, actorId);
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      asOf: sql<string>`to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    })
    .from(notifications)
    .where(and(visible(actorId), isNull(notifications.readAt)));
  return { count: row.count, asOf: row.asOf };
}
export async function markNotificationRead(
  actorId: string,
  notificationId: string,
) {
  parse(uuid, actorId);
  parse(uuid, notificationId);
  const [row] = await db
    .update(notifications)
    .set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
    .where(and(eq(notifications.id, notificationId), visible(actorId)))
    .returning();
  if (!row) throw new ForbiddenError("通知不存在或无权访问");
  return { id: row.id, readAt: row.readAt!.toISOString() };
}
export async function markAllNotificationsRead(
  actorId: string,
  input: MarkAllNotificationsInput,
) {
  parse(uuid, actorId);
  const data = parse(allSchema, input);
  if (data.projectId) await requireProject(actorId, data.projectId);
  return db.transaction(async (tx) => {
    const [clock] = await tx
      .select({
        time: sql<string>`to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        future: sql<boolean>`${data.beforeCreatedAt}::timestamptz > now()`,
      })
      .from(sql`(select 1) as clock`);
    const asOf = clock.time;
    if (clock.future) throw new ValidationError("已读时间不能晚于服务器时间");
    const requestHash = hashRequest(data);
    const [claim] = await tx
      .insert(notificationReadRequests)
      .values({ recipientId: actorId, requestId: data.requestId, requestHash })
      .onConflictDoNothing()
      .returning();
    if (!claim) {
      const [old] = await tx
        .select()
        .from(notificationReadRequests)
        .where(
          and(
            eq(notificationReadRequests.recipientId, actorId),
            eq(notificationReadRequests.requestId, data.requestId),
          ),
        );
      if (!old || old.requestHash !== requestHash || !old.result)
        throw new ConflictError("请求标识已用于不同内容");
      return old.result;
    }
    const marked = await tx
      .update(notifications)
      .set({ readAt: sql`now()` })
      .where(
        and(
          visible(actorId, data.projectId),
          isNull(notifications.readAt),
          lte(
            notifications.createdAt,
            sql`${data.beforeCreatedAt}::timestamptz`,
          ),
        ),
      )
      .returning({ id: notifications.id });
    const result = { markedCount: marked.length, asOf };
    await tx
      .update(notificationReadRequests)
      .set({ result })
      .where(eq(notificationReadRequests.id, claim.id));
    return result;
  });
}
