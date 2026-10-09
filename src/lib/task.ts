import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import type { DbTx } from "@/db";
import {
  labels,
  milestones,
  taskDependencies,
  taskLabels,
  tasks,
  users,
  type TaskPriority,
  type TaskStatus,
} from "@/db/schema";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "./errors";
import { getTeamMembership } from "./team";
import { getProjectForUser } from "./project";
import { notifyTaskAssigned, notifyTaskCompleted } from "./notify";
import { recordTaskMutation } from "./task-events";
import { lockTaskWriteAccess } from "./task-write-access";

// 任务写操作角色：admin + student（teacher 只读，设计文档 §5）
export const TASK_WRITE_ROLES = ["admin", "student"];

async function requireProjectAccess(actorId: string, projectId: string) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();
  return access;
}

// 供 lib/label.ts 复用：贴标签属任务写操作，权限口径须与 createTask/updateTask 一致
export async function requireTaskWrite(actorId: string, projectId: string) {
  const access = await requireProjectAccess(actorId, projectId);
  if (!TASK_WRITE_ROLES.includes(access.role)) throw new ForbiddenError();
  return access;
}

async function validateAssignee(teamId: string, assigneeId: string) {
  const membership = await getTeamMembership(assigneeId, teamId);
  if (!membership) throw new AppError("负责人不是团队成员");
}

async function validateMilestone(projectId: string, milestoneId: string) {
  const [m] = await db
    .select({ id: milestones.id })
    .from(milestones)
    .where(and(eq(milestones.id, milestoneId), eq(milestones.projectId, projectId)));
  if (!m) throw new AppError("里程碑不属于该项目");
}

// 父任务须存在且同项目——防跨项目挂载
async function validateParentTask(projectId: string, parentTaskId: string) {
  const [p] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, parentTaskId), eq(tasks.projectId, projectId)));
  if (!p) throw new AppError("父任务不属于该项目");
}

export async function createTask(
  actorId: string,
  projectId: string,
  input: {
    title: string;
    description?: string;
    assigneeId?: string;
    startDate?: string;
    dueDate?: string;
    milestoneId?: string;
    priority?: TaskPriority;
    parentTaskId?: string;
    /** C / P0：验收标准，可选。旧调用方不传即为空。 */
    acceptanceCriteria?: string;
  },
  opts?: { tx?: DbTx },
): Promise<typeof tasks.$inferSelect> {
  if (!opts?.tx) {
    const created = await db.transaction(tx => createTask(actorId, projectId, input, { tx }));
    if (created.assigneeId) void notifyTaskAssigned(created);
    return created;
  }
  const exec = opts.tx;
  await lockTaskWriteAccess(exec, actorId, projectId);
  const access = await requireTaskWrite(actorId, projectId);
  if (input.assigneeId) await validateAssignee(access.project.teamId, input.assigneeId);
  if (input.milestoneId) await validateMilestone(projectId, input.milestoneId);
  if (input.parentTaskId) await validateParentTask(projectId, input.parentTaskId);

  const [task] = await exec
    .insert(tasks)
    .values({
      projectId,
      createdById: actorId,
      title: input.title,
      description: input.description,
      acceptanceCriteria: input.acceptanceCriteria,
      assigneeId: input.assigneeId,
      startDate: input.startDate,
      dueDate: input.dueDate,
      milestoneId: input.milestoneId,
      parentTaskId: input.parentTaskId,
      priority: input.priority ?? "medium",
      sortOrder: Date.now(),
    })
    .returning();

  await recordTaskMutation(exec, actorId, null, task);
  return task;
}

