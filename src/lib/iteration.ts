import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import type { DbTx } from "@/db";
import { iterations, tasks, users, type IterationStatus } from "@/db/schema";
import type {
  AssignTasksInput,
  AssignTasksResult,
  CreateIterationInput,
  CurrentIteration,
  Iteration,
  IterationDetail,
  IterationListFilters,
  IterationRevisionInput,
  IterationStats,
  PageResult,
  ReorderBacklogInput,
  ReorderBacklogResult,
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

  const taskRows = await loadIterationTasks(projectId, iterationId);
  const stats = await iterationStats(taskRows.map((t) => t.id));

  return {
    iteration: toIteration(row),
    tasks: taskRows.map(toTaskSummary),
    stats,
    // P1 才落不可变历史快照；P0 如实返回空数组，不编造事件。
    history: [],
    // P1 才有 retrospectives 表。null 表示「还没写复盘」，不是「迭代没结束」。
    retrospective: null,
  };
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
        return toIteration(row);
      },
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
        if (current.status === "completed") {
          throw new ConflictError("已结束的迭代不可修改");
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
      () => moveTasks(tx, projectId, iterationId, input, "assign"),
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
      () => moveTasks(tx, projectId, iterationId, input, "remove"),
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

// P0 只交付上述读写。结束结转 / 历史快照 / 复盘属 P1，届时在同一事务里调
// moveTasks(tx, ..., "remove") 把未完成任务退回任务池即可，不必现在预留半成品接口。
