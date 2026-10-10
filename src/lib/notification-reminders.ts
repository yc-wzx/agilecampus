import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { tasks, projects, teamMembers } from "@/db/schema";
import { recordNotificationIntent } from "./notification";
import { ValidationError } from "./errors";
const SYSTEM_ACTOR = "00000000-0000-4000-8000-000000000001";
export async function scanAndRecordDueReminders(now = new Date()) {
  if (Number.isNaN(now.getTime())) throw new ValidationError("调度时间不合法");
  const today = now.toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }),
    tomorrow = new Date(
      new Date(today + "T00:00:00+08:00").getTime() + 86400000,
    ).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
  const rows = await db
    .select({ task: tasks })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .innerJoin(
      teamMembers,
      and(
        eq(teamMembers.teamId, projects.teamId),
        eq(teamMembers.userId, tasks.assigneeId),
      ),
    )
    .where(
      and(
        ne(tasks.status, "done"),
        ne(projects.status, "archived"),
        isNotNull(tasks.dueDate),
        sql`${tasks.dueDate}<=${tomorrow}::date`,
      ),
    );
  let created = 0,
    skipped = 0,
    failed = 0;
  for (const { task } of rows) {
    try {
      const result = await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(tasks)
          .where(eq(tasks.id, task.id))
          .for("share");
        const active = await tx.execute(
          sql`select id from projects where id=${task.projectId} and status<>'archived' for share`,
        );
        if (
          !active.length ||
          !current ||
          current.status === "done" ||
          current.assigneeId !== task.assigneeId ||
          current.dueDate !== task.dueDate
        )
          return { createdCount: 0 };
        const type = task.dueDate! < today ? "task.overdue" : "task.due_soon";
        return recordNotificationIntent(tx, {
          eventKey: `due:${type}:${task.id}:${task.assigneeId}:${task.dueDate}:${today}`,
          projectId: task.projectId,
          actorId: SYSTEM_ACTOR,
          type,
          recipientIds: [task.assigneeId!],
          summary:
            `任务《${task.title}》${type === "task.overdue" ? "已逾期" : "即将到期"}（截止 ${task.dueDate}）`.slice(
              0,
              500,
            ),
          sourceRef: {
            sourceKind: "task",
            sourceId: task.id,
            projectId: task.projectId,
            sourceHref: `/projects/${task.projectId}?task=${task.id}`,
            evidenceKey: `task:${task.id}`,
            availability: "available",
          },
        });
      });
      if (result.createdCount) created += result.createdCount;
      else skipped++;
    } catch {
      failed++;
    }
  }
  return { scanned: rows.length, created, skipped, failed };
}