export async function updateTask(
  actorId: string,
  taskId: string,
  patch: {
    title?: string;
    description?: string | null;
    acceptanceCriteria?: string | null;
    assigneeId?: string | null;
    startDate?: string | null;
    dueDate?: string | null;
    milestoneId?: string | null;
    status?: TaskStatus;
    priority?: TaskPriority;
    completionNote?: string | null;
  },
  opts?: { tx?: DbTx; expectedUpdatedAt?: Date | string },
): Promise<typeof tasks.$inferSelect> {
  if (!opts?.tx) {
    const [previous] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    const updated = await db.transaction(tx => updateTask(actorId, taskId, patch, { ...opts, tx }));
    if (patch.assigneeId && patch.assigneeId !== previous?.assigneeId) void notifyTaskAssigned(updated);
    if (patch.status === "done" && previous?.status !== "done") void notifyTaskCompleted(updated, actorId);
    return updated;
  }
  const exec = opts.tx;
  const base = exec.select().from(tasks).where(eq(tasks.id, taskId));
  // 所有入口锁行读取真实前状态；V1 额外核对版本，旧入口也不能用过时快照记录事件。
  const [task] = await base.for("update");
  if (!task) throw new NotFoundError("任务不存在");
  await lockTaskWriteAccess(exec, actorId, task.projectId);

  const access = await requireTaskWrite(actorId, task.projectId);

  if (opts?.expectedUpdatedAt !== undefined) {
    const expected =
      opts.expectedUpdatedAt instanceof Date
        ? opts.expectedUpdatedAt
        : new Date(opts.expectedUpdatedAt);
    // 两侧都只到毫秒：updatedAt 由 postgres 驱动解析成 Date（毫秒），
    // 前端回传的是我们吐出去的 toISOString()，故直接比 getTime() 即可。
    if (Number.isNaN(expected.getTime()) || expected.getTime() !== task.updatedAt.getTime()) {
      throw new ConflictError("任务已被他人修改，请刷新后重试");
    }
  }

  const startDate = patch.startDate === undefined ? task.startDate : patch.startDate;
  const dueDate = patch.dueDate === undefined ? task.dueDate : patch.dueDate;
  if (startDate && dueDate && startDate > dueDate) throw new AppError("任务开始日期不能晚于截止日期");

  if (patch.assigneeId) await validateAssignee(access.project.teamId, patch.assigneeId);
  if (patch.milestoneId) await validateMilestone(task.projectId, patch.milestoneId);

  // 显式白名单构造，勿用 ...patch 展开：运行时宽对象可夹带 projectId/sortOrder 等越权字段
  const [updated] = await exec
    .update(tasks)
    // 同一事务内多次写入也至少推进一毫秒，事件键与前端可回传版本保持一致。
    .set({
      ...(patch.title !== undefined && { title: patch.title }),
      ...(patch.description !== undefined && { description: patch.description }),
      ...(patch.acceptanceCriteria !== undefined && {
        acceptanceCriteria: patch.acceptanceCriteria,
      }),
      ...(patch.assigneeId !== undefined && { assigneeId: patch.assigneeId }),
      ...(patch.startDate !== undefined && { startDate: patch.startDate }),
      ...(patch.dueDate !== undefined && { dueDate: patch.dueDate }),
      ...(patch.milestoneId !== undefined && { milestoneId: patch.milestoneId }),
      ...(patch.status !== undefined && { status: patch.status }),
      ...(patch.priority !== undefined && { priority: patch.priority }),
      ...(patch.completionNote !== undefined && { completionNote: patch.completionNote }),
      updatedAt: sql`greatest(date_trunc('milliseconds', clock_timestamp()), date_trunc('milliseconds', ${tasks.updatedAt}) + interval '1 millisecond')`,
    })
    .where(eq(tasks.id, taskId))
    .returning();
  if (!updated) throw new NotFoundError("任务不存在");

  await recordTaskMutation(exec, actorId, task, updated);
  return updated;
}

export async function deleteTask(actorId: string, taskId: string) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) throw new AppError("任务不存在");
  await requireTaskWrite(actorId, task.projectId);
  await db.delete(tasks).where(eq(tasks.id, taskId));
}

export type TaskLabel = { id: string; name: string; color: string };

// 另发一次查询按 taskId 归并，不用 leftJoin：join 会造成行乘积，
// 污染既有 orderBy(sortOrder) 与调用方「一行一任务」的假设。
export async function labelsByTask(taskIds: string[]): Promise<Map<string, TaskLabel[]>> {
  const map = new Map<string, TaskLabel[]>();
  if (taskIds.length === 0) return map;

  const rows = await db
    .select({
      taskId: taskLabels.taskId,
      id: labels.id,
      name: labels.name,
      color: labels.color,
    })
    .from(taskLabels)
    .innerJoin(labels, eq(taskLabels.labelId, labels.id))
    .where(inArray(taskLabels.taskId, taskIds))
    .orderBy(labels.name);

  for (const r of rows) {
    const list = map.get(r.taskId) ?? [];
    list.push({ id: r.id, name: r.name, color: r.color });
    map.set(r.taskId, list);
  }
  return map;
}

export async function listProjectTasks(actorId: string, projectId: string) {
  await requireProjectAccess(actorId, projectId);
  const rows = await db
    .select({
      id: tasks.id,
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
      updatedAt: tasks.updatedAt,
      completionNote: tasks.completionNote,
    })
    .from(tasks)
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .where(eq(tasks.projectId, projectId))
    // 补 id 兜底：createTask 写的是 Date.now()，同一毫秒建的两个任务 sortOrder 会撞值，
    // 只按 sort_order 排会导致列表顺序不稳定、翻页重复或漏项。
    .orderBy(tasks.sortOrder, tasks.id);

  const byTask = await labelsByTask(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, labels: byTask.get(r.id) ?? [] }));
}

