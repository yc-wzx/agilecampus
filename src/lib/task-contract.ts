import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  lt,
  ne,
  not,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import type { DbTx } from "@/db";
import {
  taskDependencies,
  tasks,
  users,
  type TaskPriority,
  type TaskStatus,
} from "@/db/schema";
import {
  SUBTASK_PROGRESS_MAX_PARENTS,
  type BacklogFilters,
  type CreateTaskV1Input,
  type DeleteTaskV1Input,
  type DeleteTaskV1Result,
  type PageResult,
  type ProjectTaskStats,
  type SetTaskBlockedInput,
  type SetTaskBlockedResult,
  type SourceRef,
  type SubtaskProgress,
  type TaskAllowedActions,
  type TaskAttentionFilters,
  type TaskAttentionItem,
  type TaskPanelData,
  type TaskStatusValue,
  type TaskSummary,
  type TaskV1Result,
  type UpdateTaskV1Input,
} from "@/contracts/p0-p2";
import { recordProjectActivity } from "./activity";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "./errors";
import { normalizePage, pageResult } from "./pagination";
import { getProjectForUser } from "./project";
import {
  TASK_WRITE_ROLES,
  createTask,
  labelsByTask,
  requireTaskWrite,
  updateTask,
  type TaskLabel,
} from "./task";
import { runIdempotent } from "./write-request";

// C / P0：契约层。定稿 9.2 的 DTO 形状在这里落地，页面与 Agent API 都读这一份。
// 本文件是 sprint_id -> iterationId 的**唯一**映射点：别处再存第二份归属即违反定稿。

export const SUMMARY_COLS = {
  id: tasks.id,
  projectId: tasks.projectId,
  title: tasks.title,
  description: tasks.description,
  acceptanceCriteria: tasks.acceptanceCriteria,
  status: tasks.status,
  priority: tasks.priority,
  startDate: tasks.startDate,
  dueDate: tasks.dueDate,
  sortOrder: tasks.sortOrder,
  milestoneId: tasks.milestoneId,
  parentTaskId: tasks.parentTaskId,
  sprintId: sql<
    string | null
  >`coalesce(${tasks.sprintId}, (select p.sprint_id from tasks p where p.id = ${tasks.parentTaskId} and p.project_id = ${tasks.projectId}))`,
  assigneeId: tasks.assigneeId,
  assigneeName: users.name,
  completionNote: tasks.completionNote,
  isBlocked: tasks.isBlocked,
  blockedReason: tasks.blockedReason,
  blockedAt: tasks.blockedAt,
  updatedAt: tasks.updatedAt,
} as const;

/** SUMMARY_COLS 的取数结果。手写而非推导，靠 listBacklog 等调用点让编译器校验收敛。 */
export type TaskRow = {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  acceptanceCriteria: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  startDate: string | null;
  dueDate: string | null;
  sortOrder: number;
  milestoneId: string | null;
  parentTaskId: string | null;
  sprintId: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  completionNote: string | null;
  isBlocked: boolean;
  blockedReason: string | null;
  blockedAt: Date | null;
  updatedAt: Date;
};

/**
 * DB 行 -> TaskSummary。sprint_id -> iterationId 的唯一映射点。
 *
 * updatedAt 一律 toISOString()：前端须原样回传为 expectedUpdatedAt（定稿 §9.2），
 * 不得在浏览器侧重新生成——那会丢掉与服务端时钟的对齐。
 */
export function toTaskSummary(row: TaskRow): TaskSummary {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    description: row.description,
    status: row.status,
    assigneeId: row.assigneeId,
    assigneeName: row.assigneeName,
    startDate: row.startDate,
    dueDate: row.dueDate,
    priority: row.priority,
    milestoneId: row.milestoneId,
    parentTaskId: row.parentTaskId,
    iterationId: row.sprintId,
    acceptanceCriteria: row.acceptanceCriteria,
    isBlocked: row.isBlocked,
    blockedReason: row.blockedReason,
    blockedAt: row.blockedAt ? row.blockedAt.toISOString() : null,
    completionNote: row.completionNote,
    updatedAt: row.updatedAt.toISOString(),
    sourceHref: `/projects/${row.projectId}?task=${row.id}`,
  };
}

