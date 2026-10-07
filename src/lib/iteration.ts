import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import type { DbTx } from "@/db";
import {
  iterationEvents,
  iterationHistories,
  iterations,
  projects,
  retrospectives,
  tasks,
  teamMembers,
  users,
  type IterationStatus,
} from "@/db/schema";
import type {
  AssignTasksInput,
  AssignTasksResult,
  CompleteIterationInput,
  CompleteIterationResult,
  CreateIterationInput,
  CurrentIteration,
  DeletePlannedIterationResult,
  Iteration,
  IterationCompletionPreview,
  IterationDetail,
  IterationEventType,
  IterationHistory,
  IterationHistoryEntry,
  IterationListFilters,
  IterationRevisionInput,
  IterationStats,
  IterationTaskVersion,
  MyActiveIteration,
  PageInput,
  PageResult,
  ReorderBacklogInput,
  ReorderBacklogResult,
  Retrospective,
  SaveRetrospectiveInput,
  SaveRetrospectiveResult,
  TaskSummary,
  UnfinishedDisposition,
  UpdateIterationInput,
} from "@/contracts/p0-p2";
import { ConflictError, NotFoundError, ValidationError, isUniqueViolation } from "./errors";
import { normalizePage, pageResult } from "./pagination";
import { getProjectForUser } from "./project";
import { requireTaskWrite } from "./task";
import { SUMMARY_COLS, backlogWhere, toTaskSummary, type TaskRow } from "./task-contract";
import { runIdempotent } from "./write-request";

// C / P0：迭代服务（定稿 9.3）。
//
// 三件事在这里一并落地，九个写操作共用：
//   1. 事务。状态变更 / revision 自增 / startedAt 必须原子。
//   2. 幂等。带 requestId 的操作走 write_requests 账本，重放原样吐回首次结果。
//   3. 乐观锁。迭代按 revision、任务按 updatedAt，一律先锁行再比对（定稿 §9.1 明令
//      「不能只查一次时间后无条件覆盖」）。

/** 排序中点的安全间距与「间距耗尽」阈值。sortOrder 初值是 Date.now()，正常远大于此。 */
const SORT_GAP = 1024;
const SORT_EPS = 1e-6;

type IterationRow = {
  id: string;
  projectId: string;
  name: string;
  goal: string | null;
  startDate: string;
  endDate: string;
  status: IterationStatus;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
};

