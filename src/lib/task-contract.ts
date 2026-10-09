import { and, asc, eq, inArray, isNull, lt, ne, not, or, sql } from "drizzle-orm";
import { db } from "@/db";
import type { DbTx } from "@/db";
import { taskDependencies, tasks, users, type TaskPriority, type TaskStatus } from "@/db/schema";
import {
  SUBTASK_PROGRESS_MAX_PARENTS,
  type BacklogFilters,
  type CreateTaskV1Input,
  type DeleteTaskV1Input,
  type DeleteTaskV1Result,
  type PageResult,
  type ProjectTaskStats,
  type RecordProjectActivityInput,
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
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors";
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
  sprintId: sql<string | null>`coalesce(${tasks.sprintId}, (select p.sprint_id from tasks p where p.id = ${tasks.parentTaskId} and p.project_id = ${tasks.projectId}))`,
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

/* ------------------------------------------------------------------ *
 * E / P0：任务活动（定稿 §9.4 事件目录）
 *
 * 三个 V1 写操作在各自事务里追加活动，与业务同生共死。一次修改可以产生不同 type、
 * 各最多一条；metadata 只放 ID 与状态，任务的描述 / 验收标准 / 完成说明正文一律不进
 * ——那是 E-A01 侧的 metadata 白名单在兜底，这里从源头就不传。
 * ------------------------------------------------------------------ */

/** 任务活动的事件键。带上写入后的 updatedAt：同一操作重放只会落一条。 */
function taskActivityKey(type: string, taskId: string, occurredAt: string) {
  return `${type}:${taskId}:${occurredAt}`;
}

/** 活动摘要里用的字段中文名。只用于拼句子，不影响落库字段。 */
const TASK_FIELD_LABELS: Record<string, string> = {
  title: "标题",
  description: "描述",
  acceptanceCriteria: "验收标准",
  startDate: "开始日期",
  dueDate: "截止日期",
  milestoneId: "里程碑",
  priority: "优先级",
  status: "状态",
  completionNote: "完成说明",
};

/** 丢掉 undefined 的 metadata 构造器：「没传这个字段」与「传了 null」在活动里是两回事。 */
function meta(
  entries: Record<string, string | number | boolean | null | string[] | undefined>,
): Record<string, string | number | boolean | null | string[]> {
  const out: Record<string, string | number | boolean | null | string[]> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** 改任务前的快照。没有它就分不清「改成 done」和「本来就是 done」，无法定事件类型。 */
type TaskBeforeSnapshot = {
  title: string;
  description: string | null;
  acceptanceCriteria: string | null;
  status: TaskStatus;
  assigneeId: string | null;
  startDate: string | null;
  dueDate: string | null;
  milestoneId: string | null;
  priority: TaskPriority;
  completionNote: string | null;
};

/** updateTaskV1 的 patch 里除 status / assigneeId 之外还能改的字段（各对应一个中文名）。 */
const TASK_PATCH_FIELDS = [
  "title",
  "description",
  "acceptanceCriteria",
  "startDate",
  "dueDate",
  "milestoneId",
  "priority",
  "completionNote",
] as const;

async function recordTaskUpdateActivities(
  tx: DbTx,
  args: {
    actorId: string;
    projectId: string;
    task: TaskSummary;
    before: TaskBeforeSnapshot;
    patch: UpdateTaskV1Input["patch"];
  },
): Promise<void> {
  const { actorId, projectId, task, before, patch } = args;
  const objectType = "task" as const;
  const occurredAt = task.updatedAt;
  const events: RecordProjectActivityInput[] = [];

  // 状态：只有「非完成 -> 完成」算完成，「完成 -> 非完成」算重开。
  // todo <-> doing 没有对应的事件类型，退回 task.updated——不硬把它说成 completed。
  const changedFields: string[] = [];
  if (patch.status !== undefined && patch.status !== before.status) {
    if (before.status !== "done" && patch.status === "done") {
      events.push({
        eventKey: taskActivityKey("task.completed", task.id, occurredAt),
        projectId,
        actorId,
        objectType,
        objectId: task.id,
        type: "task.completed",
        summary: `完成了任务《${task.title}》`,
        occurredAt,
        metadata: meta({
          taskId: task.id,
          iterationId: task.iterationId,
          fromStatus: before.status,
        }),
      });
    } else if (before.status === "done" && patch.status !== "done") {
      events.push({
        eventKey: taskActivityKey("task.reopened", task.id, occurredAt),
        projectId,
        actorId,
        objectType,
        objectId: task.id,
        type: "task.reopened",
        summary: `重新打开了任务《${task.title}》`,
        occurredAt,
        metadata: meta({
          taskId: task.id,
          iterationId: task.iterationId,
          fromStatus: before.status,
        }),
      });
    } else {
      changedFields.push("status");
    }
  }

  // 改派单列一条：负责人变更值得在动态里被单独看见。清空负责人走同一个 type，摘要如实写。
  if (patch.assigneeId !== undefined && patch.assigneeId !== before.assigneeId) {
    events.push({
      eventKey: taskActivityKey("task.assigned", task.id, occurredAt),
      projectId,
      actorId,
      objectType,
      objectId: task.id,
      type: "task.assigned",
      summary: task.assigneeName
        ? `把任务《${task.title}》指派给 ${task.assigneeName}`
        : `取消了任务《${task.title}》的负责人`,
      occurredAt,
      metadata: meta({
        taskId: task.id,
        fromAssigneeId: before.assigneeId,
        toAssigneeId: task.assigneeId,
      }),
    });
  }

  // 其余变化合成**一条** task.updated，变了的字段名列进 changedFields。
  // 拆成多条会撞同一个事件键——同任务、同类型、同 updatedAt 只允许一条。
  for (const field of TASK_PATCH_FIELDS) {
    if (patch[field] !== undefined && patch[field] !== before[field]) changedFields.push(field);
  }

  if (changedFields.length > 0) {
    const labels = changedFields.map((field) => TASK_FIELD_LABELS[field] ?? field).join("、");
    events.push({
      eventKey: taskActivityKey("task.updated", task.id, occurredAt),
      projectId,
      actorId,
      objectType,
      objectId: task.id,
      type: "task.updated",
      summary: `更新了任务《${task.title}》的${labels}`,
      occurredAt,
      metadata: meta({
        taskId: task.id,
        iterationId: task.iterationId,
        changedFields,
        fromStatus: before.status,
        toStatus: task.status,
        fromAssigneeId: before.assigneeId,
        toAssigneeId: task.assigneeId,
        dueDate: task.dueDate,
      }),
    });
  }

  for (const event of events) await recordProjectActivity(tx, event);
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
        await recordProjectActivity(tx, {
          eventKey: `task.created:${task.id}`,
          projectId,
          actorId,
          objectType: "task",
          objectId: task.id,
          type: "task.created",
          summary: `创建了任务《${task.title}》`,
          occurredAt: task.updatedAt,
          metadata: meta({
            taskId: task.id,
            status: task.status,
            assigneeId: task.assigneeId,
            dueDate: task.dueDate,
            iterationId: task.iterationId,
          }),
        });
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
        // 改之前的快照。这一步不加行锁——真正的乐观锁在 updateTask 里（它 for("update")
        // 后比对 expectedUpdatedAt）；这份快照只用来算「这次改了什么」。
        const [before] = await tx
          .select({
            title: tasks.title,
            description: tasks.description,
            acceptanceCriteria: tasks.acceptanceCriteria,
            status: tasks.status,
            assigneeId: tasks.assigneeId,
            startDate: tasks.startDate,
            dueDate: tasks.dueDate,
            milestoneId: tasks.milestoneId,
            priority: tasks.priority,
            completionNote: tasks.completionNote,
          })
          .from(tasks)
          .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)));
        if (!before) throw new NotFoundError("任务不存在");

        // expectedUpdatedAt 交给 updateTask 在事务内锁行比对（定稿 §9.1：不能光查一次时间）
        const updated = await updateTask(actorId, taskId, input.patch, {
          tx,
          expectedUpdatedAt: input.expectedUpdatedAt,
        });
        const task = await summaryById(tx, projectId, updated.id);
        await recordTaskUpdateActivities(tx, {
          actorId,
          projectId,
          task,
          before,
          patch: input.patch,
        });
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
    throw new ValidationError(`一次最多查询 ${SUBTASK_PROGRESS_MAX_PARENTS} 个父任务`);
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
    .where(and(eq(tasks.projectId, projectId), inArray(tasks.parentTaskId, ids)))
    .groupBy(tasks.parentTaskId);

  const byParent = new Map(
    rows
      .filter((r): r is typeof r & { parentTaskId: string } => r.parentTaskId !== null)
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
async function getSubtaskProgressExec(exec: Exec, parentTaskId: string): Promise<SubtaskProgress> {
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
          .select({ id: tasks.id, projectId: tasks.projectId, updatedAt: tasks.updatedAt })
          .from(tasks)
          .where(eq(tasks.id, taskId))
          .for("update");
        if (!task || task.projectId !== projectId) throw new NotFoundError("任务不存在");

        const expected = new Date(input.expectedUpdatedAt);
        if (Number.isNaN(expected.getTime()) || expected.getTime() !== task.updatedAt.getTime()) {
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
            blockedAt: input.isBlocked ? sql`coalesce(${tasks.blockedAt}, now())` : null,
            updatedAt: sql`now()`,
          })
          .where(eq(tasks.id, taskId));

        // 名字不复用上面的 task：那一份是带行锁的原始行，这里是给调用方的 TaskSummary
        const updated = await summaryById(tx, projectId, taskId);
        const type = input.isBlocked ? "task.blocked" : "task.unblocked";
        await recordProjectActivity(tx, {
          eventKey: taskActivityKey(type, taskId, updated.updatedAt),
          projectId,
          actorId,
          objectType: "task",
          objectId: taskId,
          type,
          summary: input.isBlocked
            ? `阻塞了任务《${updated.title}》`
            : `解除了任务《${updated.title}》的阻塞`,
          occurredAt: updated.updatedAt,
          // 阻塞原因的原文是私有协作内容，活动里只留长度，不留正文
          metadata: meta(
            input.isBlocked
              ? { taskId, blockedReasonLength: reason.length }
              : { taskId },
          ),
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

  const byStatus: Record<TaskStatusValue, number> = { todo: 0, doing: 0, done: 0 };
  let overdueCount = 0;
  let blockedCount = 0;

  for (const row of rows) {
    byStatus[row.status] += 1;
    if (row.isBlocked) blockedCount += 1;
    // 没有日期不算逾期；已完成也不算
    if (row.status !== "done" && row.dueDate !== null && row.dueDate < today) overdueCount += 1;
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
    .select({ id: tasks.id, title: tasks.title, dueDate: tasks.dueDate, blockedAt: tasks.blockedAt })
    .from(tasks)
    .where(where)
    // 越该被看到的排越前：逾期久的在前，阻塞久的在前
    .orderBy(asc(filters.kind === "overdue" ? tasks.dueDate : tasks.blockedAt), asc(tasks.id))
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