/** 任务池（backlog）的判定条件：无迭代 + 未完成 + 仅主任务。排序/入轮都复用它。 */
export function backlogWhere(projectId: string) {
  return and(
    eq(tasks.projectId, projectId),
    isNull(tasks.sprintId),
    ne(tasks.status, "done"),
    isNull(tasks.parentTaskId),
  );
}

/**
 * 任务池列表（定稿 9.2 的固定服务 listBacklog）。
 * 默认筛选即「无迭代 + 未完成 + 仅主任务」；已完成的任务属于迭代历史，不进任务池。
 */
export async function listBacklog(
  actorId: string,
  projectId: string,
  filters: BacklogFilters = {},
): Promise<PageResult<TaskSummary>> {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();

  const { offset, limit } = normalizePage(filters);
  const where = and(
    backlogWhere(projectId),
    filters.assigneeId ? eq(tasks.assigneeId, filters.assigneeId) : undefined,
    filters.priority ? eq(tasks.priority, filters.priority) : undefined,
  );

  const rows = await db
    .select(SUMMARY_COLS)
    .from(tasks)
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .where(where)
    // sortOrder 由 Date.now() 写入，同毫秒会撞值；补 id 兜底才能保证翻页不重不漏
    .orderBy(asc(tasks.sortOrder), asc(tasks.id))
    .limit(limit)
    .offset(offset);

  const [counted] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(tasks)
    .where(where);

  return pageResult(
    rows.map(toTaskSummary),
    counted?.total ?? 0,
    offset,
    limit,
  );
}

/** 侧边栏一次取回的聚合数据（定稿 9.2 的固定服务 getTaskPanelData）。 */
export async function getTaskPanelData(
  actorId: string,
  projectId: string,
  taskId: string,
): Promise<TaskPanelData> {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();

  // projectId 一并进 where：拿别的项目 id 拼上本项目 taskId 取不到数据，
  // 不必额外做「这个任务属不属于这个项目」的判断。
  const [row] = await db
    .select(SUMMARY_COLS)
    .from(tasks)
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)));
  if (!row) throw new NotFoundError("任务不存在");

  const [labelMap, dependencies, progress] = await Promise.all([
    labelsByTask([taskId]),
    db
      .select({
        predecessorId: taskDependencies.predecessorId,
        successorId: taskDependencies.successorId,
      })
      .from(taskDependencies)
      .where(
        or(
          eq(taskDependencies.predecessorId, taskId),
          eq(taskDependencies.successorId, taskId),
        ),
      ),
    getSubtaskProgressExec(db, taskId),
  ]);

  const canWrite = TASK_WRITE_ROLES.includes(access.role);
  const allowedActions: TaskAllowedActions = {
    edit: canWrite,
    delete: canWrite,
    // 评论由 E 交付。P0 没有可用的评论入口，如实为 false，别假装能评。
    comment: false,
  };

  return {
    task: toTaskSummary(row),
    labels: labelMap.get(taskId) ?? ([] as TaskLabel[]),
    dependencies,
    subtaskProgress: progress,
    allowedActions,
  };
}

/* ------------------------------------------------------------------ *
 * 写（定稿 9.2 的任务 V1 三件套）
 *
 * 三个操作都进事务、都过 write_requests 幂等账本：定稿 §9.1 要求「新变更中使用 requestId
 * 的操作都应保存服务端幂等凭据」。任务 V1 的 requestId 不落 tasks 表——同一个任务会被请求
 * 很多次，把 requestId 塞进任务行是错的。
 * ------------------------------------------------------------------ */

type Exec = DbTx | typeof db;

/** 事务内按 id 取回 TaskSummary（含负责人姓名）。归属不符一律当作「不存在」。 */
async function summaryById(
  exec: Exec,
  projectId: string,
  taskId: string,
): Promise<TaskSummary> {
  const [row] = await exec
    .select(SUMMARY_COLS)
    .from(tasks)
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)));
  if (!row) throw new NotFoundError("任务不存在");
  return toTaskSummary(row);
}

function taskKey(
  projectId: string,
  actorId: string,
  operation: string,
  requestId: string,
) {
  return { projectId, actorId, operation, requestId };
}

