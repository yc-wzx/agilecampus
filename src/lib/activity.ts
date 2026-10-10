import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbTx } from "@/db";
import { projectActivities, projects, teamMembers } from "@/db/schema";
import {
  ACTIVITY_EVENT_TYPES,
  ACTIVITY_OBJECT_TYPES,
  type ActivityFilters,
  type ActivityItem,
  type ActivityObjectType,
  type ActivityPage,
  type QueryCoverage,
  type RecordProjectActivityInput,
} from "@/contracts/p0-p2";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import { normalizePage, pageResult } from "./pagination";
import { getProjectForUser } from "./project";

// E / P0：通用项目活动（定稿 §9.4 E-A01/A02）。
//
// 两条铁律：
//   1. 只追加。活动记的是「已经发生过的业务操作」，写错了也不能改，更不能事后用
//      updatedAt 倒推——定稿明令「活动只记发生过的业务操作，不用 updatedAt 猜完成事件」。
//   2. metadata 只装白名单里的 ID 与状态，绝不装正文。任务描述、验收标准、完成说明、
//      迭代目标、复盘正文、评论内容、阻塞原因原文都不进这张表。
//
// 这里不做成员校验：recordProjectActivity 是给「已有业务事务」内部调用的，
// 调用方那条事务（如 createTaskV1）已经授权过了。读服务 listProjectActivities 才查权限。

const uuid = z.uuid("标识格式不正确");
const paging = {
  offset: z.number().int().min(0).max(100000).default(0),
  limit: z.number().int().min(1).max(100).default(50),
};

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new ValidationError(result.error.issues[0].message);
  return result.data;
}

/**
 * 每种活动允许写入的 metadata 键。
 * 没登记的类型（例如尚未实现的 comment.* / announcement.*）一律不许带 metadata，
 * 免得后来人顺手把不该留的正文塞进去。新增类型时先在这里登记。
 */
const METADATA_KEYS: Record<string, readonly string[]> = {
  "task.created": [
    "taskId",
    "changedFields",
    "status",
    "assigneeId",
    "dueDate",
    "iterationId",
  ],
  "task.updated": [
    "taskId",
    "changedFields",
    "fromStatus",
    "toStatus",
    "fromAssigneeId",
    "toAssigneeId",
    "dueDate",
    "iterationId",
  ],
  "task.completed": ["taskId", "fromStatus", "iterationId"],
  "task.reopened": ["taskId", "fromStatus", "iterationId"],
  "task.assigned": ["taskId", "fromAssigneeId", "toAssigneeId"],
  // 只留长度，不留原因原文
  "task.blocked": ["taskId", "blockedReasonLength"],
  "task.unblocked": ["taskId"],
  "iteration.started": ["iterationId"],
  "iteration.completed": [
    "iterationId",
    "historyId",
    "taskTotal",
    "doneCount",
    "doneRatio",
  ],
  "retrospective.saved": ["iterationId", "retrospectiveId", "revision"],
  "comment.created": ["taskId", "commentId", "mentionedUserIds", "revision"],
  "comment.updated": ["taskId", "commentId", "mentionedUserIds", "revision"],
  "comment.deleted": ["taskId", "commentId", "mentionedUserIds", "revision"],
  "announcement.published": ["announcementId", "revision"],
  "announcement.withdrawn": ["announcementId", "revision"],
  // D 的事件经 §8 的 sink 映射进来
  "deliverable.submitted": ["deliverableId", "versionId"],
  "deliverable.approved": [
    "deliverableId",
    "versionId",
    "feedbackId",
    "decision",
  ],
  "deliverable.changes_requested": [
    "deliverableId",
    "versionId",
    "feedbackId",
    "decision",
  ],
  "milestone.feedback": ["milestoneId", "feedbackId"],
  "feedback.task_created": ["feedbackId", "taskId"],
};

function assertMetadataAllowed(
  type: string,
  metadata: Record<string, unknown> | undefined,
) {
  const keys = Object.keys(metadata ?? {});
  if (keys.length === 0) return;
  const allowed = METADATA_KEYS[type];
  if (!allowed) {
    throw new ValidationError(
      `活动类型 ${type} 尚未登记 metadata 白名单，不能携带额外信息`,
    );
  }
  const historicalFields =
    type.startsWith("task.") || type.startsWith("comment.")
      ? ["iterationId", "milestoneId", "assigneeId"]
      : [];
  const unknown = keys.filter(
    (key) => !allowed.includes(key) && !historicalFields.includes(key),
  );
  if (unknown.length > 0) {
    throw new ValidationError(
      `活动 ${type} 的 metadata 含未允许字段：${unknown.join("、")}`,
    );
  }
}

