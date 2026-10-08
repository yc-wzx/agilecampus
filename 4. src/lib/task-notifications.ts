import { createNotification } from "@/lib/notifications";

export async function notifyTaskAssigned(input: {
  taskId: string; projectId: string; title: string;
  assigneeId: string | null; previousAssigneeId?: string | null;
}) {
  if (!input.assigneeId || input.assigneeId === input.previousAssigneeId) return;
  try {
    await createNotification({
      recipientId: input.assigneeId,
      type: "task_assigned",
      title: "你有一个新任务",
      summary: `任务「${input.title}」已指派给你`,
      sourceType: "task",
      sourceId: input.taskId,
      href: `/projects/${input.projectId}?task=${input.taskId}`,
      eventKey: `task-assigned:${input.taskId}:${input.assigneeId}`,
    });
  } catch (e) { console.error(e); }
}