export async function createTaskV1(
  actorId: string,
  projectId: string,
  input: CreateTaskV1Input,
): Promise<TaskV1Result> {
  return db.transaction((tx) =>
    runIdempotent(
      tx,
      taskKey(projectId, actorId, "task.create", input.requestId),
      input,
      async () => {
        const created = await createTask(
          actorId,
          projectId,
          {
            title: input.title,
            description: input.description ?? undefined,
            acceptanceCriteria: input.acceptanceCriteria ?? undefined,
            assigneeId: input.assigneeId ?? undefined,
            startDate: input.startDate ?? undefined,
            dueDate: input.dueDate ?? undefined,
            milestoneId: input.milestoneId ?? undefined,
            priority: input.priority,
            parentTaskId: input.parentTaskId ?? undefined,
          },
          { tx },
        );
        const task = await summaryById(tx, projectId, created.id);

        return { task };
      },
    ),
  );
}

export async function updateTaskV1(
  actorId: string,
  projectId: string,
  taskId: string,
  input: UpdateTaskV1Input,
): Promise<TaskV1Result> {
  return db.transaction((tx) =>
    runIdempotent(
      tx,
      taskKey(projectId, actorId, "task.update", input.requestId),
      { taskId, ...input },
      async () => {
        // expectedUpdatedAt 交给 updateTask 在事务内锁行比对（定稿 §9.1：不能光查一次时间）
        const updated = await updateTask(actorId, taskId, input.patch, {
          tx,
          expectedUpdatedAt: input.expectedUpdatedAt,
        });
        const task = await summaryById(tx, projectId, updated.id);

        return { task };
      },
    ),
  );
}

export async function deleteTaskV1(
  actorId: string,
  projectId: string,
  taskId: string,
  input: DeleteTaskV1Input,
): Promise<DeleteTaskV1Result> {
  return db.transaction((tx) =>
    runIdempotent(
      tx,
      taskKey(projectId, actorId, "task.delete", input.requestId),
      { taskId, ...input },
      async () => {
        await requireTaskWrite(actorId, projectId);

        const [task] = await tx
          .select({
            id: tasks.id,
            projectId: tasks.projectId,
            updatedAt: tasks.updatedAt,
          })
          .from(tasks)
          .where(eq(tasks.id, taskId))
          .for("update");
        if (!task || task.projectId !== projectId)
          throw new NotFoundError("任务不存在");

        const expected = new Date(input.expectedUpdatedAt);
        if (
          Number.isNaN(expected.getTime()) ||
          expected.getTime() !== task.updatedAt.getTime()
        ) {
          throw new ConflictError("任务已被他人修改，请刷新后重试");
        }

        await tx.delete(tasks).where(eq(tasks.id, taskId));
        return { taskId, deleted: true as const };
      },
    ),
  );
}

/**
 * C-T07：批量取直接子任务进度。无子任务的父任务也会出现在结果里（total 0、ratio null），
 * 这样调用方不必自己补空位——少一行才是更容易出错的写法。
 */
export async function getSubtaskProgress(
  actorId: string,
  projectId: string,
  parentTaskIds: string[],
): Promise<SubtaskProgress[]> {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();

  const ids = [...new Set(parentTaskIds)];
  if (ids.length === 0) return [];
  if (ids.length > SUBTASK_PROGRESS_MAX_PARENTS) {
    throw new ValidationError(
      `一次最多查询 ${SUBTASK_PROGRESS_MAX_PARENTS} 个父任务`,
    );
  }

  // 父任务本身也要属于本项目：拿别的项目的任务 id 混进来，概览就会算错。
  const owners = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), inArray(tasks.id, ids)));
  if (owners.length !== ids.length) throw new NotFoundError("任务不存在");

  const rows = await db
    .select({
      parentTaskId: tasks.parentTaskId,
      total: sql<number>`count(*)::int`,
      doneCount: sql<number>`(count(*) filter (where ${tasks.status} = 'done'))::int`,
    })
    .from(tasks)
    .where(
      and(eq(tasks.projectId, projectId), inArray(tasks.parentTaskId, ids)),
    )
    .groupBy(tasks.parentTaskId);

  const byParent = new Map(
    rows
      .filter(
        (r): r is typeof r & { parentTaskId: string } =>
          r.parentTaskId !== null,
      )
      .map((r) => [r.parentTaskId, r]),
  );

  return ids.map((parentTaskId) => {
    const row = byParent.get(parentTaskId);
    const total = row?.total ?? 0;
    const doneCount = row?.doneCount ?? 0;
    return {
      parentTaskId,
      total,
      doneCount,
      ratio: total === 0 ? null : doneCount / total,
    };
  });
}