const recordSchema = z
  .object({
    eventKey: z.string().trim().min(1, "eventKey 不能为空").max(300),
    projectId: uuid,
    actorId: uuid,
    objectType: z.enum(ACTIVITY_OBJECT_TYPES),
    objectId: uuid,
    type: z.enum(ACTIVITY_EVENT_TYPES),
    summary: z.string().trim().min(1, "活动摘要不能为空").max(500),
    occurredAt: z.iso.datetime("occurredAt 必须是 ISO 时间"),
    metadata: z
      .record(
        z.string(),
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.null(),
          z.array(z.string()),
        ]),
      )
      .optional(),
  })
  .strict();

const listSchema = z
  .object({
    ...paging,
    objectType: z.enum(ACTIVITY_OBJECT_TYPES).optional(),
    objectId: uuid.optional(),
    actorId: uuid.optional(),
    fromDate: z.iso.date().optional(),
    toDate: z.iso.date().optional(),
  })
  .strict()
  .refine(
    (v) => !v.fromDate || !v.toDate || v.fromDate < v.toDate,
    "结束日期必须晚于开始日期（结束日不包含在内）",
  );

type ActivityRow = typeof projectActivities.$inferSelect;

function toActivityItem(row: ActivityRow): ActivityItem {
  return {
    id: row.id,
    eventKey: row.eventKey,
    projectId: row.projectId,
    actorId: row.actorId,
    objectType: row.objectType as ActivityObjectType,
    objectId: row.objectId,
    type: row.type,
    summary: row.summary,
    occurredAt: row.occurredAt.toISOString(),
    sourceRef: {
      sourceKind: "activity",
      sourceId: row.id,
      projectId: row.projectId,
      // 定稿 §9.1 只为任务/迭代/成果/评论/公告规定了深链接参数，没给活动定。
      // 不自己发明 URL：把活动映射到底层对象的路由是 E-V01（P2）的活。
      sourceHref: null,
      evidenceKey: `activity:${row.id}`,
      availability: "available",
    },
  };
}

/* ------------------------------------------------------------------ *
 * 覆盖说明
 * ------------------------------------------------------------------ */

/**
 * 纯函数：按「库里最早一条活动」算出覆盖说明，不碰数据库，便于单测。
 *
 * 活动记录是这次才上线的，之前发生过的操作没有任何留痕。所以 availableFrom 是
 * 真实最早记录时间（没有记录就是 null），不用「上线日期」之类的说法冒充；
 * 请求窗口起点早于它时，complete 一律为 false。
 */
export function computeActivityCoverageFromMin(
  minIso: string | null,
  fromDate?: string,
): QueryCoverage {
  if (minIso === null) {
    return {
      availableFrom: null,
      complete: false,
      note: "本项目还没有任何活动记录。活动只从记录功能上线后开始，此前的操作没有留痕，不代表没有发生过。",
    };
  }
  // 同为 ISO UTC 字符串，字典序即时间序
  const windowStart = fromDate
    ? new Date(`${fromDate}T00:00:00+08:00`).toISOString()
    : null;
  return {
    availableFrom: minIso,
    complete: windowStart !== null && windowStart >= minIso,
    note: "活动记录自可用起点起可核验；此前的操作没有回填，不代表没有发生过。",
  };
}

function currentMember(actorId: string) {
  return sql`exists (select 1 from ${projects} p join ${teamMembers} m on m.team_id = p.team_id
    where p.id = ${projectActivities.projectId} and m.user_id = ${actorId})`;
}
async function activityCoverage(
  actorId: string,
  projectId: string,
  fromDate?: string,
): Promise<QueryCoverage> {
  const [row] = await db
    .select({ min: sql<Date | null>`min(${projectActivities.occurredAt})` })
    .from(projectActivities)
    .where(
      and(eq(projectActivities.projectId, projectId), currentMember(actorId)),
    );
  const minIso = row?.min ? new Date(row.min).toISOString() : null;
  return computeActivityCoverageFromMin(minIso, fromDate);
}

/* ------------------------------------------------------------------ *
 * 写（E-A01）
 * ------------------------------------------------------------------ */