/** DB 行 -> Iteration DTO。时间一律 ISO 串，与 TaskSummary.updatedAt 同一口径。 */
function toIteration(row: IterationRow): Iteration {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    goal: row.goal,
    startDate: row.startDate,
    endDate: row.endDate,
    status: row.status,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

type RetrospectiveRow = {
  id: string;
  projectId: string;
  iterationId: string;
  wentWell: string | null;
  problems: string | null;
  nextActions: string | null;
  authorId: string;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
};

function toRetrospective(row: RetrospectiveRow): Retrospective {
  return {
    id: row.id,
    projectId: row.projectId,
    iterationId: row.iterationId,
    wentWell: row.wentWell,
    problems: row.problems,
    nextActions: row.nextActions,
    authorId: row.authorId,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * 追加一条迭代事件流水。只 insert，不 update——流水一旦写下就不再改，
 * 所以并发的两个写操作各写各的，不会互相覆盖。
 *
 * 与主操作同一个事务：主操作回滚时这条流水一并消失，正好——没发生的事不该留痕。
 */
async function recordEvent(
  tx: DbTx,
  projectId: string,
  iterationId: string,
  type: IterationEventType,
  actorId: string | null,
  payload?: unknown,
): Promise<void> {
  await tx.insert(iterationEvents).values({
    projectId,
    iterationId,
    type,
    actorId,
    payload: payload ?? null,
  });
}

function assertDateRange(startDate: string, endDate: string) {
  if (!(startDate <= endDate)) {
    throw new ValidationError("迭代开始日期不能晚于结束日期");
  }
}

function requestKey(projectId: string, actorId: string, operation: string, requestId: string) {
  return { projectId, actorId, operation, requestId };
}

/** 锁住迭代行、校验归属与版本，返回当前行。写路径一律先过这里。 */
async function lockIteration(
  tx: DbTx,
  projectId: string,
  iterationId: string,
  expectedRevision?: number,
): Promise<IterationRow> {
  const [row] = await tx
    .select()
    .from(iterations)
    .where(and(eq(iterations.id, iterationId), eq(iterations.projectId, projectId)))
    .for("update");
  if (!row) throw new NotFoundError("迭代不存在");
  if (expectedRevision !== undefined && row.revision !== expectedRevision) {
    throw new ConflictError("迭代已被他人修改，请刷新后重试");
  }
  return row;
}

async function bumpRevision(tx: DbTx, iterationId: string) {
  const [row] = await tx
    .update(iterations)
    .set({ revision: sql`${iterations.revision} + 1`, updatedAt: sql`now()` })
    .where(eq(iterations.id, iterationId))
    .returning();
  return row as IterationRow;
}

/* ------------------------------------------------------------------ *
 * 读
 * ------------------------------------------------------------------ */

/** 迭代列表。默认按开始日期倒序（近的在前），补 id 保证翻页稳定。 */
export async function listProjectIterations(
  actorId: string,
  projectId: string,
  filters: IterationListFilters = {},
): Promise<PageResult<Iteration>> {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new NotFoundError("项目不存在或无权访问");

  const { offset, limit } = normalizePage(filters);
  const where = and(
    eq(iterations.projectId, projectId),
    filters.status ? eq(iterations.status, filters.status) : undefined,
  );

  const rows = await db
    .select()
    .from(iterations)
    .where(where)
    .orderBy(desc(iterations.startDate), desc(iterations.createdAt), asc(iterations.id))
    .limit(limit)
    .offset(offset);

  const [counted] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(iterations)
    .where(where);

  return pageResult(rows.map(toIteration), counted?.total ?? 0, offset, limit);
}

/** 迭代统计口径：仅主任务（parentTaskId 为空），与 CurrentIteration.scope 的 "main-tasks" 对齐。 */
async function iterationStats(taskIds: string[]): Promise<IterationStats> {
  if (taskIds.length === 0) return { taskTotal: 0, doneCount: 0, doneRatio: 0 };
  const [row] = await db
    .select({
      taskTotal: sql<number>`count(*)::int`,
      doneCount: sql<number>`(count(*) filter (where ${tasks.status} = 'done'))::int`,
    })
    .from(tasks)
    .where(and(inArray(tasks.id, taskIds), sql`${tasks.parentTaskId} is null`));

  const taskTotal = row?.taskTotal ?? 0;
  const doneCount = row?.doneCount ?? 0;
  return { taskTotal, doneCount, doneRatio: taskTotal === 0 ? 0 : doneCount / taskTotal };
}

async function loadIterationTasks(projectId: string, iterationId: string): Promise<TaskRow[]> {
  return db
    .select(SUMMARY_COLS)
    .from(tasks)
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .where(and(eq(tasks.projectId, projectId), eq(tasks.sprintId, iterationId)))
    .orderBy(asc(tasks.sortOrder), asc(tasks.id));
}

export async function getIterationDetail(
  actorId: string,
  projectId: string,
  iterationId: string,
): Promise<IterationDetail> {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new NotFoundError("项目不存在或无权访问");

  const [row] = await db
    .select()
    .from(iterations)
    .where(and(eq(iterations.id, iterationId), eq(iterations.projectId, projectId)));
  if (!row) throw new NotFoundError("迭代不存在");

  const [taskRows, history, retrospective] = await Promise.all([
    loadIterationTasks(projectId, iterationId),
    loadIterationHistory(iterationId),
    loadRetrospective(iterationId),
  ]);

  // 活动轮看当前，结束轮看快照（定稿 9.3 C-I04）。
  // 结束时未完成的任务已经搬走，现查 tasks 只会剩下当时就完成的那几个；更要紧的是
  // 「不可变」——任务后来被改名/删除都不该让这一轮的历史跟着变，所以已结束的轮一律读快照。
  if (row.status === "completed") {
    const snapshot = await loadHistorySnapshot(projectId, iterationId);
    if (snapshot) {
      return {
        iteration: toIteration(row),
        tasks: snapshot.taskSnapshots,
        stats: snapshot.stats,
        history,
        retrospective,
      };
    }
  }

  const stats = await iterationStats(taskRows.map((t) => t.id));

  return {
    iteration: toIteration(row),
    tasks: taskRows.map(toTaskSummary),
    stats,
    history,
    retrospective,
  };
}

/** 本轮结束时的快照。没写过（理论上不该发生）就返回 null，由调用方退回现查。 */
async function loadHistorySnapshot(
  projectId: string,
  iterationId: string,
): Promise<IterationHistory | null> {
  const [row] = await db
    .select()
    .from(iterationHistories)
    .where(
      and(
        eq(iterationHistories.iterationId, iterationId),
        eq(iterationHistories.projectId, projectId),
      ),
    );
  if (!row) return null;

  return {
    historyId: row.id,
    iterationId: row.iterationId,
    closedAt: row.closedAt.toISOString(),
    iterationSnapshot: row.iterationSnapshot as Iteration,
    taskSnapshots: row.taskSnapshots as TaskSummary[],
    stats: row.stats as IterationStats,
    dispositions: row.dispositions as UnfinishedDisposition[],
  };
}

/** 迭代流水，早的在前（回看时按时间读最自然）。按 seq 而非 createdAt 定序，见 schema 注释。 */
async function loadIterationHistory(iterationId: string): Promise<IterationHistoryEntry[]> {
  const rows = await db
    .select({
      id: iterationEvents.id,
      type: iterationEvents.type,
      actorId: iterationEvents.actorId,
      createdAt: iterationEvents.createdAt,
    })
    .from(iterationEvents)
    .where(eq(iterationEvents.iterationId, iterationId))
    .orderBy(asc(iterationEvents.seq));

  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    at: r.createdAt.toISOString(),
    actorId: r.actorId,
  }));
}