/** 面板只要一个任务的进度，走内部单条查询，不必为它凑一个数组。 */
async function getSubtaskProgressExec(
  exec: Exec,
  parentTaskId: string,
): Promise<SubtaskProgress> {
  const [row] = await exec
    .select({
      total: sql<number>`count(*)::int`,
      doneCount: sql<number>`(count(*) filter (where ${tasks.status} = 'done'))::int`,
    })
    .from(tasks)
    .where(eq(tasks.parentTaskId, parentTaskId));

  const total = row?.total ?? 0;
  const doneCount = row?.doneCount ?? 0;
  return {
    parentTaskId,
    total,
    doneCount,
    ratio: total === 0 ? null : doneCount / total,
  };
}

/**
 * 阻塞 / 解除阻塞。三个字段一起写，不留给调用方分别改的机会——
 * 「解除了阻塞但 blockedAt 还留着」这种不一致状态在数据里最难查。
 */
export async function setTaskBlocked(
  actorId: string,
  projectId: string,
  taskId: string,
  input: SetTaskBlockedInput,
): Promise<SetTaskBlockedResult> {
  return db.transaction((tx) =>
    runIdempotent(
      tx,
      taskKey(projectId, actorId, "task.block", input.requestId),
      { taskId, ...input },
      async () => {
        await requireTaskWrite(actorId, projectId);

        const [task] = await tx
          .select({
            id: tasks.id,
            projectId: tasks.projectId,
            updatedAt: tasks.updatedAt,
            isBlocked: tasks.isBlocked,
            blockedReason: tasks.blockedReason,
          })
          .from(tasks)
          .where(eq(tasks.id, taskId))
          .for("update");
        if (!task || task.projectId !== projectId)
          throw new NotFoundError("任务不存在");

        const expected = new Date(input.expectedUpdatedAt);
        if (
          Number.isNaN(expected.getTime()) ||
          expected.getTime() !== task.updatedAt.getTime()
        ) {
          throw new ConflictError("任务已被他人修改，请刷新后重试");
        }

        const reason = input.blockedReason?.trim() ?? "";
        if (input.isBlocked && reason === "") {
          throw new ValidationError("阻塞任务时请填写原因");
        }

        await tx
          .update(tasks)
          .set({
            isBlocked: input.isBlocked,
            blockedReason: input.isBlocked ? reason : null,
            blockedAt: input.isBlocked
              ? sql`coalesce(${tasks.blockedAt}, now())`
              : null,
            updatedAt: sql`greatest(date_trunc('milliseconds', clock_timestamp()), date_trunc('milliseconds', ${tasks.updatedAt}) + interval '1 millisecond')`,
          })
          .where(eq(tasks.id, taskId));

        // 名字不复用上面的 task：那一份是带行锁的原始行，这里是给调用方的 TaskSummary
        const updated = await summaryById(tx, projectId, taskId);
        const changedState = task.isBlocked !== input.isBlocked;
        const changedReason =
          task.blockedReason !== (input.isBlocked ? reason : null);
        const type = changedState
          ? input.isBlocked
            ? "task.blocked"
            : "task.unblocked"
          : "task.updated";
        if (changedState || changedReason)
          await recordProjectActivity(tx, {
            eventKey: `${type}:${taskId}:${updated.updatedAt}`,
            projectId,
            actorId,
            objectType: "task",
            objectId: taskId,
            type,
            summary: !changedState
              ? `更新了任务《${updated.title}》的阻塞原因`
              : input.isBlocked
                ? `阻塞了任务《${updated.title}》`
                : `解除了任务《${updated.title}》的阻塞`,
            occurredAt: updated.updatedAt,
            // 阻塞原因的原文是私有协作内容，活动里只留长度，不留正文
            metadata: {
              ...(!changedState
                ? { taskId, changedFields: ["blockedReason"] }
                : input.isBlocked
                  ? { taskId, blockedReasonLength: reason.length }
                  : { taskId }),
              iterationId: updated.iterationId,
              milestoneId: updated.milestoneId,
              assigneeId: updated.assigneeId,
            },
          });
        return { task: updated };
      },
    ),
  );
}

