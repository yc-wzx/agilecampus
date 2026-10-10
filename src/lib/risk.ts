import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { tasks, projects, projectActivities, iterations } from "@/db/schema";
import type { ProjectRiskResult, RiskItem, SourceRef } from "@/contracts/p0-p2";
import { readProject } from "./project-read";
import { todayInShanghai } from "./dashboard";
export const RISK_RULE_VERSION = "p0-p2-v2";
export async function listProjectRisks(
  actorId: string,
  projectId: string,
): Promise<ProjectRiskResult> {
  return readProject(actorId, projectId, async (tx) => {
    const asOf = new Date().toISOString(),
      now = new Date(asOf),
      today = todayInShanghai(now);
    const [project] = await tx
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));
    const [bounds] = await tx
      .select({
        first: sql<string | null>`min(${projectActivities.occurredAt})`,
      })
      .from(projectActivities)
      .where(eq(projectActivities.projectId, projectId));
    const availableFrom = bounds.first
      ? new Date(bounds.first).toISOString()
      : null;
    const [last] = await tx
      .select({
        id: projectActivities.id,
        occurredAt: projectActivities.occurredAt,
      })
      .from(projectActivities)
      .where(
        and(
          eq(projectActivities.projectId, projectId),
          ne(projectActivities.objectType, "announcement"),
        ),
      )
      .orderBy(desc(projectActivities.occurredAt), projectActivities.id)
      .limit(1);
    const result: ProjectRiskResult = {
      projectId,
      asOf,
      items: [],
      unknownRules: [],
      coverage: {
        availableFrom,
        complete: false,
        note:
          project.status === "archived"
            ? "归档项目不触发活跃风险"
            : `规则版本 ${RISK_RULE_VERSION}；旧活动不回填，当前状态按生成时间判断。`,
      },
    };
    if (project.status === "archived") return result;
    const rows = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), isNull(tasks.parentTaskId)));
    const source = (id: string): SourceRef => ({
      sourceKind: "task",
      sourceId: id,
      projectId,
      sourceHref: `/projects/${projectId}?task=${id}`,
      evidenceKey: `task:${id}`,
      availability: "available",
    });
    function risk(
      ruleId: RiskItem["ruleId"],
      message: string,
      threshold: RiskItem["threshold"],
      observedValue: RiskItem["observedValue"],
      refs: SourceRef[],
    ) {
      result.items.push({
        ruleId,
        severity: "warning",
        message,
        threshold,
        observedValue,
        evaluatedAt: asOf,
        sourceRefs: refs,
        evidenceKeys: refs.map((ref) => ref.evidenceKey),
      });
    }
    for (const task of rows.filter((t) => t.status !== "done")) {
      if (task.dueDate && task.dueDate < today)
        risk(
          "overdue_task",
          `任务「${task.title}」已逾期`,
          { today },
          { dueDate: task.dueDate },
          [source(task.id)],
        );
      if (task.isBlocked) {
        if (!task.blockedAt) {
          if (!result.unknownRules.includes("blocked_task"))
            result.unknownRules.push("blocked_task");
        } else {
          const days =
            (Date.parse(today) - Date.parse(todayInShanghai(task.blockedAt))) /
            86400000;
          if (days > 3)
            risk(
              "blocked_task",
              `任务「${task.title}」已持续阻塞 ${days} 个日历日`,
              { calendarDays: 3 },
              { calendarDays: days },
              [source(task.id)],
            );
        }
      }
    }
    const [iteration] = await tx
      .select()
      .from(iterations)
      .where(
        and(
          eq(iterations.projectId, projectId),
          eq(iterations.status, "active"),
        ),
      );
    if (iteration) {
      const start = Date.parse(iteration.startDate + "T00:00:00+08:00"),
        end = Date.parse(iteration.endDate + "T00:00:00+08:00") + 86400000;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
        result.unknownRules.push("iteration_progress");
      else {
        const assigned = rows.filter((t) => t.sprintId === iteration.id),
          done = assigned.filter((t) => t.status === "done").length;
        const remainingRatio = Math.max(0, end - now.getTime()) / (end - start),
          doneRatio = assigned.length ? done / assigned.length : 0;
        if (assigned.length > 0 && remainingRatio < 0.25 && doneRatio < 0.5)
          risk(
            "iteration_progress",
            "本轮剩余时间不足四分之一，主任务完成不足一半",
            { remainingRatio: 0.25, doneRatio: 0.5 },
            { remainingRatio, doneRatio, taskTotal: assigned.length },
            [
              {
                sourceKind: "iteration",
                sourceId: iteration.id,
                projectId,
                sourceHref: `/projects/${projectId}/iterations/${iteration.id}`,
                evidenceKey: `iteration:${iteration.id}`,
                availability: "available",
              },
            ],
          );
      }
    }
    if (
      !availableFrom ||
      now.getTime() - Date.parse(availableFrom) < 72 * 3600000
    )
      result.unknownRules.push("inactive_project");
    else if (!last) result.unknownRules.push("inactive_project");
    else if (now.getTime() - last.occurredAt.getTime() > 72 * 3600000)
      risk(
        "inactive_project",
        "超过 72 小时没有可核验的新活动",
        { hours: 72 },
        { hours: (now.getTime() - last.occurredAt.getTime()) / 3600000 },
        [
          {
            sourceKind: "activity",
            sourceId: last.id,
            projectId,
            sourceHref: `/projects/${projectId}/overview`,
            evidenceKey: `activity:${last.id}`,
            availability: "available",
          },
        ],
      );
    return result;
  });
}
