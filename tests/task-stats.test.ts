import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createSubtask, createTask, updateTask } from "@/lib/task";
import {
  getProjectTaskStats,
  getTaskPanelData,
  listProjectTaskAttention,
  setTaskBlocked,
} from "@/lib/task-contract";
import { resetDb } from "./helpers";

// 「今天」由服务端按北京时区现算，测试不能钉死某一天——用足够远的过去与将来即可。
const LONG_AGO = "2020-01-01";
const FAR_FUTURE = "2099-12-31";

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

async function scene() {
  const owner = await makeUser("owner@example.com");
  const team = await createTeam(owner.id, "东吴实验室");
  const student = await makeUser("student@example.com");
  await joinTeam(student.id, team.inviteCode);
  const teacher = await makeUser("teacher@example.com");
  await joinTeam(teacher.id, team.inviteCode);
  const outsider = await makeUser("outsider@example.com");
  const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
  return { owner, team, student, teacher, outsider, project };
}

const rid = () => randomUUID();

/** 阻塞一个任务，返回它阻塞后的 TaskSummary。 */
async function block(actorId: string, projectId: string, taskId: string, reason = "等接口") {
  const panel = await getTaskPanelData(actorId, projectId, taskId);
  return setTaskBlocked(actorId, projectId, taskId, {
    requestId: rid(),
    expectedUpdatedAt: panel.task.updatedAt,
    isBlocked: true,
    blockedReason: reason,
  });
}

describe("getProjectTaskStats", () => {
  beforeEach(resetDb);

  it("按状态分桶，子任务不计入 total", async () => {
    const { student, project } = await scene();
    await createTask(student.id, project.id, {
      title: "逾期的",
      dueDate: LONG_AGO,
      assigneeId: student.id,
    });
    const doing = await createTask(student.id, project.id, {
      title: "进行中的",
      assigneeId: student.id,
    });
    await updateTask(student.id, doing.id, { status: "doing" });
    const done = await createTask(student.id, project.id, { title: "做完的" });
    await updateTask(student.id, done.id, { status: "done" });
    await createTask(student.id, project.id, { title: "还没动" });
    // 子任务：口径是主任务，不能把一个父任务算两次
    await createSubtask(student.id, done.id, { title: "子任务" });

    const stats = await getProjectTaskStats(student.id, project.id);

    expect(stats.projectId).toBe(project.id);
    expect(stats.scope).toBe("main-tasks");
    expect(stats.total).toBe(4);
    expect(stats.byStatus).toEqual({ todo: 2, doing: 1, done: 1 });
    expect(stats.doneRatio).toBeCloseTo(0.25);
    expect(stats.overdueCount).toBe(1);
    expect(stats.blockedCount).toBe(0);
  });

  it("已完成的逾期任务不算逾期", async () => {
    const { student, project } = await scene();
    const late = await createTask(student.id, project.id, {
      title: "晚做完的",
      dueDate: LONG_AGO,
    });
    await updateTask(student.id, late.id, { status: "done" });

    const stats = await getProjectTaskStats(student.id, project.id);
    expect(stats.overdueCount).toBe(0);
  });

  it("没有截止日期不算逾期", async () => {
    const { student, project } = await scene();
    await createTask(student.id, project.id, { title: "什么时候做都行" });
    const stats = await getProjectTaskStats(student.id, project.id);
    expect(stats.overdueCount).toBe(0);
  });

  it("阻塞任务计入 blockedCount", async () => {
    const { student, project } = await scene();
    const stuck = await createTask(student.id, project.id, { title: "被卡的" });
    await block(student.id, project.id, stuck.id);

    const stats = await getProjectTaskStats(student.id, project.id);
    expect(stats.blockedCount).toBe(1);
    expect(stats.byStatus.todo).toBe(1);
  });

  it("空项目 total 为 0 且 doneRatio 为 null（不是 0）", async () => {
    const { student, project } = await scene();
    const stats = await getProjectTaskStats(student.id, project.id);
    expect(stats.total).toBe(0);
    expect(stats.doneRatio).toBeNull();
    expect(stats.overdueCount).toBe(0);
    expect(stats.blockedCount).toBe(0);
  });

  it("无关团队读不到", async () => {
    const { outsider, project } = await scene();
    await expect(getProjectTaskStats(outsider.id, project.id)).rejects.toThrow();
  });
});

