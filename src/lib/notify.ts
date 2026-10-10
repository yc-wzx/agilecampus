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
const pendingTaskDispatches = new Set<Promise<void>>();

function trackTaskDispatch(sourceId: string, type: string): Promise<void> {
  const pending = dispatchTaskNotification(sourceId, type).then(
    () => undefined,
  );
  pendingTaskDispatches.add(pending);
  // Register both outcomes so tracking itself cannot create an unhandled rejection.
  void pending.then(
    () => pendingTaskDispatches.delete(pending),
    () => pendingTaskDispatches.delete(pending),
  );
  return pending;
}

/** Test cleanup / graceful shutdown: finish fire-and-forget work before closing its database. */
export async function drainPendingTaskNotifications(): Promise<void> {
  while (pendingTaskDispatches.size) {
    await Promise.allSettled([...pendingTaskDispatches]);
  }
}

export async function notifyTaskAssigned(task: TaskRow): Promise<void> {
  if (!task.assigneeId) return;
  try {
    await trackTaskDispatch(task.id, "task.assigned");
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
    await trackTaskDispatch(task.id, "task.completed");
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
