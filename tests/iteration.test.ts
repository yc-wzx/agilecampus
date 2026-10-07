import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask } from "@/lib/task";
import { listBacklog } from "@/lib/task-contract";
import {
  assignTasks,
  completeIteration,
  createIteration,
  getCurrentIteration,
  getIterationDetail,
  listProjectIterations,
  previewIterationCompletion,
  reorderBacklog,
  removeTasks,
  startIteration,
  updateIteration,
} from "@/lib/iteration";
import { resetDb } from "./helpers";

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
  await updateMemberRole(owner.id, team.id, teacher.id, "teacher");
  const outsider = await makeUser("outsider@example.com");
  const otherTeam = await createTeam(outsider.id, "曹魏实验室");
  const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
  return { owner, team, student, teacher, outsider, otherTeam, project };
}

const rid = () => randomUUID();

async function makeIteration(actorId: string, projectId: string, name = "第一轮") {
  return createIteration(actorId, projectId, {
    requestId: rid(),
    name,
    startDate: "2026-10-01",
    endDate: "2026-10-14",
  });
}

describe("createIteration", () => {
  beforeEach(resetDb);

  it("默认 planned、revision=1、未开始未结束", async () => {
    const { student, project } = await scene();
    const it0 = await makeIteration(student.id, project.id);
    expect(it0.status).toBe("planned");
    expect(it0.revision).toBe(1);
    expect(it0.startedAt).toBeNull();
    expect(it0.completedAt).toBeNull();
    expect(it0.startDate).toBe("2026-10-01");
    expect(it0.projectId).toBe(project.id);
  });

  it("开始日期晚于结束日期被拒", async () => {
    const { student, project } = await scene();
    await expect(
      createIteration(student.id, project.id, {
        requestId: rid(),
        name: "倒挂",
        startDate: "2026-10-14",
        endDate: "2026-10-01",
      }),
    ).rejects.toThrow("不能晚于");
  });

  it("teacher 建迭代被拒（只读）", async () => {
    const { teacher, project } = await scene();
    await expect(makeIteration(teacher.id, project.id)).rejects.toThrow("没有权限");
  });

  it("无关团队的人建迭代被拒", async () => {
    const { outsider, project } = await scene();
    await expect(makeIteration(outsider.id, project.id)).rejects.toThrow("没有权限");
  });

  it("相同 requestId 重放不再建第二轮，返回首次结果", async () => {
    const { student, project } = await scene();
    const requestId = rid();
    const input = {
      requestId,
      name: "重放轮",
      startDate: "2026-10-01",
      endDate: "2026-10-14",
    };
    const first = await createIteration(student.id, project.id, input);
    const replay = await createIteration(student.id, project.id, input);
    expect(replay.id).toBe(first.id);
    expect(replay.createdAt).toBe(first.createdAt);
    const page = await listProjectIterations(student.id, project.id);
    expect(page.total).toBe(1);
  });

  it("相同 requestId 配不同内容返回冲突", async () => {
    const { student, project } = await scene();
    const requestId = rid();
    await createIteration(student.id, project.id, {
      requestId,
      name: "原名",
      startDate: "2026-10-01",
      endDate: "2026-10-14",
    });
    await expect(
      createIteration(student.id, project.id, {
        requestId,
        name: "换了名字",
        startDate: "2026-10-01",
        endDate: "2026-10-14",
      }),
    ).rejects.toThrow("同一请求标识");
  });
});