describe("listProjectTaskAttention", () => {
  beforeEach(resetDb);

  it("kind=overdue 只回逾期且未完成的任务", async () => {
    const { student, project } = await scene();
    const late = await createTask(student.id, project.id, {
      title: "逾期的",
      dueDate: LONG_AGO,
      assigneeId: student.id,
    });
    await createTask(student.id, project.id, {
      title: "还早",
      dueDate: FAR_FUTURE,
      assigneeId: student.id,
    });

    const page = await listProjectTaskAttention(student.id, project.id, { kind: "overdue" });
    expect(page.total).toBe(1);
    expect(page.items.map((i) => i.taskId)).toEqual([late.id]);
    expect(page.items[0].title).toBe("逾期的");
    expect(page.items[0].dueDate).toBe(LONG_AGO);
  });

  it("kind=blocked 只回阻塞中的任务，并带上阻塞时间", async () => {
    const { student, project } = await scene();
    const stuck = await createTask(student.id, project.id, { title: "被卡的" });
    await createTask(student.id, project.id, { title: "通畅的" });
    await block(student.id, project.id, stuck.id);

    const page = await listProjectTaskAttention(student.id, project.id, { kind: "blocked" });
    expect(page.items.map((i) => i.taskId)).toEqual([stuck.id]);
    expect(page.items[0].blockedAt).not.toBeNull();
    expect(page.items[0].sourceRef.sourceKind).toBe("task");
    expect(page.items[0].sourceRef.sourceId).toBe(stuck.id);
    expect(page.items[0].sourceRef.availability).toBe("available");
  });

  it("已完成的任务两种清单都不进", async () => {
    const { student, project } = await scene();
    const late = await createTask(student.id, project.id, {
      title: "早就该做的",
      dueDate: LONG_AGO,
    });
    await block(student.id, project.id, late.id);
    await updateTask(student.id, late.id, { status: "done" });

    const overdue = await listProjectTaskAttention(student.id, project.id, { kind: "overdue" });
    const blocked = await listProjectTaskAttention(student.id, project.id, { kind: "blocked" });
    expect(overdue.items).toEqual([]);
    expect(blocked.items).toEqual([]);
  });

  it("一条任务两个理由都占时，两种清单各出现一次", async () => {
    const { student, project } = await scene();
    const both = await createTask(student.id, project.id, { title: "又逾期又被卡" });
    await updateTask(student.id, both.id, { dueDate: LONG_AGO });
    await block(student.id, project.id, both.id);

    const overdue = await listProjectTaskAttention(student.id, project.id, { kind: "overdue" });
    const blocked = await listProjectTaskAttention(student.id, project.id, { kind: "blocked" });
    expect(overdue.items.map((i) => i.taskId)).toEqual([both.id]);
    expect(blocked.items.map((i) => i.taskId)).toEqual([both.id]);
  });

  it("全都健康时返回空分页（不是空对象）", async () => {
    const { student, project } = await scene();
    const healthy = await createTask(student.id, project.id, {
      title: "健康的任务",
      assigneeId: student.id,
      dueDate: FAR_FUTURE,
    });
    await updateTask(student.id, healthy.id, { status: "doing" });

    const page = await listProjectTaskAttention(student.id, project.id, { kind: "overdue" });
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.nextOffset).toBeNull();
  });

  it("分页：limit 生效，nextOffset 指下一条", async () => {
    const { student, project } = await scene();
    for (const title of ["甲", "乙", "丙"]) {
      await createTask(student.id, project.id, { title, dueDate: LONG_AGO });
    }

    const firstPage = await listProjectTaskAttention(student.id, project.id, {
      kind: "overdue",
      limit: 2,
    });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.total).toBe(3);
    expect(firstPage.nextOffset).toBe(2);
  });

  it("无关团队读不到", async () => {
    const { outsider, project } = await scene();
    await expect(
      listProjectTaskAttention(outsider.id, project.id, { kind: "overdue" }),
    ).rejects.toThrow();
  });
});
