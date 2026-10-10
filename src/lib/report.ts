import { and, desc, eq, gte, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { tasks, projectActivities, iterations } from "@/db/schema";
import type { WeeklyReport, ReportFact, SourceRef } from "@/contracts/p0-p2";
import { readProject } from "./project-read";
import { addDays, todayInShanghai } from "./dashboard";
import { evidenceCte } from "./deliverable-reporting";
import { sql } from "drizzle-orm";
import { ValidationError } from "./errors";
import { escapeMarkdown } from "./evidence";
function input(value: unknown) {
  const parsed = z.strictObject({ weekStart: z.iso.date() }).safeParse(value);
  if (
    !parsed.success ||
    new Date(parsed.data.weekStart + "T00:00:00+08:00").getUTCDay() !== 0
  )
    throw new ValidationError("请选择北京时间周一作为周报起点");
  return parsed.data;
}
export async function getWeeklyReport(
  actorId: string,
  projectId: string,
  value: { weekStart: string },
): Promise<WeeklyReport> {
  const { weekStart } = input(value),
    weekEnd = addDays(weekStart, 7);
  return readProject(actorId, projectId, async (tx) => {
    const now = new Date(),
      asOf = now.toISOString(),
      today = todayInShanghai(now);
    const start = new Date(weekStart + "T00:00:00+08:00"),
      end = new Date(weekEnd + "T00:00:00+08:00");
    const events = await tx
      .select()
      .from(projectActivities)
      .where(
        and(
          eq(projectActivities.projectId, projectId),
          gte(projectActivities.occurredAt, start),
          lt(projectActivities.occurredAt, end),
        ),
      )
      .orderBy(desc(projectActivities.occurredAt), projectActivities.id);
    const [first] = await tx
      .select({ min: sql<string | null>`min(${projectActivities.occurredAt})` })
      .from(projectActivities)
      .where(eq(projectActivities.projectId, projectId));
    const rows = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), isNull(tasks.parentTaskId)));
    const sections: WeeklyReport["sections"] = {
      createdTasks: [],
      completionEvents: [],
      reopenedTasks: [],
      currentDoing: [],
      overdue: [],
      blocked: [],
      activeIteration: [],
      deliverables: [],
      feedback: [],
      scheduledNextSteps: [],
    };
    const ref = (
      sourceId: string,
      kind: SourceRef["sourceKind"],
      sourceHref: string | null,
      evidenceKey: string,
    ): SourceRef => ({
      sourceId,
      sourceKind: kind,
      projectId,
      sourceHref,
      evidenceKey,
      availability: sourceHref ? "available" : "deleted",
    });
    const fact = (
      factKey: string,
      title: string,
      summary: string,
      occurredAt: string | null,
      sourceRefs: SourceRef[],
    ): ReportFact => ({ factKey, title, summary, occurredAt, sourceRefs });
    for (const event of events) {
      const task = rows.find((t) => t.id === event.objectId);
      const source = ref(
        event.id,
        "activity",
        task
          ? `/projects/${projectId}?task=${task.id}`
          : `/projects/${projectId}/overview`,
        `activity:${event.id}`,
      );
      const item = fact(
        `activity:${event.id}`,
        event.summary,
        event.type === "task.completed" && task && task.status !== "done"
          ? "本周记录过完成；生成报告时该任务已重新打开。"
          : event.summary,
        event.occurredAt.toISOString(),
        [source],
      );
      if (event.type === "task.created") sections.createdTasks.push(item);
      if (event.type === "task.completed") sections.completionEvents.push(item);
      if (event.type === "task.reopened") sections.reopenedTasks.push(item);
    }
    for (const task of rows.filter((t) => t.status !== "done")) {
      const source = ref(
        task.id,
        "task",
        `/projects/${projectId}?task=${task.id}`,
        `task:${task.id}`,
      );
      const item = fact(
        `current-task:${task.id}`,
        task.title,
        `生成时状态：${task.status === "doing" ? "进行中" : "待办"}；截止日期：${task.dueDate ?? "未设置"}`,
        null,
        [source],
      );
      if (task.status === "doing") sections.currentDoing.push(item);
      if (task.dueDate && task.dueDate < today) sections.overdue.push(item);
      if (task.isBlocked)
        sections.blocked.push(
          fact(
            `blocked:${task.id}`,
            task.title,
            `生成时处于阻塞状态${task.blockedAt ? `，首次阻塞时间 ${task.blockedAt.toISOString()}` : "，起始时间未知"}`,
            null,
            [source],
          ),
        );
      if (task.dueDate && task.dueDate >= today)
        sections.scheduledNextSteps.push(item);
    }
    const rounds = await tx
      .select()
      .from(iterations)
      .where(
        and(
          eq(iterations.projectId, projectId),
          eq(iterations.status, "active"),
        ),
      );
    for (const iteration of rounds)
      sections.activeIteration.push(
        fact(
          `iteration:${iteration.id}`,
          iteration.name,
          `生成时活跃轮：${iteration.startDate} 至 ${iteration.endDate}`,
          null,
          [
            ref(
              iteration.id,
              "iteration",
              `/projects/${projectId}/iterations/${iteration.id}`,
              `iteration:${iteration.id}`,
            ),
          ],
        ),
      );
    const planned = await tx
      .select()
      .from(iterations)
      .where(
        and(
          eq(iterations.projectId, projectId),
          eq(iterations.status, "planned"),
          gte(iterations.endDate, today),
        ),
      );
    for (const iteration of planned)
      sections.scheduledNextSteps.push(
        fact(
          `planned-iteration:${iteration.id}`,
          iteration.name,
          `已排期：${iteration.startDate} 至 ${iteration.endDate}`,
          null,
          [
            ref(
              iteration.id,
              "iteration",
              `/projects/${projectId}/iterations/${iteration.id}`,
              `iteration:${iteration.id}`,
            ),
          ],
        ),
      );
    const formal = await tx.execute<{
      id: string;
      kind: string;
      title: string | null;
      deliverableId: string | null;
      versionId: string | null;
      occurredAt: string;
    }>(
      sql`${evidenceCte(projectId)} select e.id,e.kind,e.title,e."deliverableId",e."versionId",e."occurredAt" from evidence e where e."occurredAt">=${start.toISOString()}::timestamptz and e."occurredAt"<${end.toISOString()}::timestamptz order by e."occurredAt" desc,e.id`,
    );
    for (const row of formal) {
      const href = row.deliverableId
        ? `/projects/${projectId}/deliverables/${row.deliverableId}?versionId=${row.versionId}${row.kind !== "submission" ? `&feedbackId=${row.id}` : ""}`
        : `/projects/${projectId}/overview`;
      const item = fact(
        `${row.kind}:${row.id}`,
        row.title ?? "阶段反馈",
        row.kind === "submission" ? "本周正式提交" : "本周教师反馈",
        new Date(row.occurredAt).toISOString(),
        [
          ref(
            row.kind === "submission" ? row.deliverableId! : row.id,
            row.kind === "submission" ? "deliverable" : "feedback",
            href,
            `${row.kind}:${row.id}`,
          ),
        ],
      );
      (row.kind === "submission"
        ? sections.deliverables
        : sections.feedback
      ).push(item);
    }
    const availableFrom = first.min ? new Date(first.min).toISOString() : null;
    return {
      projectId,
      weekStart,
      weekEnd,
      asOf,
      sections,
      coverage: {
        availableFrom,
        complete:
          !!availableFrom && start.getTime() >= Date.parse(availableFrom),
        note: "事件按本周实际业务时间记录；现状及下一步以生成时间为准。旧活动未回填，记录次数不等于成员贡献分。",
      },
    };
  });
}
export const REPORT_SECTION_LABELS: Record<
  keyof WeeklyReport["sections"],
  string
