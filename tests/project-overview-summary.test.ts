import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createDeliverableDraft, submitDeliverable } from "@/lib/deliverable";
import { ForbiddenError } from "@/lib/errors";
import { createIteration, startIteration } from "@/lib/iteration";
import { createMilestone, createProject } from "@/lib/project";
import { getProjectOverviewSummary } from "@/lib/project-overview-summary";
import { createSubtask, createTask } from "@/lib/task";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createUser } from "@/lib/user";
import { resetDb } from "./helpers";
import type { QueryPart } from "@/contracts/p0-p2";

async function makeUser(email: string) {
  return createUser({
    email,
    password: "password123",
    name: email.split("@")[0],
  });
}

// 常用布景：owner(admin) 建团队，student/teacher 加入，outsider 在野
async function scene() {
  const owner = await makeUser("owner@example.com");
  const team = await createTeam(owner.id, "东吴实验室");
  const student = await makeUser("student@example.com");
  await joinTeam(student.id, team.inviteCode);
  const teacher = await makeUser("teacher@example.com");
  await joinTeam(teacher.id, team.inviteCode);
  await updateMemberRole(owner.id, team.id, teacher.id, "teacher");
  const outsider = await makeUser("outsider@example.com");
  const project = await createProject(owner.id, team.id, {
    name: "赤壁演习",
    description: "冬季学期项目",
  });
  return { owner, team, student, teacher, outsider, project };
}

function ready<T>(part: QueryPart<T>): T {
  if (part.state !== "ready") {
    throw new Error(`期望 ready，实际 ${part.state}：${part.message}`);
  }
  return part.data;
}

describe("getProjectOverviewSummary (B-G01)", () => {
  beforeEach(resetDb);

  it("非团队成员被拒，不泄露项目是否存在", async () => {
    const { project, outsider } = await scene();
    await expect(
      getProjectOverviewSummary(outsider.id, project.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("C/D/E/F 已交付的数据源是 ready，没有置顶公告时返回真实 null", async () => {
    const { project, student, owner } = await scene();
    await createMilestone(owner.id, project.id, {
      title: "中期答辩",
      targetDate: "2026-11-15",
    });

    const summary = await getProjectOverviewSummary(student.id, project.id);

    expect(summary.project.id).toBe(project.id);
    expect(summary.project.name).toBe("赤壁演习");
    expect(summary.role).toBe("student");
    expect(summary.milestones.map((m) => m.title)).toEqual(["中期答辩"]);
    expect(Number.isNaN(Date.parse(summary.asOf))).toBe(false);

    // C（任务统计 / 当前迭代）与 D（成果统计）已交付 → 真实结果
    expect(summary.taskStats.state).toBe("ready");
    expect(summary.activeIteration.state).toBe("ready");
    expect(summary.deliverableStats.state).toBe("ready");

    // E（活动）已交付：没有活动时是空列表 + 覆盖说明，不是 unavailable，也不伪造一条
    const activities = ready(summary.recentActivities);
    expect(activities.items).toEqual([]);
    expect(activities.total).toBe(0);
    expect(activities.coverage.availableFrom).toBeNull();
    expect(activities.coverage.complete).toBe(false);

    expect(summary.pinnedAnnouncement).toEqual({ state: "ready", data: null });
  });

  it("任务统计走 C 的主任务口径：子任务不计入总数（C-T08）", async () => {
    const { project, owner } = await scene();
    await createTask(owner.id, project.id, { title: "用户调研" });
    const parent = await createTask(owner.id, project.id, {
      title: "竞品分析",
    });
    await createSubtask(owner.id, parent.id, { title: "访谈提纲" });

    const stats = ready(
      (await getProjectOverviewSummary(owner.id, project.id)).taskStats,
    );

    expect(stats.scope).toBe("main-tasks");
    // 两个主任务 + 一个子任务：子任务不计入，否则父任务会被算两次
    expect(stats.total).toBe(2);
    expect(stats.byStatus.todo).toBe(2);
    expect(stats.byStatus.done).toBe(0);
    expect(stats.doneRatio).toBe(0);
  });

  it("没有任务时 doneRatio 是 null，页面不得显示成 0% 或 100%", async () => {
    const { project, owner } = await scene();
    const stats = ready(
      (await getProjectOverviewSummary(owner.id, project.id)).taskStats,
    );
    expect(stats.total).toBe(0);
    expect(stats.doneRatio).toBeNull();
  });

  it("当前迭代只取 active：planned 轮不算，开始之后才出现（C-I12）", async () => {
    const { project, owner } = await scene();

    const before = await getProjectOverviewSummary(owner.id, project.id);
    if (before.activeIteration.state !== "ready") throw new Error("期望 ready");
    expect(before.activeIteration.data).toBeNull();

    const iteration = await createIteration(owner.id, project.id, {
      requestId: randomUUID(),
      name: "第一轮",
      goal: "完成用户调研",
      startDate: "2026-10-01",
      endDate: "2026-10-21",
    });

    const planned = await getProjectOverviewSummary(owner.id, project.id);
    if (planned.activeIteration.state !== "ready")
      throw new Error("期望 ready");
    expect(planned.activeIteration.data).toBeNull(); // planned 不是 active

    await startIteration(owner.id, project.id, iteration.id, {
      requestId: randomUUID(),
      expectedRevision: iteration.revision,
    });

    const active = await getProjectOverviewSummary(owner.id, project.id);
    if (active.activeIteration.state !== "ready") throw new Error("期望 ready");
    expect(active.activeIteration.data?.id).toBe(iteration.id);
    expect(active.activeIteration.data?.name).toBe("第一轮");
    expect(active.activeIteration.data?.scope).toBe("main-tasks");
  });

  it("成果统计只计正式提交：草稿不进分母，没有正式成果时比率为 null", async () => {
    const { project, student } = await scene();

    await createDeliverableDraft(student.id, project.id, {
      title: "调研报告",
      type: "report",
      url: "",
      description: "",
      milestoneId: null,
      requestId: randomUUID(),
    });
    const draftStats = ready(
      (await getProjectOverviewSummary(student.id, project.id))
        .deliverableStats,
    );
    expect(draftStats.total).toBe(0);
    expect(draftStats.approvedRatio).toBeNull();
    expect(draftStats.scope).toBe("current-submitted-deliverables");

    const draft = await createDeliverableDraft(student.id, project.id, {
      title: "调研报告",
      type: "report",
      url: "https://example.com/report",
      description: "第一版",
      milestoneId: null,
      requestId: randomUUID(),
    });
    await submitDeliverable(student.id, project.id, draft.id, {
      requestId: randomUUID(),
      expectedRevision: draft.revision,
    });

    const stats = ready(
      (await getProjectOverviewSummary(student.id, project.id))
        .deliverableStats,
    );
    expect(stats.total).toBe(1);
    expect(stats.byStatus.submitted).toBe(1);
    expect(stats.byStatus.approved).toBe(0);
    expect(stats.approvedRatio).toBe(0);
  });

  it("教师可读项目概览，角色仍按当前团队成员身份返回", async () => {
    const { project, teacher } = await scene();
    const summary = await getProjectOverviewSummary(teacher.id, project.id);
    expect(summary.role).toBe("teacher");
    expect(summary.project.id).toBe(project.id);
  });
});
