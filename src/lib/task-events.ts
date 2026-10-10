import { eq } from "drizzle-orm";
import type { DbTx } from "@/db";
import { tasks, users } from "@/db/schema";
import { recordProjectActivity } from "./activity";
import { notifyTaskAssigned } from "./task-notifications";
import { recordNotificationIntent } from "./notification";

type Task = typeof tasks.$inferSelect;
const fields = [
  "title",
  "description",
  "acceptanceCriteria",
  "startDate",
  "dueDate",
  "milestoneId",
  "priority",
  "completionNote",
] as const;

// 所有任务入口共用；活动、指派通知与业务写入共用事务，包括旧看板与 Agent 写入。
export async function recordTaskMutation(
  tx: DbTx,
  actorId: string,
  before: Task | null,
  task: Task,
) {
  const occurredAt = task.updatedAt.toISOString();
  let iterationId = task.sprintId;
  if (task.parentTaskId) {
    const [parent] = await tx
      .select({ sprintId: tasks.sprintId })
      .from(tasks)
      .where(eq(tasks.id, task.parentTaskId));
    iterationId = parent?.sprintId ?? null;
  }
  const base = {
    projectId: task.projectId,
    actorId,
    objectType: "task" as const,
    objectId: task.id,
    occurredAt,
  };
  const append = (
    type: string,
    summary: string,
    metadata: Record<string, string | string[] | null>,
  ) =>
    recordProjectActivity(tx, {
      ...base,
      type,
      summary: summary.slice(0, 500),
      metadata: {
        ...metadata,
        iterationId,
        milestoneId: task.milestoneId,
        assigneeId: task.assigneeId,
      },
      eventKey:
        type === "task.created"
          ? `task.created:${task.id}`
          : `${type}:${task.id}:${occurredAt}`,
    });
  if (!before)
    await append("task.created", `创建了任务《${task.title}》`, {
      taskId: task.id,
      status: task.status,
      assigneeId: task.assigneeId,
      dueDate: task.dueDate,
      iterationId,
    });
  else {
    const changedFields: string[] = fields.filter(
      (field) => before[field] !== task[field],
    );
    if (before.status !== task.status) {
      if (task.status === "done" || before.status === "done") {
        const type =
          task.status === "done" ? "task.completed" : "task.reopened";
        await append(
          type,
          `${task.status === "done" ? "完成" : "重新打开"}了任务《${task.title}》`,
          {
            taskId: task.id,
            fromStatus: before.status,
            iterationId,
          },
        );
      } else changedFields.unshift("status");
    }
    if (changedFields.length)
      await append("task.updated", `更新了任务《${task.title}》`, {
        taskId: task.id,
        changedFields,
        fromStatus: before.status,
        toStatus: task.status,
        fromAssigneeId: before.assigneeId,
        toAssigneeId: task.assigneeId,
        dueDate: task.dueDate,
        iterationId,
      });
    if (before.assigneeId !== task.assigneeId) {
      const [assignee] = task.assigneeId
        ? await tx
            .select({ name: users.name })
            .from(users)
            .where(eq(users.id, task.assigneeId))
        : [];
      await append(
        "task.assigned",
        assignee
          ? `把任务《${task.title}》指派给 ${assignee.name}`
          : `取消了任务《${task.title}》的负责人`,
        {
          taskId: task.id,
          fromAssigneeId: before.assigneeId,
          toAssigneeId: task.assigneeId,
        },
      );
    }
  }
  await notifyTaskAssigned(tx, {
    actorId,
    task,
    previousAssigneeId: before?.assigneeId,
  });
  if (
    before &&
    before.status !== "done" &&
    task.status === "done" &&
    task.createdById
  )
    await recordNotificationIntent(tx, {
      eventKey: `task.completed:${task.id}:${occurredAt}`,
      projectId: task.projectId,
      actorId,
      type: "task.completed",
      recipientIds: [task.createdById],
      summary: `任务《${task.title}》已完成`.slice(0, 500),
      sourceRef: {
        sourceKind: "task",
        sourceId: task.id,
        projectId: task.projectId,
        sourceHref: `/projects/${task.projectId}?task=${task.id}`,
        evidenceKey: `task:${task.id}`,
        availability: "available",
      },
    });
}