> = {
  createdTasks: "本周创建任务",
  completionEvents: "本周完成事件",
  reopenedTasks: "本周重新打开",
  currentDoing: "当前进行中",
  overdue: "当前逾期",
  blocked: "当前阻塞",
  activeIteration: "当前迭代",
  deliverables: "本周成果提交",
  feedback: "本周教师反馈",
  scheduledNextSteps: "已排期的下一步",
};
export async function exportWeeklyReportMarkdown(
  actorId: string,
  projectId: string,
  value: { weekStart: string },
) {
  const report = await getWeeklyReport(actorId, projectId, value);
  const lines = [
    "# 项目规则周报",
    `区间：${report.weekStart} 至 ${report.weekEnd}（结束日不含）`,
    `生成时间：${report.asOf}`,
    report.coverage.note!,
    "",
  ];
  for (const [key, items] of Object.entries(report.sections)) {
    lines.push(
      `## ${REPORT_SECTION_LABELS[key as keyof WeeklyReport["sections"]]}`,
    );
    if (!items.length) lines.push("暂无记录");
    for (const item of items) {
      lines.push(
        `- ${escapeMarkdown(item.title)}：${escapeMarkdown(item.summary)}`,
      );
      for (const source of item.sourceRefs)
        if (source.sourceHref)
          lines.push(
            `  [查看来源](${new URL(source.sourceHref, process.env.AGILECAMPUS_URL || "http://localhost:3000").href})`,
          );
    }
    lines.push("");
  }
  return {
    filename: `weekly-report-${report.weekStart}.md`,
    markdown: lines.join("\n"),
    generatedAt: report.asOf,
    coverage: report.coverage,
  };
}
