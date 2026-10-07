import { and, asc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import type { DbTx } from "@/db";
import { taskDependencies, tasks, users, type TaskPriority, type TaskStatus } from "@/db/schema";
import type {
  BacklogFilters,
  CreateTaskV1Input,
  DeleteTaskV1Input,
  DeleteTaskV1Result,
  PageResult,
  SubtaskProgress,
  TaskAllowedActions,
  TaskPanelData,
  TaskSummary,
  TaskV1Result,
  UpdateTaskV1Input,
} from "@/contracts/p0-p2";
import { ConflictError, ForbiddenError, NotFoundError } from "./errors";
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
  sprintId: tasks.sprintId,
  assigneeId: tasks.assigneeId,
  assigneeName: users.name,
  completionNote: tasks.completionNote,
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
  updatedAt: Date;
};

/**
 * DB 行 -> TaskSummary。sprint_id -> iterationId 的唯一映射点。
 *
 * isBlocked/blockedReason/blockedAt 是 P1 才落库的列，此处先返回字面量。
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
    isBlocked: false,
    blockedReason: null,
    blockedAt: null,
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

  return pageResult(rows.map(toTaskSummary), counted?.total ?? 0, offset, limit);
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
    getSubtaskProgress(taskId),
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
async function summaryById(exec: Exec, projectId: string, taskId: string): Promise<TaskSummary> {
  const [row] = await exec
    .select(SUMMARY_COLS)
    .from(tasks)
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)));
  if (!row) throw new NotFoundError("任务不存在");
  return toTaskSummary(row);
}

function taskKey(projectId: string, actorId: string, operation: string, requestId: string) {
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
        return { task: await summaryById(tx, projectId, created.id) };
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
        // 上面只校验了「有本项目的写权限」，任务本身可能属于别的项目：
        // 归属不符时这里取不到行，事务整体回滚。
        return { task: await summaryById(tx, projectId, updated.id) };
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
          .select({ id: tasks.id, projectId: tasks.projectId, updatedAt: tasks.updatedAt })
          .from(tasks)
          .where(eq(tasks.id, taskId))
          .for("update");
        if (!task || task.projectId !== projectId) throw new NotFoundError("任务不存在");

        const expected = new Date(input.expectedUpdatedAt);
        if (Number.isNaN(expected.getTime()) || expected.getTime() !== task.updatedAt.getTime()) {
          throw new ConflictError("任务已被他人修改，请刷新后重试");
        }

        await tx.delete(tasks).where(eq(tasks.id, taskId));
        return { taskId, deleted: true as const };
      },
    ),
  );
}

/** 直接子任务进度。无子任务时 ratio 为 null（不是 0，也不是 100%）。 */
export async function getSubtaskProgress(parentTaskId: string): Promise<SubtaskProgress> {
  const [row] = await db
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