describe("startIteration", () => {
  beforeEach(resetDb);

  it("planned -> active，写 startedAt 并自增 revision", async () => {
    const { student, project } = await scene();
    const it0 = await makeIteration(student.id, project.id);
    const started = await startIteration(student.id, project.id, it0.id, {
      requestId: rid(),
      expectedRevision: it0.revision,
    });
    expect(started.status).toBe("active");
    expect(started.revision).toBe(2);
    expect(started.startedAt).not.toBeNull();
  });

  it("陈旧 expectedRevision 返回冲突且不改数据", async () => {
    const { student, project } = await scene();
    const it0 = await makeIteration(student.id, project.id);
    await expect(
      startIteration(student.id, project.id, it0.id, {
        requestId: rid(),
        expectedRevision: 99,
      }),
    ).rejects.toThrow("已被他人修改");

    const page = await listProjectIterations(student.id, project.id);
    expect(page.items[0].status).toBe("planned");
    expect(page.items[0].revision).toBe(1);
  });

  it("重复开始同一轮被拒", async () => {
    const { student, project } = await scene();
    const it0 = await makeIteration(student.id, project.id);
    const started = await startIteration(student.id, project.id, it0.id, {
      requestId: rid(),
      expectedRevision: it0.revision,
    });
    await expect(
      startIteration(student.id, project.id, it0.id, {
        requestId: rid(),
        expectedRevision: started.revision,
      }),
    ).rejects.toThrow("已经开始");
  });

  it("并发开始两轮迭代：恰好一个成功", async () => {
    const { student, project } = await scene();
    const a = await makeIteration(student.id, project.id, "甲轮");
    const b = await makeIteration(student.id, project.id, "乙轮");

    const results = await Promise.allSettled([
      startIteration(student.id, project.id, a.id, {
        requestId: rid(),
        expectedRevision: a.revision,
      }),
      startIteration(student.id, project.id, b.id, {
        requestId: rid(),
        expectedRevision: b.revision,
      }),
    ]);

    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(1);

    const page = await listProjectIterations(student.id, project.id);
    expect(page.items.filter((i) => i.status === "active")).toHaveLength(1);
  });

  it("getCurrentIteration 只认 active，无 active 时为 null", async () => {
    const { student, project } = await scene();
    const it0 = await makeIteration(student.id, project.id);
    expect(await getCurrentIteration(student.id, project.id)).toBeNull();

    await startIteration(student.id, project.id, it0.id, {
      requestId: rid(),
      expectedRevision: it0.revision,
    });
    const current = await getCurrentIteration(student.id, project.id);
    expect(current?.id).toBe(it0.id);
    expect(current?.status).toBe("active");
    expect(current?.scope).toBe("main-tasks");
  });
});

describe("updateIteration", () => {
  beforeEach(resetDb);

  it("改名字自增 revision；陈旧 revision 被拒", async () => {
    const { student, project } = await scene();
    const it0 = await makeIteration(student.id, project.id);
    const renamed = await updateIteration(student.id, project.id, it0.id, {
      requestId: rid(),
      expectedRevision: it0.revision,
      name: "改过的名字",
    });
    expect(renamed.name).toBe("改过的名字");
    expect(renamed.revision).toBe(2);

    await expect(
      updateIteration(student.id, project.id, it0.id, {
        requestId: rid(),
        expectedRevision: it0.revision,
        name: "又改",
      }),
    ).rejects.toThrow("已被他人修改");
  });

  it("进行中的迭代不能改基本字段（定稿：仅 planned 可改）", async () => {
    const { student, project } = await scene();
    const it0 = await makeIteration(student.id, project.id);
    const started = await startIteration(student.id, project.id, it0.id, {
      requestId: rid(),
      expectedRevision: it0.revision,
    });
    await expect(
      updateIteration(student.id, project.id, it0.id, {
        requestId: rid(),
        expectedRevision: started.revision,
        name: "偷偷改名",
      }),
    ).rejects.toThrow("只有计划中的迭代");

    const page = await listProjectIterations(student.id, project.id);
    expect(page.items[0].name).toBe("第一轮");
    expect(page.items[0].revision).toBe(started.revision);
  });

  it("已结束的迭代不能改基本字段", async () => {
    const { student, project } = await scene();
    const it0 = await makeIteration(student.id, project.id);
    await startIteration(student.id, project.id, it0.id, {
      requestId: rid(),
      expectedRevision: it0.revision,
    });
    const preview = await previewIterationCompletion(student.id, project.id, it0.id);
    const closed = await completeIteration(student.id, project.id, it0.id, {
      requestId: rid(),
      expectedRevision: preview.iterationRevision,
      taskVersions: preview.taskVersions,
      unfinishedDisposition: [],
    });

    await expect(
      updateIteration(student.id, project.id, it0.id, {
        requestId: rid(),
        expectedRevision: closed.iteration.revision,
        name: "偷偷改名",
      }),
    ).rejects.toThrow("只有计划中的迭代");
  });

  it("只改结束日期时仍校验区间", async () => {
    const { student, project } = await scene();
    const it0 = await makeIteration(student.id, project.id);
    await expect(
      updateIteration(student.id, project.id, it0.id, {
        requestId: rid(),
        expectedRevision: it0.revision,
        endDate: "2026-09-01",
      }),
    ).rejects.toThrow("不能晚于");
  });
});

