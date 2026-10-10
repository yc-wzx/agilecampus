import {
  dispatchExternalNotifications,
  dispatchTaskNotification,
} from "./external-notifications";
import { scanAndRecordDueReminders } from "./notification-reminders";
type TaskRow = {
  id: string;
  assigneeId: string | null;
  projectId: string;
  createdById?: string | null;
};
// Business transactions create durable intents; these compatibility adapters only dispatch them.
export async function notifyTaskAssigned(task: TaskRow): Promise<void> {
  if (!task.assigneeId) return;
  try {
    await dispatchTaskNotification(task.id, "task.assigned");
  } catch {
    console.error("[notify] dispatch pending task notification failed");
  }
}
export async function notifyTaskCompleted(
  task: TaskRow,
  actorId: string,
): Promise<void> {
  if (!task.createdById || task.createdById === actorId) return;
  try {
    await dispatchTaskNotification(task.id, "task.completed");
  } catch {
    console.error("[notify] dispatch pending completion notification failed");
  }
}
export async function scanAndNotifyDue(): Promise<{
  notified: number;
  tasksScanned: number;
}> {
  const reminders = await scanAndRecordDueReminders();
  const sent = await dispatchExternalNotifications();
  return { notified: sent.sent, tasksScanned: reminders.scanned };
}