/** 复盘至多一份（DB 唯一索引兜底）。null = 还没写，与「迭代没结束」是两回事。 */
async function loadRetrospective(iterationId: string): Promise<Retrospective | null> {
  const [row] = await db
    .select()
    .from(retrospectives)
    .where(eq(retrospectives.iterationId, iterationId));
  return row ? toRetrospective(row) : null;
}

/** 当前迭代 = 唯一 active 的那轮。没有 active 轮时返回 null（不是抛错）。 */
export async function getCurrentIteration(
  actorId: string,
  projectId: string,
): Promise<CurrentIteration | null> {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new NotFoundError("项目不存在或无权访问");

  const [row] = await db
    .select()
    .from(iterations)
    .where(and(eq(iterations.projectId, projectId), eq(iterations.status, "active")));
  if (!row) return null;

  const taskRows = await loadIterationTasks(projectId, row.id);
  const stats = await iterationStats(taskRows.map((t) => t.id));

  return {
    ...toIteration(row),
    ...stats,
    scope: "main-tasks",
    asOf: new Date().toISOString(),
    sourceHref: `/projects/${projectId}/iterations/${row.id}`,
  };
}

/* ------------------------------------------------------------------ *
 * 写
 * ------------------------------------------------------------------ */

export async function createIteration(
  actorId: string,
  projectId: string,
  input: CreateIterationInput,
): Promise<Iteration> {
  await requireTaskWrite(actorId, projectId);
  if (!input.name.trim()) throw new ValidationError("迭代名称不能为空");
  assertDateRange(input.startDate, input.endDate);

  return db.transaction((tx) =>
    runIdempotent(
      tx,
      requestKey(projectId, actorId, "iteration.create", input.requestId),
      input,
      async () => {
        const [row] = await tx
          .insert(iterations)
          .values({
            projectId,
            name: input.name,
            goal: input.goal ?? null,
            startDate: input.startDate,
            endDate: input.endDate,
            status: "planned",
            revision: 1,
          })
          .returning();
        await recordEvent(tx, projectId, row.id, "created", actorId, {
          name: row.name,
          startDate: row.startDate,
          endDate: row.endDate,
        });
        return toIteration(row);
      },
    ),
  );
}

/**
 * 建迭代 + 挂任务的事务内核。
 *
 * AI 草案确认（C-AI02）要在同一个事务里顺手把草案标记为已确认，所以内核只负责
 * 「建轮 + 归任务」，事务与幂等由调用方包。
 *
 * 与 createIteration + assignTasks 两步走相比：这里所有任务都往**全新的**迭代里放，
 * 不存在「谁先占了」的竞争，但草案是拿几分钟前的快照做的，期间任务可能已被别人排走、
 * 做完、或改了版本。所以逐个比对，有任何一个对不上就整体回滚，而不是悄悄少挂几个。
 *
 * expectedTaskVersions 传了就逐个比对 updatedAt；不传则只校验「此刻还在任务池里」。
 */
export async function createIterationWithTasksTx(
  tx: DbTx,
  actorId: string,
  projectId: string,
  input: {
    name: string;
    goal?: string | null;
    startDate: string;
    endDate: string;
    taskIds: string[];
    expectedTaskVersions?: IterationTaskVersion[];
  },
): Promise<{ iteration: Iteration; assignedTaskIds: string[] }> {
  if (!input.name.trim()) throw new ValidationError("迭代名称不能为空");
  assertDateRange(input.startDate, input.endDate);

  // 草案里同一个任务被列两次时只挂一次
  const taskIds = [...new Set(input.taskIds)];

  const [row] = await tx
    .insert(iterations)
    .values({
      projectId,
      name: input.name,
      goal: input.goal ?? null,
      startDate: input.startDate,
      endDate: input.endDate,
      status: "planned",
      revision: 1,
    })
    .returning();
  await recordEvent(tx, projectId, row.id, "created", actorId, {
    name: row.name,
    startDate: row.startDate,
    endDate: row.endDate,
  });

  if (taskIds.length > 0) {
    const locked = await tx
      .select({
        id: tasks.id,
        sprintId: tasks.sprintId,
        status: tasks.status,
        parentTaskId: tasks.parentTaskId,
        updatedAt: tasks.updatedAt,
      })
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), inArray(tasks.id, taskIds)))
      .for("update");
    if (locked.length !== taskIds.length) {
      throw new ConflictError("草案中的任务已被改动，请重新预览");
    }

    const baseline = input.expectedTaskVersions
      ? new Map(input.expectedTaskVersions.map((v) => [v.taskId, v.updatedAt]))
      : null;
    if (baseline && baseline.size !== taskIds.length) {
      throw new ConflictError("草案中的任务已被改动，请重新预览");
    }

    for (const t of locked) {
      if (t.sprintId !== null) throw new ConflictError("草案中的任务已被排入别的迭代，请重新预览");
      if (t.status === "done") throw new ConflictError("草案中的任务已完成，请重新预览");
      if (t.parentTaskId !== null) throw new ConflictError("草案中含子任务，请重新预览");
      if (baseline) {
        const expected = baseline.get(t.id);
        // 时间戳精度：postgres 微秒 vs JS 毫秒，只能比毫秒值，不能比字符串
        if (expected === undefined || new Date(expected).getTime() !== t.updatedAt.getTime()) {
          throw new ConflictError("草案中的任务已被改动，请重新预览");
        }
      }
    }

    await tx
      .update(tasks)
      .set({ sprintId: row.id, updatedAt: sql`now()` })
      .where(inArray(tasks.id, taskIds));
    await recordEvent(tx, projectId, row.id, "tasks_assigned", actorId, { taskIds });
  }

  return { iteration: toIteration(row), assignedTaskIds: [...taskIds] };
}