describe("assignTasks / removeTasks", () => {
  beforeEach(resetDb);

  it("入轮后任务离开任务池，移出后回到任务池", async () => {
    const { student, project } = await scene();
    const it0 = await makeIteration(student.id, project.id);
    const task = await createTask(student.id, project.id, { title: "写周报" });

    const backlogBefore = await listBacklog(student.id, project.id);
    expect(backlogBefore.items.map((t) => t.id)).toContain(task.id);

    await assignTasks(student.id, project.id, it0.id, {
      requestId: rid(),
      expectedRevision: it0.revision,
      tasks: [{ taskId: task.id, expectedUpdatedAt: task.updatedAt.toISOString() }],
    });

    const backlogInside = await listBacklog(student.id, project.id);
    expect(backlogInside.items.map((t) => t.id)).not.toContain(task.id);

    const detail = await getIterationDetail(student.id, project.id, it0.id);
    expect(detail.tasks.map((t) => t.id)).toEqual([task.id]);
    expect(detail.tasks[0].iterationId).toBe(it0.id);
    expect(detail.stats.taskTotal).toBe(1);
    expect(detail.stats.doneRatio).toBe(0);
    // 入轮留下流水；复盘要等迭代结束才写得了，此刻如实为空
    expect(detail.history.map((h) => h.type)).toEqual(["created", "tasks_assigned"]);
    expect(detail.retrospective).toBeNull();

    const [afterAssign] = (
      await getIterationDetail(student.id, project.id, it0.id)
    ).tasks;
    const removed = await removeTasks(student.id, project.id, it0.id, {
      requestId: rid(),
      expectedRevision: 2,
      tasks: [{ taskId: task.id, expectedUpdatedAt: afterAssign.updatedAt }],
    });
    expect(removed.taskIds).toEqual([task.id]);

    const backlogAfter = await listBacklog(student.id, project.id);
    expect(backlogAfter.items.map((t) => t.id)).toContain(task.id);
  });

  it("陈旧 expectedUpdatedAt 拒绝入轮，且不改数据", async () => {
    const { student, project } = await scene();
    const it0 = await makeIteration(student.id, project.id);
    const task = await createTask(student.id, project.id, { title: "写周报" });
    await createTask(student.id, project.id, { title: "占位" });

    await expect(
      assignTasks(student.id, project.id, it0.id, {
        requestId: rid(),
        expectedRevision: it0.revision,
        tasks: [
          {
            taskId: task.id,
            expectedUpdatedAt: new Date(0).toISOString(),
          },
        ],
      }),
    ).rejects.toThrow("已被他人修改");

    const backlog = await listBacklog(student.id, project.id);
    expect(backlog.items.map((t) => t.id)).toContain(task.id);
  });

  it("任务不能同时属于两轮迭代", async () => {
    const { student, project } = await scene();
    const a = await makeIteration(student.id, project.id, "甲轮");
    const b = await makeIteration(student.id, project.id, "乙轮");
    const task = await createTask(student.id, project.id, { title: "写周报" });

    const assigned = await assignTasks(student.id, project.id, a.id, {
      requestId: rid(),
      expectedRevision: a.revision,
      tasks: [{ taskId: task.id, expectedUpdatedAt: task.updatedAt.toISOString() }],
    });
    const moved = (await getIterationDetail(student.id, project.id, a.id)).tasks[0];
    expect(assigned.taskIds).toEqual([task.id]);

    await expect(
      assignTasks(student.id, project.id, b.id, {
        requestId: rid(),
        expectedRevision: b.revision,
        tasks: [{ taskId: task.id, expectedUpdatedAt: moved.updatedAt }],
      }),
    ).rejects.toThrow("已属于另一轮");
  });
});