/**
 * 追加一条活动。必须在业务事务内调用，与主操作同生共死——业务回滚了，这条也跟着消失。
 *
 * 幂等靠 event_key 的唯一索引：同一 eventKey 重放不会写出第二行（定稿 §8
 * 「同一事件可能重复送达，因此重放不能产生第二条活动」）。冲突时回查并返回已存在的那条，
 * 让调用方始终拿到落库后的 ActivityItem。
 */
export async function recordProjectActivity(
  tx: DbTx,
  event: RecordProjectActivityInput,
): Promise<ActivityItem> {
  const data = parse(recordSchema, event);
  assertMetadataAllowed(data.type, data.metadata);

  const [row] = await tx
    .insert(projectActivities)
    .values({
      eventKey: data.eventKey,
      projectId: data.projectId,
      actorId: data.actorId,
      objectType: data.objectType,
      objectId: data.objectId,
      type: data.type,
      summary: data.summary,
      metadata: data.metadata ?? {},
      occurredAt: new Date(data.occurredAt),
    })
    .onConflictDoNothing({ target: projectActivities.eventKey })
    .returning();

  if (row) return toActivityItem(row);

  // 冲突 = 这条 eventKey 已经有了。同事务内能读到先写的那一行。
  const [existing] = await tx
    .select()
    .from(projectActivities)
    .where(eq(projectActivities.eventKey, data.eventKey));
  if (!existing) throw new ConflictError("活动事件正在写入，请重试");
  if (
    existing.projectId !== data.projectId ||
    existing.actorId !== data.actorId ||
    existing.type !== data.type
  ) {
    throw new ConflictError("活动事件标识已用于其他业务");
  }
  return toActivityItem(existing);
}

/* ------------------------------------------------------------------ *
 * 读（E-A02 / E-A03）
 * ------------------------------------------------------------------ */

/**
 * 项目活动列表。occurredAt 倒序 + id 升序（定稿 §9.4 定死的顺序，补 id 保证翻页稳定）。
 *
 * 非本项目成员与不存在的项目返回同一个「项目不存在或无权访问」，不泄露项目是否存在
 * ——沿用同目录 listProjectIterations 的口径。
 */
export async function listProjectActivities(
  actorId: string,
  projectId: string,
  filters: ActivityFilters = {},
): Promise<ActivityPage> {
  parse(uuid, actorId);
  parse(uuid, projectId);
  const data = parse(listSchema, filters);

  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new NotFoundError("项目不存在或无权访问");

  const { offset, limit } = normalizePage(data);
  const where = and(
    eq(projectActivities.projectId, projectId),
    currentMember(actorId),
    data.objectType
      ? eq(projectActivities.objectType, data.objectType)
      : undefined,
    data.objectId ? eq(projectActivities.objectId, data.objectId) : undefined,
    data.actorId ? eq(projectActivities.actorId, data.actorId) : undefined,
    // 北京时间：起始日包含、结束日不包含。中国无夏令时，固定 +08:00 即可。
    data.fromDate
      ? gte(
          projectActivities.occurredAt,
          new Date(`${data.fromDate}T00:00:00+08:00`),
        )
      : undefined,
    data.toDate
      ? lt(
          projectActivities.occurredAt,
          new Date(`${data.toDate}T00:00:00+08:00`),
        )
      : undefined,
  );

  const [counted] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(projectActivities)
    .where(where);

  const rows = await db
    .select()
    .from(projectActivities)
    .where(where)
    .orderBy(desc(projectActivities.occurredAt), asc(projectActivities.id))
    .limit(limit)
    .offset(offset);

  // 空结果就是空结果：items 空数组、total 0，不抛异常、不用 0 冒充失败。
  return {
    ...pageResult(rows.map(toActivityItem), counted?.total ?? 0, offset, limit),
    coverage: await activityCoverage(actorId, projectId, data.fromDate),
  };
}

/**
 * E-A03：按 id 取一条活动作为证据。活动表里只有白名单摘要与 ID，
 * 没有私有草稿正文，所以按当前权限读到的内容不会泄露已经失去权限的正文。
 */
export async function getActivityEvidence(
  actorId: string,
  projectId: string,
  activityId: string,
): Promise<ActivityItem> {
  parse(uuid, actorId);
  parse(uuid, projectId);
  parse(uuid, activityId);

  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new NotFoundError("项目不存在或无权访问");

  const [row] = await db
    .select()
    .from(projectActivities)
    .where(
      and(
        eq(projectActivities.id, activityId),
        eq(projectActivities.projectId, projectId),
        currentMember(actorId),
      ),
    );
  if (!row) throw new NotFoundError("活动不存在");
  return toActivityItem(row);
}