/** 独立入口：自开事务 + 幂等。AI 草案确认走 createIterationWithTasksTx，不经过这里。 */
export async function createIterationWithTasks(
  actorId: string,
  projectId: string,
  input: {
    requestId: string;
    name: string;
    goal?: string | null;
    startDate: string;
    endDate: string;
    taskIds: string[];
  },
): Promise<{ iteration: Iteration; assignedTaskIds: string[] }> {
  await requireTaskWrite(actorId, projectId);

  return db.transaction((tx) =>
    runIdempotent(
      tx,
      requestKey(projectId, actorId, "iteration.create_with_tasks", input.requestId),
      input,
      () => createIterationWithTasksTx(tx, actorId, projectId, input),
    ),
  );
}

export async function updateIteration(
  actorId: string,
  projectId: string,
  iterationId: string,
  input: UpdateIterationInput,
): Promise<Iteration> {
  await requireTaskWrite(actorId, projectId);

  return db.transaction((tx) =>
    runIdempotent(
      tx,
      requestKey(projectId, actorId, "iteration.update", input.requestId),
      { iterationId, ...input },
      async () => {
        const current = await lockIteration(tx, projectId, iterationId, input.expectedRevision);
        // 定稿 9.3 C-I02：仅 planned 允许改基本字段。进行中的轮改日期会让
        // 「本轮应该做完什么」在成员眼皮底下变，任务归属与统计都跟着漂——要改就新开一轮。
        if (current.status !== "planned") {
          throw new ConflictError("只有计划中的迭代才能修改名称、目标与日期");
        }

        const startDate = input.startDate ?? current.startDate;
        const endDate = input.endDate ?? current.endDate;
        assertDateRange(startDate, endDate);

        const [row] = await tx
          .update(iterations)
          .set({
            ...(input.name !== undefined && { name: input.name }),
            ...(input.goal !== undefined && { goal: input.goal }),
            ...(input.startDate !== undefined && { startDate: input.startDate }),
            ...(input.endDate !== undefined && { endDate: input.endDate }),
            revision: sql`${iterations.revision} + 1`,
            updatedAt: sql`now()`,
          })
          .where(eq(iterations.id, iterationId))
          .returning();
        // payload 只记「改了哪些字段」，不记前后值：前后值要读两次、还会把整轮文本塞进流水。
        await recordEvent(tx, projectId, iterationId, "updated", actorId, {
          fields: Object.keys(input).filter((k) => k !== "requestId" && k !== "expectedRevision"),
        });
        return toIteration(row);
      },
    ),
  );
}

/**
 * 开始迭代：planned -> active，写 startedAt。
 *
 * 「一个项目至多一轮 active」由 DB 的部分唯一索引兜底：两个并发事务各自锁住**不同**的迭代行时
 * lockIteration 拦不住，唯一索引会拦住，输的一方拿到 23505。这里翻成中文提示。
 */
export async function startIteration(
  actorId: string,
  projectId: string,
  iterationId: string,
  input: IterationRevisionInput,
): Promise<Iteration> {
  await requireTaskWrite(actorId, projectId);

  return db.transaction((tx) =>
    runIdempotent(
      tx,
      requestKey(projectId, actorId, "iteration.start", input.requestId),
      { iterationId, ...input },
      async () => {
        const current = await lockIteration(tx, projectId, iterationId, input.expectedRevision);
        if (current.status === "active") throw new ConflictError("该迭代已经开始了");
        if (current.status === "completed") throw new ConflictError("已结束的迭代不能重新开始");

        try {
          const [row] = await tx
            .update(iterations)
            .set({
              status: "active",
              startedAt: sql`now()`,
              revision: sql`${iterations.revision} + 1`,
              updatedAt: sql`now()`,
            })
            .where(eq(iterations.id, iterationId))
            .returning();
          await recordEvent(tx, projectId, iterationId, "started", actorId);
          return toIteration(row);
        } catch (e) {
          if (isUniqueViolation(e)) throw new ConflictError("该项目已有进行中的迭代");
          throw e;
        }
      },
    ),
  );
}