describe("reorderBacklog", () => {
  beforeEach(resetDb);

  it("中点插入改变顺序，刷新后顺序保持", async () => {
    const { student, project } = await scene();
    const a = await createTask(student.id, project.id, { title: "甲" });
    const b = await createTask(student.id, project.id, { title: "乙" });
    const c = await createTask(student.id, project.id, { title: "丙" });

    // 把「丙」拖到「甲」前面
    await reorderBacklog(student.id, project.id, {
      requestId: rid(),
      taskId: c.id,
      beforeTaskId: a.id,
      expectedUpdatedAt: c.updatedAt.toISOString(),
    });

    const page = await listBacklog(student.id, project.id);
    expect(page.items.map((t) => t.id)).toEqual([c.id, a.id, b.id]);
  });

  it("beforeTaskId 为 null 时排到末尾", async () => {
    const { student, project } = await scene();
    const a = await createTask(student.id, project.id, { title: "甲" });
    const b = await createTask(student.id, project.id, { title: "乙" });
    await reorderBacklog(student.id, project.id, {
      requestId: rid(),
      taskId: a.id,
      beforeTaskId: null,
      expectedUpdatedAt: a.updatedAt.toISOString(),
    });
    const page = await listBacklog(student.id, project.id);
    expect(page.items.map((t) => t.id)).toEqual([b.id, a.id]);
  });

  it("锚点不在任务池（已在迭代里）时拒绝", async () => {
    const { student, project } = await scene();
    const it0 = await makeIteration(student.id, project.id);
    const pooled = await createTask(student.id, project.id, { title: "池里的" });
    const inIter = await createTask(student.id, project.id, { title: "轮里的" });
    await assignTasks(student.id, project.id, it0.id, {
      requestId: rid(),
      expectedRevision: it0.revision,
      tasks: [{ taskId: inIter.id, expectedUpdatedAt: inIter.updatedAt.toISOString() }],
    });

    await expect(
      reorderBacklog(student.id, project.id, {
        requestId: rid(),
        taskId: pooled.id,
        beforeTaskId: inIter.id,
        expectedUpdatedAt: pooled.updatedAt.toISOString(),
      }),
    ).rejects.toThrow("锚点任务不在任务池中");
  });

  it("陈旧 expectedUpdatedAt 拒绝排序", async () => {
    const { student, project } = await scene();
    const a = await createTask(student.id, project.id, { title: "甲" });
    await createTask(student.id, project.id, { title: "乙" });
    await expect(
      reorderBacklog(student.id, project.id, {
        requestId: rid(),
        taskId: a.id,
        beforeTaskId: null,
        expectedUpdatedAt: new Date(0).toISOString(),
      }),
    ).rejects.toThrow("已被他人修改");
  });

  it("teacher 不能排序", async () => {
    const { student, teacher, project } = await scene();
    const a = await createTask(student.id, project.id, { title: "甲" });
    await createTask(student.id, project.id, { title: "乙" });
    await expect(
      reorderBacklog(teacher.id, project.id, {
        requestId: rid(),
        taskId: a.id,
        beforeTaskId: null,
        expectedUpdatedAt: a.updatedAt.toISOString(),
      }),
    ).rejects.toThrow("没有权限");
  });
});
