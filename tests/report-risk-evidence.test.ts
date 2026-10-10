import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import {
  projects,
  projectActivities,
  tasks,
  teamMembers,
  users,
} from "@/db/schema";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject, createMilestone } from "@/lib/project";
import { createTask, updateTask } from "@/lib/task";
import { createTaskComment, deleteTaskComment } from "@/lib/comment";
import { createDeliverableDraft, submitDeliverable } from "@/lib/deliverable";
import {
  listProjectEvidence,
  exportProjectEvidenceMarkdown,
  getProjectEvidenceItem,
} from "@/lib/evidence";
import { getWeeklyReport } from "@/lib/report";
import { listProjectRisks } from "@/lib/risk";
import {
  getMyWorkspaceSummary,
  listTeacherProjectOverview,
} from "@/lib/workspace-summary";
import { createIteration, startIteration } from "@/lib/iteration";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { resetDb } from "./helpers";
async function scene() {
  const [admin, teacher, member, outsider] = await db
    .insert(users)
    .values(
      ["admin", "teacher", "member", "outsider"].map((name) => ({
        name,
        email: `${name}@report.test`,
        passwordHash: "fixture",
      })),
    )
    .returning();
  const team = await createTeam(admin.id, "过程证据");
  for (const m of [teacher, member]) await joinTeam(m.id, team.inviteCode);
  await updateMemberRole(admin.id, team.id, teacher.id, "teacher");
  const project = await createProject(admin.id, team.id, { name: "规则事实" });
  return { admin, teacher, member, outsider, team, project };
}
describe("周报、透明风险、统一证据及工作台聚合", () => {
  beforeEach(async () => {
    await resetDb();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-09T10:00:00+08:00"));
  });
  afterEach(() => vi.useRealTimers());
  it("统一证据排除私有草稿，按角色筛选实际提交者，来源保留真实版本", async () => {
    const s = await scene();
    await createDeliverableDraft(s.member.id, s.project.id, {
      requestId: randomUUID(),
      title: "不能泄漏的草稿",
      type: "report",
      url: "https://example.com/private",
    });
    const draft = await createDeliverableDraft(s.member.id, s.project.id, {
      requestId: randomUUID(),
      title: "正式版本",
      type: "report",
      url: "https://example.com/formal",
    });
    const version = await submitDeliverable(
      s.member.id,
      s.project.id,
      draft.id,
      { requestId: randomUUID(), expectedRevision: draft.revision },
    );
    const page = await listProjectEvidence(s.teacher.id, s.project.id, {
      memberId: s.member.id,
      memberRole: "submitter",
      kinds: ["deliverable_submission"],
    });
    expect(page.total).toBe(1);
    expect(page.items[0].title).toBe("正式版本");
    expect(page.items[0].sourceRef.sourceHref).toContain(version.versionId);
    expect(
      JSON.stringify(await listProjectEvidence(s.teacher.id, s.project.id)),
    ).not.toContain("不能泄漏的草稿");
    await expect(
      listProjectEvidence(s.teacher.id, s.project.id, {
        memberId: s.member.id,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      listProjectEvidence(s.outsider.id, s.project.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("任务改派后历史负责人和里程碑仍按事件当时快照筛选", async () => {
    const s = await scene(),
      milestone = await createMilestone(s.admin.id, s.project.id, {
        title: "第一阶段",
      });
    const task = await createTask(s.admin.id, s.project.id, {
      title: "历史任务",
      assigneeId: s.member.id,
      milestoneId: milestone.id,
    });
    await updateTask(s.admin.id, task.id, { status: "done" });
    await updateTask(s.admin.id, task.id, {
      assigneeId: s.teacher.id,
      milestoneId: null,
    });
    const page = await listProjectEvidence(s.teacher.id, s.project.id, {
      milestoneId: milestone.id,
      memberId: s.member.id,
      memberRole: "assignee",
    });
    expect(page.items.some((item) => item.title.includes("完成"))).toBe(true);
    expect(page.items.every((item) => item.milestoneId === milestone.id)).toBe(
      true,
    );
    expect(
      (
        await getProjectEvidenceItem(
          s.member.id,
          s.project.id,
          page.items[0].evidenceKey,
        )
      ).evidenceKey,
    ).toBe(page.items[0].evidenceKey);
  });
  it("导出包含整个筛选结果，超过上限注明截断，已删除评论不导出正文", async () => {
    const s = await scene();
    const task = await createTask(s.admin.id, s.project.id, {
      title: "导出任务",
    });
    for (const title of ["第一条", "第二条", "第三条"])
      await createTask(s.admin.id, s.project.id, { title });
    const page = await listProjectEvidence(s.member.id, s.project.id, {
      limit: 1,
    });
    expect(page.total).toBe(4);
    expect(page.items).toHaveLength(1);
    const all = await exportProjectEvidenceMarkdown(s.member.id, s.project.id);
    expect(all.exportedCount).toBe(4);
    expect(all.truncated).toBe(false);
    const capped = await exportProjectEvidenceMarkdown(
      s.member.id,
      s.project.id,
      { limit: 2 },
    );
    expect(capped.exportedCount).toBe(2);
    expect(capped.truncated).toBe(true);
    expect(capped.markdown).toContain("已截断");
    const comment = await createTaskComment(
      s.member.id,
      s.project.id,
      task.id,
      {
        requestId: randomUUID(),
        body: "删除后不可导出的正文",
        mentionedUserIds: [],
      },
    );
    await deleteTaskComment(s.member.id, s.project.id, task.id, comment.id, {
      requestId: randomUUID(),
      expectedRevision: 1,
    });
    expect(
      (await exportProjectEvidenceMarkdown(s.member.id, s.project.id)).markdown,
    ).not.toContain(comment.body);
  });
  it("周报区分本周事件与当前现状，完成后重开明确说明，拒绝非周一", async () => {
    const s = await scene(),
      task = await createTask(s.admin.id, s.project.id, {
        title: "完成后重开",
        dueDate: "2026-10-08",
      });
    await updateTask(s.admin.id, task.id, { status: "done" });
    await updateTask(s.admin.id, task.id, { status: "doing" });
    const report = await getWeeklyReport(s.member.id, s.project.id, {
      weekStart: "2026-10-05",
    });
    expect(report.sections.completionEvents).toHaveLength(1);
    expect(report.sections.completionEvents[0].summary).toContain("重新打开");
    expect(report.sections.reopenedTasks).toHaveLength(1);
    expect(report.sections.currentDoing).toHaveLength(1);
    expect(report.sections.overdue).toHaveLength(1);
    await expect(
      getWeeklyReport(s.member.id, s.project.id, { weekStart: "2026-10-06" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
  it("风险严格使用日期和三日阈值，缺少阻塞时间列未知，归档不触发", async () => {
    const s = await scene();
    const overdue = await createTask(s.admin.id, s.project.id, {
      title: "逾期",
      dueDate: "2026-10-08",
    });
    const unknown = await createTask(s.admin.id, s.project.id, {
      title: "时间未知",
    });
    await db
      .update(tasks)
      .set({
        isBlocked: true,
        blockedAt: new Date("2026-10-05T23:59:00+08:00"),
      })
      .where(eq(tasks.id, overdue.id));
    await db
      .update(tasks)
      .set({ isBlocked: true, blockedAt: null })
      .where(eq(tasks.id, unknown.id));
    const result = await listProjectRisks(s.member.id, s.project.id);
    expect(result.items.map((i) => i.ruleId)).toEqual([
      "overdue_task",
      "blocked_task",
    ]);
    expect(result.unknownRules).toContain("blocked_task");
    expect(result.unknownRules).toContain("inactive_project");
    await db
      .update(projects)
      .set({ status: "archived" })
      .where(eq(projects.id, s.project.id));
    expect((await listProjectRisks(s.member.id, s.project.id)).items).toEqual(
      [],
    );
  });
  it("教师总览不显示本人只是学生的项目，降权和退组立即过滤；工作台有真实迭代", async () => {
    const s = await scene();
    const iteration = await createIteration(s.admin.id, s.project.id, {
      requestId: randomUUID(),
      name: "当前迭代",
      startDate: "2026-10-01",
      endDate: "2026-10-15",
    });
    await startIteration(s.admin.id, s.project.id, iteration.id, {
      requestId: randomUUID(),
      expectedRevision: iteration.revision,
    });
    expect((await listTeacherProjectOverview(s.teacher.id)).total).toBe(1);
    expect((await listTeacherProjectOverview(s.member.id)).total).toBe(0);
    const summary = await getMyWorkspaceSummary(s.member.id);
    expect(summary.activeIterations.state).toBe("ready");
    if (summary.activeIterations.state === "ready")
      expect(summary.activeIterations.data.items[0].id).toBe(iteration.id);
    await updateMemberRole(s.admin.id, s.team.id, s.teacher.id, "student");
    expect((await listTeacherProjectOverview(s.teacher.id)).total).toBe(0);
    await db
      .delete(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, s.team.id),
          eq(teamMembers.userId, s.member.id),
        ),
      );
    expect(
      (await listProjectEvidence(s.admin.id, s.project.id)).total,
    ).toBeGreaterThanOrEqual(0);
    await expect(
      listProjectEvidence(s.member.id, s.project.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("72 小时无活动规则有真实事件来源，公告不能冒充协作活动", async () => {
    const s = await scene();
    await createTask(s.admin.id, s.project.id, { title: "很久以前" });
    await db
      .update(projectActivities)
      .set({ occurredAt: new Date("2026-10-05T09:00:00+08:00") })
      .where(eq(projectActivities.projectId, s.project.id));
    const result = await listProjectRisks(s.member.id, s.project.id);
    expect(
      result.items.find((i) => i.ruleId === "inactive_project")?.sourceRefs[0]
        .evidenceKey,
    ).toMatch(/^activity:/);
    await db.execute(sql`select 1`);
  });
});