/** 入轮 / 移出的公共骨架：迭代版本 + 每个任务的 updatedAt 双重校验。 */
async function moveTasks(
  tx: DbTx,
  actorId: string,
  projectId: string,
  iterationId: string,
  input: AssignTasksInput,
  mode: "assign" | "remove",
): Promise<AssignTasksResult> {
  const current = await lockIteration(tx, projectId, iterationId, input.expectedRevision);
  if (current.status === "completed") {
    throw new ConflictError("已结束的迭代不能再调整任务");
  }

  const touched: string[] = [];
  for (const ref of input.tasks) {
    const [task] = await tx
      .select({ id: tasks.id, sprintId: tasks.sprintId, updatedAt: tasks.updatedAt })
      .from(tasks)
      .where(and(eq(tasks.id, ref.taskId), eq(tasks.projectId, projectId)))
      .for("update");
    if (!task) throw new NotFoundError("任务不存在或不属于该项目");

    const expected = new Date(ref.expectedUpdatedAt);
    if (Number.isNaN(expected.getTime()) || expected.getTime() !== task.updatedAt.getTime()) {
      throw new ConflictError("任务已被他人修改，请刷新后重试");
    }

    if (mode === "assign") {
      // 一个任务只归属一轮迭代。已在轮内的任务要移出后才能再入另一轮。
      if (task.sprintId && task.sprintId !== iterationId) {
        throw new ConflictError("该任务已属于另一轮迭代");
      }
      if (task.sprintId === iterationId) continue;
      await tx
        .update(tasks)
        .set({ sprintId: iterationId, updatedAt: sql`now()` })
        .where(eq(tasks.id, task.id));
    } else {
      if (task.sprintId !== iterationId) continue;
      await tx
        .update(tasks)
        .set({ sprintId: null, updatedAt: sql`now()` })
        .where(eq(tasks.id, task.id));
    }
    touched.push(task.id);
  }

  const next = touched.length > 0 ? await bumpRevision(tx, iterationId) : current;
  if (touched.length > 0) {
    await recordEvent(
      tx,
      projectId,
      iterationId,
      mode === "assign" ? "tasks_assigned" : "tasks_removed",
      actorId,
      { taskIds: touched },
    );
  }
  return { iteration: toIteration(next), taskIds: touched };
}

export async function assignTasks(
  actorId: string,
  projectId: string,
  iterationId: string,
  input: AssignTasksInput,
): Promise<AssignTasksResult> {
  await requireTaskWrite(actorId, projectId);

  return db.transaction((tx) =>
    runIdempotent(
      tx,
      requestKey(projectId, actorId, "iteration.assign", input.requestId),
      { iterationId, ...input },
      () => moveTasks(tx, actorId, projectId, iterationId, input, "assign"),
    ),
  );
}

export async function removeTasks(
  actorId: string,
  projectId: string,
  iterationId: string,
  input: AssignTasksInput,
): Promise<AssignTasksResult> {
  await requireTaskWrite(actorId, projectId);

  return db.transaction((tx) =>
    runIdempotent(
      tx,
      requestKey(projectId, actorId, "iteration.remove", input.requestId),
      { iterationId, ...input },
      () => moveTasks(tx, actorId, projectId, iterationId, input, "remove"),
    ),
  );
}

/**
 * 任务池拖拽排序：把任务插到 beforeTaskId 之前（beforeTaskId 为 null 表示插到末尾）。
 *
 * 取前后邻居 sortOrder 的中点。中点间距耗尽（< 1e-6）时在同一事务内把整个任务池按
 * 1024 间距重编号。`for("update")` 锁住整池，避免两个人同时拖拽算出同一个中点。
 */
export async function reorderBacklog(
  actorId: string,
  projectId: string,
  input: ReorderBacklogInput,
): Promise<ReorderBacklogResult> {
  await requireTaskWrite(actorId, projectId);

  return db.transaction((tx) =>
    runIdempotent(
      tx,
      requestKey(projectId, actorId, "backlog.reorder", input.requestId),
      input,
      async () => {
        const pool = await tx
          .select({ id: tasks.id, sortOrder: tasks.sortOrder, updatedAt: tasks.updatedAt })
          .from(tasks)
          .where(backlogWhere(projectId))
          .orderBy(asc(tasks.sortOrder), asc(tasks.id))
          .for("update");

        const moved = pool.find((t) => t.id === input.taskId);
        if (!moved) throw new NotFoundError("任务不在任务池中");

        const expected = new Date(input.expectedUpdatedAt);
        if (Number.isNaN(expected.getTime()) || expected.getTime() !== moved.updatedAt.getTime()) {
          throw new ConflictError("任务已被他人修改，请刷新后重试");
        }

        const others = pool.filter((t) => t.id !== input.taskId);
        let insertAt: number;
        if (input.beforeTaskId === null) {
          insertAt = others.length;
        } else {
          insertAt = others.findIndex((t) => t.id === input.beforeTaskId);
          // 只认同一任务池内的锚点：拿迭代里的任务或别的项目的任务当锚点一律拒绝。
          if (insertAt === -1) throw new NotFoundError("锚点任务不在任务池中");
        }

        const prev = insertAt > 0 ? others[insertAt - 1] : null;
        const next = insertAt < others.length ? others[insertAt] : null;

        let newSort: number;
        if (!prev && !next) {
          newSort = Date.now();
        } else if (!prev) {
          newSort = next!.sortOrder - SORT_GAP;
        } else if (!next) {
          newSort = prev.sortOrder + SORT_GAP;
        } else if (next.sortOrder - prev.sortOrder < SORT_EPS) {
          await Promise.all(
            others.map((t, i) =>
              tx
                .update(tasks)
                .set({ sortOrder: (i + 1) * SORT_GAP })
                .where(eq(tasks.id, t.id)),
            ),
          );
          // 重编号后第 i 项（0 起）sortOrder = (i+1)*GAP，落点照旧在 insertAt-1 与 insertAt 之间
          newSort = insertAt * SORT_GAP + SORT_GAP / 2;
        } else {
          newSort = (prev.sortOrder + next.sortOrder) / 2;
        }

        const [updated] = await tx
          .update(tasks)
          .set({ sortOrder: newSort, updatedAt: sql`now()` })
          .where(eq(tasks.id, moved.id))
          .returning({ sortOrder: tasks.sortOrder, updatedAt: tasks.updatedAt });

        return {
          taskId: moved.id,
          sortOrder: updated.sortOrder,
          updatedAt: updated.updatedAt.toISOString(),
        };
      },
    ),
  );
}