// 列某任务之下的子任务（直接子级，不递归）
export async function listSubtasks(actorId: string, parentTaskId: string) {
  const [parent] = await db
    .select({ projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, parentTaskId));
  if (!parent) throw new AppError("任务不存在");
  await requireProjectAccess(actorId, parent.projectId);

  return db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      status: tasks.status,
      priority: tasks.priority,
      startDate: tasks.startDate,
      dueDate: tasks.dueDate,
      milestoneId: tasks.milestoneId,
      parentTaskId: tasks.parentTaskId,
      assigneeId: tasks.assigneeId,
      assigneeName: users.name,
      completionNote: tasks.completionNote,
      updatedAt: tasks.updatedAt,
    })
    .from(tasks)
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .where(eq(tasks.parentTaskId, parentTaskId))
    .orderBy(tasks.sortOrder);
}

// 在某任务下建子任务：projectId 由父任务推得，调用方无须再传。
// 新建行必无既有子级，故不可能成环，无须环检测。
export async function createSubtask(
  actorId: string,
  parentTaskId: string,
  input: {
    title: string;
    description?: string;
    assigneeId?: string;
    startDate?: string;
    dueDate?: string;
    milestoneId?: string;
    priority?: TaskPriority;
  },
) {
  const [parent] = await db
    .select({ projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, parentTaskId));
  if (!parent) throw new AppError("任务不存在");
  return createTask(actorId, parent.projectId, { ...input, parentTaskId });
}

// 单任务详情（供 Agent API 按 id 直取）。权限口径同 listProjectTasks：项目成员即可读。
// 注：「任务不存在」先于权限返回，沿既有 updateTask/deleteTask 之口径（BACKLOG 已录此债）。
export async function getTaskDetail(actorId: string, taskId: string) {
  const [row] = await db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      title: tasks.title,
      description: tasks.description,
      acceptanceCriteria: tasks.acceptanceCriteria,
      completionNote: tasks.completionNote,
      status: tasks.status,
      priority: tasks.priority,
      startDate: tasks.startDate,
      dueDate: tasks.dueDate,
      milestoneId: tasks.milestoneId,
      parentTaskId: tasks.parentTaskId,
      sprintId: tasks.sprintId,
      assigneeId: tasks.assigneeId,
      assigneeName: users.name,
      updatedAt: tasks.updatedAt,
      createdAt: tasks.createdAt,
    })
    .from(tasks)
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .where(eq(tasks.id, taskId));
  if (!row) throw new AppError("任务不存在");
  await requireProjectAccess(actorId, row.projectId);
  const byTask = await labelsByTask([row.id]);
  return { ...row, labels: byTask.get(row.id) ?? [] };
}

// 设置 predecessor 的后置任务（先删旧再插新）。简单关联：仅防直接成环，不强制阻断执行。
export async function setTaskSuccessors(
  actorId: string,
  predecessorId: string,
  successorIds: string[],
) {
  const [pred] = await db.select().from(tasks).where(eq(tasks.id, predecessorId));
  if (!pred) throw new AppError("任务不存在");
  await requireTaskWrite(actorId, pred.projectId);

  for (const sid of successorIds) {
    if (sid === predecessorId) throw new AppError("后置任务不可构成循环");
    const [s] = await db
      .select({ projectId: tasks.projectId })
      .from(tasks)
      .where(eq(tasks.id, sid));
    if (!s || s.projectId !== pred.projectId)
      throw new AppError("后置任务不属于该项目");
    const [back] = await db
      .select({ id: taskDependencies.id })
      .from(taskDependencies)
      .where(
        and(
          eq(taskDependencies.predecessorId, sid),
          eq(taskDependencies.successorId, predecessorId),
        ),
      );
    if (back) throw new AppError("后置任务不可构成循环");
  }

  await db.transaction(async (tx) => {
    await tx.delete(taskDependencies).where(eq(taskDependencies.predecessorId, predecessorId));
    if (successorIds.length > 0) {
      await tx
        .insert(taskDependencies)
        .values(successorIds.map((sid) => ({ predecessorId, successorId: sid })));
    }
  });
}

export async function listProjectDependencies(actorId: string, projectId: string) {
  await requireProjectAccess(actorId, projectId);
  return db
    .select({
      predecessorId: taskDependencies.predecessorId,
      successorId: taskDependencies.successorId,
    })
    .from(taskDependencies)
    .innerJoin(tasks, eq(taskDependencies.predecessorId, tasks.id))
    .where(eq(tasks.projectId, projectId));
}
