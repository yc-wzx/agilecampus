import type { DbTx } from "@/db";
import type { tasks } from "@/db/schema";
import { recordNotificationIntent } from "./notifications";
export async function notifyTaskAssigned(tx: DbTx, input: {
  actorId: string; task: typeof tasks.$inferSelect; previousAssigneeId?: string | null;
}) {
  const { task, actorId, previousAssigneeId } = input;
  if (!task.assigneeId || task.assigneeId === previousAssigneeId) return { createdCount: 0 };
  return recordNotificationIntent(tx, {
    eventKey: `task.assigned:${task.id}:${task.updatedAt.toISOString()}`, projectId: task.projectId, actorId,
    type: "task.assigned", recipientIds: [task.assigneeId], summary: `任务《${task.title}》已指派给你`.slice(0, 500),
    sourceRef: { sourceKind: "task", sourceId: task.id, projectId: task.projectId,
      sourceHref: `/projects/${task.projectId}?task=${task.id}`, evidenceKey: `task:${task.id}`, availability: "available" },
  });
}