/* ------------------------------------------------------------------ *
 * P1：结束迭代、不可变历史与复盘（定稿 C-I06—C-I11、C-I13）
 * ------------------------------------------------------------------ */

/** 结束预览与结束操作共用的任务读取：本轮全部任务（含子任务），主任务口径另算。 */
async function loadIterationTaskRows(
  exec: DbTx | typeof db,
  projectId: string,
  iterationId: string,
): Promise<TaskRow[]> {
  return exec
    .select(SUMMARY_COLS)
    .from(tasks)
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .where(and(eq(tasks.projectId, projectId), eq(tasks.sprintId, iterationId)))
    .orderBy(asc(tasks.sortOrder), asc(tasks.id));
}

/** 可作为未完成任务落点的一轮：同项目、未完成、不是本轮。 */
async function eligibleNextIterations(
  exec: DbTx | typeof db,
  projectId: string,
  excludeId: string,
): Promise<Iteration[]> {
  const rows = await exec
    .select()
    .from(iterations)
    .where(
      and(
        eq(iterations.projectId, projectId),
        ne(iterations.id, excludeId),
        ne(iterations.status, "completed"),
      ),
    )
    .orderBy(desc(iterations.startDate), asc(iterations.id));
  return rows.map(toIteration);
}

/** 本轮的主任务（子任务跟随父任务，不单独安排去向，也不单独计数）。 */
function mainTasksOf(rows: TaskRow[]): TaskRow[] {
  return rows.filter((t) => t.parentTaskId === null);
}

/**
 * C-I06 结束预览。纯读，不落库——用户看过这张表、填过每个未完成任务的去向，才能结束。
 *
 * taskVersions 一并给出来，是为了让「预览」和「结束」之间有据可比：结束时要原样回传，
 * 中间谁动过任务就对不上，服务端据此拒绝并要求重新预览。
 */
export async function previewIterationCompletion(
  actorId: string,
  projectId: string,
  iterationId: string,
): Promise<IterationCompletionPreview> {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new NotFoundError("项目不存在或无权访问");

  const [row] = await db
    .select()
    .from(iterations)
    .where(and(eq(iterations.id, iterationId), eq(iterations.projectId, projectId)));
  if (!row) throw new NotFoundError("迭代不存在");

  const mainTasks = mainTasksOf(await loadIterationTaskRows(db, projectId, iterationId));

  return {
    iterationRevision: row.revision,
    completedTasks: mainTasks.filter((t) => t.status === "done").map(toTaskSummary),
    unfinishedTasks: mainTasks.filter((t) => t.status !== "done").map(toTaskSummary),
    eligibleNextIterations: await eligibleNextIterations(db, projectId, iterationId),
    taskVersions: mainTasks.map((t) => ({ taskId: t.id, updatedAt: t.updatedAt.toISOString() })),
  };
}

/**
 * C-I07 结束迭代。
 *
 * 三重校验，缺一不可：
 *   1. 迭代版本对得上（expectedRevision）；
 *   2. 每个任务的 updatedAt 与预览时一致——任何变化都要求重新预览，不做「差不多就过」；
 *   3. unfinishedDisposition 恰好覆盖全部未完成主任务——少一个整体拒绝，多一个也拒绝，
 *      免得「没提到的任务」被静默冻结或静默退回。
 *
 * 状态变更、任务移动、历史快照、事件流水全在一个事务里；快照只写一次（iteration_id 唯一索引兜底）。
 */