/* ------------------------------------------------------------------ *
 * P2：项目级统计与「需关注任务」（C-T08 / C-T09）
 * ------------------------------------------------------------------ */

/** 北京时间「今天」的 YYYY-MM-DD。服务端算，不让浏览器定这个话语权。 */
function todayInBeijing(now = new Date()): string {
  return new Date(now.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * C-T08 项目任务统计。口径固定为主任务：子任务不计入，否则一个父任务会被算两次。
 * total 为 0 时 doneRatio 是 null——「没有任务」与「一个都没做完」是两回事。
 */
export async function getProjectTaskStats(
  actorId: string,
  projectId: string,
): Promise<ProjectTaskStats> {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();

  const today = todayInBeijing();
  const rows = await db
    .select({
      status: tasks.status,
      dueDate: tasks.dueDate,
      isBlocked: tasks.isBlocked,
    })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), isNull(tasks.parentTaskId)));

  const byStatus: Record<TaskStatusValue, number> = {
    todo: 0,
    doing: 0,
    done: 0,
  };
  let overdueCount = 0;
  let blockedCount = 0;

  for (const row of rows) {
    byStatus[row.status] += 1;
    if (row.isBlocked) blockedCount += 1;
    // 没有日期不算逾期；已完成也不算
    if (row.status !== "done" && row.dueDate !== null && row.dueDate < today)
      overdueCount += 1;
  }

  const total = rows.length;
  return {
    projectId,
    asOf: new Date().toISOString(),
    scope: "main-tasks",
    byStatus,
    total,
    doneRatio: total === 0 ? null : byStatus.done / total,
    overdueCount,
    blockedCount,
  };
}

/** 任务来源引用。evidenceKey 用 `task:{id}`，稳定且不随标题改名而变。 */
function taskSourceRef(projectId: string, taskId: string): SourceRef {
  return {
    sourceKind: "task",
    sourceId: taskId,
    projectId,
    sourceHref: `/projects/${projectId}?task=${taskId}`,
    evidenceKey: `task:${taskId}`,
    availability: "available",
  };
}

/**
 * C-T09 需关注任务。kind 必传，因为「逾期」和「阻塞」判据完全不同，页面也要分开列。
 * 逾期按 dueDate < 今天且未完成；阻塞按 isBlocked。两者都只数主任务，与 C-T08 同一口径。
 */
export async function listProjectTaskAttention(
  actorId: string,
  projectId: string,
  filters: TaskAttentionFilters,
): Promise<PageResult<TaskAttentionItem>> {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();

  const { offset, limit } = normalizePage(filters);
  const today = todayInBeijing();

  const where = and(
    eq(tasks.projectId, projectId),
    isNull(tasks.parentTaskId),
    ne(tasks.status, "done"),
    filters.kind === "overdue"
      ? // 没有日期不算逾期——这一点在 risk 标准里也写死了，两处必须一致
        and(not(isNull(tasks.dueDate)), lt(tasks.dueDate, today))
      : eq(tasks.isBlocked, true),
  );

  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      dueDate: tasks.dueDate,
      blockedAt: tasks.blockedAt,
    })
    .from(tasks)
    .where(where)
    // 越该被看到的排越前：逾期久的在前，阻塞久的在前
    .orderBy(
      asc(filters.kind === "overdue" ? tasks.dueDate : tasks.blockedAt),
      asc(tasks.id),
    )
    .limit(limit)
    .offset(offset);

  const [counted] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(tasks)
    .where(where);

  const items: TaskAttentionItem[] = rows.map((row) => ({
    taskId: row.id,
    title: row.title,
    dueDate: row.dueDate,
    blockedAt: row.blockedAt ? row.blockedAt.toISOString() : null,
    sourceRef: taskSourceRef(projectId, row.id),
  }));

  return pageResult(items, counted?.total ?? 0, offset, limit);
}