export async function completeIteration(
  actorId: string,
  projectId: string,
  iterationId: string,
  input: CompleteIterationInput,
): Promise<CompleteIterationResult> {
  await requireTaskWrite(actorId, projectId);

  return db.transaction((tx) =>
    runIdempotent(
      tx,
      requestKey(projectId, actorId, "iteration.complete", input.requestId),
      { iterationId, ...input },
      async () => {
        const current = await lockIteration(tx, projectId, iterationId, input.expectedRevision);
        if (current.status !== "active") {
          throw new ConflictError("只有进行中的迭代才能结束");
        }

        const taskRows = await loadIterationTaskRows(tx, projectId, iterationId);
        const mainTasks = mainTasksOf(taskRows);

        // 版本基线：预览时给几个任务，现在就得有几个，且逐个对得上
        const versionOf = new Map(input.taskVersions.map((v) => [v.taskId, v.updatedAt]));
        if (versionOf.size !== mainTasks.length) {
          throw new ConflictError("任务已被修改，请重新预览后再结束");
        }
        for (const task of mainTasks) {
          const expected = versionOf.get(task.id);
          if (expected === undefined || new Date(expected).getTime() !== task.updatedAt.getTime()) {
            throw new ConflictError("任务已被修改，请重新预览后再结束");
          }
        }

        // 去向表必须恰好覆盖未完成主任务
        const unfinished = mainTasks.filter((t) => t.status !== "done");
        const dispositionOf = new Map(input.unfinishedDisposition.map((d) => [d.taskId, d]));
        if (dispositionOf.size !== input.unfinishedDisposition.length) {
          throw new ValidationError("未完成任务的去向有重复");
        }
        for (const task of unfinished) {
          if (!dispositionOf.has(task.id)) {
            throw new ValidationError("请为每个未完成任务选择去向");
          }
        }
        for (const taskId of dispositionOf.keys()) {
          if (!unfinished.some((t) => t.id === taskId)) {
            throw new ValidationError("去向列表里有不属于本轮未完成任务的项目");
          }
        }

        // 目标轮先全部锁住：转入的那几轮 revision 也要跟着涨，得避免并发改同一轮
        const targets: string[] = [];
        for (const d of input.unfinishedDisposition) {
          if (d.destination !== "iteration") continue;
          if (!d.targetIterationId) throw new ValidationError("转入迭代时必须指定目标迭代");
          if (targets.includes(d.targetIterationId)) continue;
          const target = await lockIteration(tx, projectId, d.targetIterationId);
          if (target.status === "completed") {
            throw new ValidationError("目标迭代已结束，不能转入");
          }
          targets.push(d.targetIterationId);
        }

        const [row] = await tx
          .update(iterations)
          .set({
            status: "completed",
            completedAt: sql`now()`,
            revision: sql`${iterations.revision} + 1`,
            updatedAt: sql`now()`,
          })
          .where(eq(iterations.id, iterationId))
          .returning();

        const movedTaskIds: string[] = [];
        for (const d of input.unfinishedDisposition) {
          await tx
            .update(tasks)
            .set({
              sprintId: d.destination === "backlog" ? null : d.targetIterationId!,
              updatedAt: sql`now()`,
            })
            .where(and(eq(tasks.id, d.taskId), eq(tasks.projectId, projectId)));
          movedTaskIds.push(d.taskId);
        }
        for (const targetId of targets) await bumpRevision(tx, targetId);

        // 快照记的是「它们在本轮时的样子」，所以用搬之前的 taskRows，不重新查一遍。
        const taskTotal = mainTasks.length;
        const doneCount = mainTasks.filter((t) => t.status === "done").length;
        const stats: IterationStats = {
          taskTotal,
          doneCount,
          doneRatio: taskTotal === 0 ? 0 : doneCount / taskTotal,
        };

        const [history] = await tx
          .insert(iterationHistories)
          .values({
            projectId,
            iterationId,
            iterationSnapshot: toIteration(row),
            taskSnapshots: taskRows.map(toTaskSummary),
            stats,
            dispositions: input.unfinishedDisposition,
          })
          .returning({ id: iterationHistories.id });

        await recordEvent(tx, projectId, iterationId, "completed", actorId, {
          historyId: history.id,
          movedTaskIds,
        });

        return { iteration: toIteration(row), historyId: history.id, movedTaskIds };
      },
    ),
  );
}

/**
 * C-I08 不可变历史。快照写下去就不再变，所以这里只读、不做任何重算；
 * 任务后来被改名、完成或删除，都不影响这份记录。没结束过的轮返回 null。
 */
export async function getIterationHistory(
  actorId: string,
  projectId: string,
  iterationId: string,
): Promise<IterationHistory | null> {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new NotFoundError("项目不存在或无权访问");

  return loadHistorySnapshot(projectId, iterationId);
}

/** C-I09 复盘。没写就返回 null——「没填复盘」不等于「迭代没结束」。 */
export async function getIterationRetrospective(
  actorId: string,
  projectId: string,
  iterationId: string,
): Promise<Retrospective | null> {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new NotFoundError("项目不存在或无权访问");
  return loadRetrospective(iterationId);
}

/**
 * C-I10 写复盘。复盘只属于已结束的轮——进行中的迭代还没什么可复盘，
 * 允许写只会让「迭代没结束」和「复盘已填」两个信号互相打架。
 */
export async function saveIterationRetrospective(
  actorId: string,
  projectId: string,
  iterationId: string,
  input: SaveRetrospectiveInput,
): Promise<SaveRetrospectiveResult> {
  await requireTaskWrite(actorId, projectId);

  return db.transaction((tx) =>
    runIdempotent(
      tx,
      requestKey(projectId, actorId, "iteration.retrospective", input.requestId),
      { iterationId, ...input },
      async () => {
        const current = await lockIteration(tx, projectId, iterationId);
        if (current.status !== "completed") {
          throw new ValidationError("只能为已结束的迭代写复盘");
        }

        const [existing] = await tx
          .select()
          .from(retrospectives)
          .where(eq(retrospectives.iterationId, iterationId))
          .for("update");

        if (existing) {
          if (input.expectedRevision === undefined || input.expectedRevision !== existing.revision) {
            throw new ConflictError("复盘已被他人修改，请刷新后重试");
          }
          const [row] = await tx
            .update(retrospectives)
            .set({
              ...(input.wentWell !== undefined && { wentWell: input.wentWell }),
              ...(input.problems !== undefined && { problems: input.problems }),
              ...(input.nextActions !== undefined && { nextActions: input.nextActions }),
              authorId: actorId,
              revision: sql`${retrospectives.revision} + 1`,
              updatedAt: sql`now()`,
            })
            .where(eq(retrospectives.id, existing.id))
            .returning();
          await recordEvent(tx, projectId, iterationId, "retrospective_saved", actorId, {
            revision: row.revision,
          });
          return { retrospective: toRetrospective(row) };
        }

        if (input.expectedRevision !== undefined) {
          throw new ConflictError("复盘不存在，请刷新后重试");
        }

        const [row] = await tx
          .insert(retrospectives)
          .values({
            projectId,
            iterationId,
            wentWell: input.wentWell ?? null,
            problems: input.problems ?? null,
            nextActions: input.nextActions ?? null,
            authorId: actorId,
            revision: 1,
          })
          .returning();
        await recordEvent(tx, projectId, iterationId, "retrospective_saved", actorId, {
          revision: 1,
        });
        return { retrospective: toRetrospective(row) };
      },
    ),
  );
}

/** C-I11 删除尚未开始的迭代。关联任务退回任务池，任务本身一个不删。 */
export async function deletePlannedIteration(
  actorId: string,
  projectId: string,
  iterationId: string,
  input: IterationRevisionInput,
): Promise<DeletePlannedIterationResult> {
  await requireTaskWrite(actorId, projectId);

  return db.transaction((tx) =>
    runIdempotent(
      tx,
      requestKey(projectId, actorId, "iteration.delete", input.requestId),
      { iterationId, ...input },
      async () => {
        const current = await lockIteration(tx, projectId, iterationId, input.expectedRevision);
        if (current.status !== "planned") {
          throw new ConflictError("只有未开始的迭代才能删除");
        }

        await tx
          .update(tasks)
          .set({ sprintId: null, updatedAt: sql`now()` })
          .where(and(eq(tasks.projectId, projectId), eq(tasks.sprintId, iterationId)));

        // 事件流水与历史快照随迭代级联删除，不必手工清
        await tx.delete(iterations).where(eq(iterations.id, iterationId));
        return { deleted: true as const, iterationId };
      },
    ),
  );
}

/**
 * C-I13 我的活跃迭代：本人当前仍是成员的那些项目里，正在进行的轮。
 * 「当前仍是成员」由 team_members 现查决定——退组之后不该还能在工作台看到它。
 */
export async function listMyActiveIterations(
  actorId: string,
  filters: PageInput = {},
): Promise<PageResult<MyActiveIteration>> {
  const { offset, limit } = normalizePage(filters);

  const scope = and(
    eq(iterations.status, "active"),
    eq(teamMembers.userId, actorId),
    eq(projects.status, "active"),
  );

  const rows = await db
    .select({ iteration: iterations, projectName: projects.name })
    .from(iterations)
    .innerJoin(projects, eq(projects.id, iterations.projectId))
    .innerJoin(teamMembers, eq(teamMembers.teamId, projects.teamId))
    .where(scope)
    .orderBy(desc(iterations.startDate), asc(iterations.id))
    .limit(limit)
    .offset(offset);

  const [counted] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(iterations)
    .innerJoin(projects, eq(projects.id, iterations.projectId))
    .innerJoin(teamMembers, eq(teamMembers.teamId, projects.teamId))
    .where(scope);

  const asOf = new Date().toISOString();
  const items: MyActiveIteration[] = [];
  for (const { iteration, projectName } of rows) {
    // 每轮单独统计：跨轮合并算出来的 doneRatio 在页面上没法用
    const taskRows = await loadIterationTasks(iteration.projectId, iteration.id);
    const stats = await iterationStats(taskRows.map((t) => t.id));
    items.push({
      ...toIteration(iteration),
      projectName,
      ...stats,
      scope: "main-tasks",
      asOf,
      sourceHref: `/projects/${iteration.projectId}/iterations/${iteration.id}`,
    });
  }

  return pageResult(items, counted?.total ?? 0, offset, limit);
}
