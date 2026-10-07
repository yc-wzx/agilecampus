import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { teamMembers } from "@/db/schema";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject, updateProject } from "@/lib/project";
import { createSubtask, createTask, getTaskDetail, updateTask } from "@/lib/task";
import { listBacklog } from "@/lib/task-contract";
import {
  assignTasks,
  completeIteration,
  createIteration,
  createIterationWithTasks,
  deletePlannedIteration,
  getCurrentIteration,
  getIterationDetail,
  getIterationHistory,
  getIterationRetrospective,
  listMyActiveIterations,
  previewIterationCompletion,
  saveIterationRetrospective,
  startIteration,
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
  const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
  return { owner, team, student, teacher, project };
}

const rid = () => randomUUID();

/** 取任务当前行——入轮要带 updatedAt，所以每次都得现查，不能拿建任务时的旧值。 */
function freshTask(actorId: string, taskId: string) {
  return getTaskDetail(actorId, taskId);
}

/** 建一轮已开始的迭代，里面挂着 taskIds 里的任务。 */
async function activeIteration(actorId: string, projectId: string, taskIds: string[]) {
  const iteration = await createIteration(actorId, projectId, {
    requestId: rid(),
    name: "第一轮",
    startDate: "2026-10-01",
    endDate: "2026-10-14",
  });
  const started = await startIteration(actorId, projectId, iteration.id, {
    requestId: rid(),
    expectedRevision: iteration.revision,
  });
  if (taskIds.length > 0) {
    const tasks = await Promise.all(taskIds.map((id) => freshTask(actorId, id)));
    await assignTasks(actorId, projectId, iteration.id, {
      requestId: rid(),
      expectedRevision: started.revision,
      tasks: tasks.map((t) => ({ taskId: t.id, expectedUpdatedAt: t.updatedAt.toISOString() })),
    });
  }
  const detail = await getIterationDetail(actorId, projectId, iteration.id);
  return detail.iteration;
}

/**
 * 按预览结果拼一份「全部退回任务池」的结束输入。
 * 结束要求去向完整覆盖未完成主任务，所以测试也从预览取基线，而不是手写。
 */
async function completeInput(actorId: string, projectId: string, iterationId: string) {
  const preview = await previewIterationCompletion(actorId, projectId, iterationId);
  return {
    requestId: rid(),
    expectedRevision: preview.iterationRevision,
    taskVersions: preview.taskVersions,
    unfinishedDisposition: preview.unfinishedTasks.map((t) => ({
      taskId: t.id,
      destination: "backlog" as const,
    })),
  };
}

describe("previewIterationCompletion", () => {
  beforeEach(resetDb);

  it("按主任务口径拆成已完成 / 未完成，并给出每个任务的版本基线", async () => {
    const { student, project } = await scene();
    const doing = await createTask(student.id, project.id, { title: "还在做" });
    const finished = await createTask(student.id, project.id, { title: "做完了" });
    const iteration = await activeIteration(student.id, project.id, [doing.id, finished.id]);
    await updateTask(student.id, finished.id, { status: "done" });

    const preview = await previewIterationCompletion(student.id, project.id, iteration.id);

    expect(preview.iterationRevision).toBe(iteration.revision);
    expect(preview.completedTasks.map((t) => t.id)).toEqual([finished.id]);
    expect(preview.unfinishedTasks.map((t) => t.id)).toEqual([doing.id]);
    expect(preview.taskVersions.map((v) => v.taskId).sort()).toEqual(
      [doing.id, finished.id].sort(),
    );
  });

  it("子任务不进结束表单——它跟随父任务，不单独安排去向", async () => {
    const { student, project } = await scene();
    const parent = await createTask(student.id, project.id, { title: "父任务" });
    const child = await createSubtask(student.id, parent.id, { title: "子任务" });
    const iteration = await activeIteration(student.id, project.id, [parent.id, child.id]);

    const preview = await previewIterationCompletion(student.id, project.id, iteration.id);
    expect(preview.unfinishedTasks.map((t) => t.id)).toEqual([parent.id]);
    expect(preview.taskVersions.map((v) => v.taskId)).toEqual([parent.id]);
  });

  it("可选落点只含同项目未结束、且不是本轮的迭代", async () => {
    const { student, project } = await scene();
    const iteration = await activeIteration(student.id, project.id, []);
    const other = await createIteration(student.id, project.id, {
      requestId: rid(),
      name: "第二轮",
      startDate: "2026-10-15",
      endDate: "2026-10-28",
    });

    const preview = await previewIterationCompletion(student.id, project.id, iteration.id);
    expect(preview.eligibleNextIterations.map((i) => i.id)).toEqual([other.id]);

    // 别的项目里的轮不能作为落点
    const otherTeam = await createTeam(student.id, "曹魏营");
    const otherProject = await createProject(student.id, otherTeam.id, { name: "合肥" });
    await createIteration(student.id, otherProject.id, {
      requestId: rid(),
      name: "外项目轮",
      startDate: "2026-10-15",
      endDate: "2026-10-28",
    });
    const again = await previewIterationCompletion(student.id, project.id, iteration.id);
    expect(again.eligibleNextIterations.map((i) => i.id)).toEqual([other.id]);
  });

  it("预览不落库：迭代状态与版本都不动", async () => {
    const { student, project } = await scene();
    const iteration = await activeIteration(student.id, project.id, []);
    await previewIterationCompletion(student.id, project.id, iteration.id);
    const detail = await getIterationDetail(student.id, project.id, iteration.id);
    expect(detail.iteration.status).toBe("active");
    expect(detail.iteration.revision).toBe(iteration.revision);
  });
});

describe("completeIteration", () => {
  beforeEach(resetDb);

  it("未完成的任务退回任务池，已完成的留在本轮", async () => {
    const { student, project } = await scene();
    const doing = await createTask(student.id, project.id, { title: "还在做" });
    const finished = await createTask(student.id, project.id, { title: "做完了" });
    const iteration = await activeIteration(student.id, project.id, [doing.id, finished.id]);
    await updateTask(student.id, finished.id, { status: "done" });

    const result = await completeIteration(
      student.id,
      project.id,
      iteration.id,
      await completeInput(student.id, project.id, iteration.id),
    );

    expect(result.iteration.status).toBe("completed");
    expect(result.iteration.completedAt).not.toBeNull();
    expect(result.movedTaskIds).toEqual([doing.id]);

    const backlog = await listBacklog(student.id, project.id);
    expect(backlog.items.map((t) => t.id)).toContain(doing.id);
    expect(backlog.items.map((t) => t.id)).not.toContain(finished.id);
  });

  it("可以指定把未完成任务转入另一轮，并推动目标轮的版本", async () => {
    const { student, project } = await scene();
    const doing = await createTask(student.id, project.id, { title: "还没做完" });
    const iteration = await activeIteration(student.id, project.id, [doing.id]);
    const next = await createIteration(student.id, project.id, {
      requestId: rid(),
      name: "第二轮",
      startDate: "2026-10-15",
      endDate: "2026-10-28",
    });

    const preview = await previewIterationCompletion(student.id, project.id, iteration.id);
    const result = await completeIteration(student.id, project.id, iteration.id, {
      requestId: rid(),
      expectedRevision: preview.iterationRevision,
      taskVersions: preview.taskVersions,
      unfinishedDisposition: [
        { taskId: doing.id, destination: "iteration", targetIterationId: next.id },
      ],
    });

    expect(result.movedTaskIds).toEqual([doing.id]);
    expect((await freshTask(student.id, doing.id)).sprintId).toBe(next.id);
    const nextDetail = await getIterationDetail(student.id, project.id, next.id);
    expect(nextDetail.tasks.map((t) => t.id)).toEqual([doing.id]);
    expect(nextDetail.iteration.revision).toBe(next.revision + 1);
  });

  it("去向漏掉一个未完成任务就整体拒绝，任务一个都不动", async () => {
    const { student, project } = await scene();
    const a = await createTask(student.id, project.id, { title: "甲" });
    const b = await createTask(student.id, project.id, { title: "乙" });
    const iteration = await activeIteration(student.id, project.id, [a.id, b.id]);

    const preview = await previewIterationCompletion(student.id, project.id, iteration.id);
    await expect(
      completeIteration(student.id, project.id, iteration.id, {
        requestId: rid(),
        expectedRevision: preview.iterationRevision,
        taskVersions: preview.taskVersions,
        unfinishedDisposition: [{ taskId: a.id, destination: "backlog" }],
      }),
    ).rejects.toThrow("请为每个未完成任务选择去向");

    const detail = await getIterationDetail(student.id, project.id, iteration.id);
    expect(detail.iteration.status).toBe("active");
    expect((await freshTask(student.id, a.id)).sprintId).toBe(iteration.id);
  });

  it("去向里混进不属于本轮未完成的任务也要拒绝", async () => {
    const { student, project } = await scene();
    const doing = await createTask(student.id, project.id, { title: "甲" });
    const stranger = await createTask(student.id, project.id, { title: "没入轮的" });
    const iteration = await activeIteration(student.id, project.id, [doing.id]);

    const preview = await previewIterationCompletion(student.id, project.id, iteration.id);
    await expect(
      completeIteration(student.id, project.id, iteration.id, {
        requestId: rid(),
        expectedRevision: preview.iterationRevision,
        taskVersions: preview.taskVersions,
        unfinishedDisposition: [
          { taskId: doing.id, destination: "backlog" },
          { taskId: stranger.id, destination: "backlog" },
        ],
      }),
    ).rejects.toThrow("不属于本轮未完成任务");
  });

  it("预览之后任务被改过（版本漂移）就拒绝，要求重新预览", async () => {
    const { student, project } = await scene();
    const doing = await createTask(student.id, project.id, { title: "甲" });
    const iteration = await activeIteration(student.id, project.id, [doing.id]);
    const input = await completeInput(student.id, project.id, iteration.id);

    await updateTask(student.id, doing.id, { title: "改了个名字" });

    await expect(
      completeIteration(student.id, project.id, iteration.id, input),
    ).rejects.toThrow("请重新预览后再结束");
  });

  it("陈旧 expectedRevision 返回冲突", async () => {
    const { student, project } = await scene();
    const iteration = await activeIteration(student.id, project.id, []);
    const input = await completeInput(student.id, project.id, iteration.id);

    await expect(
      completeIteration(student.id, project.id, iteration.id, {
        ...input,
        expectedRevision: input.expectedRevision + 5,
      }),
    ).rejects.toThrow("已被他人修改");
  });

  it("只有 active 的迭代能结束", async () => {
    const { student, project } = await scene();
    const planned = await createIteration(student.id, project.id, {
      requestId: rid(),
      name: "还没开始",
      startDate: "2026-10-01",
      endDate: "2026-10-14",
    });

    await expect(
      completeIteration(student.id, project.id, planned.id, {
        requestId: rid(),
        expectedRevision: planned.revision,
        taskVersions: [],
        unfinishedDisposition: [],
      }),
    ).rejects.toThrow("只有进行中的迭代才能结束");
  });

  it("已结束的迭代不能作为未完成任务的落点", async () => {
    const { student, project } = await scene();
    // 一个项目同时只能有一轮 active，所以要先后走：先结束一轮，再开一轮。
    const finished = await activeIteration(student.id, project.id, []);
    await completeIteration(
      student.id,
      project.id,
      finished.id,
      await completeInput(student.id, project.id, finished.id),
    );

    const doing = await createTask(student.id, project.id, { title: "甲" });
    const current = await activeIteration(student.id, project.id, [doing.id]);
    const preview = await previewIterationCompletion(student.id, project.id, current.id);
    expect(preview.eligibleNextIterations.map((i) => i.id)).not.toContain(finished.id);

    await expect(
      completeIteration(student.id, project.id, current.id, {
        requestId: rid(),
        expectedRevision: preview.iterationRevision,
        taskVersions: preview.taskVersions,
        unfinishedDisposition: [
          { taskId: doing.id, destination: "iteration", targetIterationId: finished.id },
        ],
      }),
    ).rejects.toThrow("目标迭代已结束");
  });

  it("结束之后该轮不再是当前迭代，且能再次开始新一轮", async () => {
    const { student, project } = await scene();
    const iteration = await activeIteration(student.id, project.id, []);
    await completeIteration(
      student.id,
      project.id,
      iteration.id,
      await completeInput(student.id, project.id, iteration.id),
    );
    expect(await getCurrentIteration(student.id, project.id)).toBeNull();

    const next = await createIteration(student.id, project.id, {
      requestId: rid(),
      name: "第二轮",
      startDate: "2026-10-15",
      endDate: "2026-10-28",
    });
    const started = await startIteration(student.id, project.id, next.id, {
      requestId: rid(),
      expectedRevision: next.revision,
    });
    expect(started.status).toBe("active");
    expect((await getCurrentIteration(student.id, project.id))?.id).toBe(next.id);
  });

  it("同 requestId 重放不会重复搬任务，也不会再写一份历史", async () => {
    const { student, project } = await scene();
    const doing = await createTask(student.id, project.id, { title: "甲" });
    const iteration = await activeIteration(student.id, project.id, [doing.id]);
    const input = await completeInput(student.id, project.id, iteration.id);

    const first = await completeIteration(student.id, project.id, iteration.id, input);
    const replay = await completeIteration(student.id, project.id, iteration.id, input);
    expect(replay.iteration.completedAt).toBe(first.iteration.completedAt);
    expect(replay.historyId).toBe(first.historyId);
  });

  it("teacher 不能结束迭代", async () => {
    const { student, teacher, project } = await scene();
    const iteration = await activeIteration(student.id, project.id, []);
    await expect(
      completeIteration(
        teacher.id,
        project.id,
        iteration.id,
        await completeInput(student.id, project.id, iteration.id),
      ),
    ).rejects.toThrow("没有权限");
  });
});

describe("不可变历史", () => {
  beforeEach(resetDb);

  it("快照记下结束那一刻的任务，之后任务改名也不重算", async () => {
    const { student, project } = await scene();
    const doing = await createTask(student.id, project.id, { title: "当时的名字" });
    const iteration = await activeIteration(student.id, project.id, [doing.id]);
    const input = await completeInput(student.id, project.id, iteration.id);
    const result = await completeIteration(student.id, project.id, iteration.id, input);

    const history = await getIterationHistory(student.id, project.id, iteration.id);
    expect(history).not.toBeNull();
    expect(history!.historyId).toBe(result.historyId);
    expect(history!.iterationSnapshot.status).toBe("completed");
    expect(history!.stats).toEqual({ taskTotal: 1, doneCount: 0, doneRatio: 0 });
    expect(history!.taskSnapshots.map((t) => t.title)).toEqual(["当时的名字"]);
    expect(history!.dispositions).toEqual([
      { taskId: doing.id, destination: "backlog" },
    ]);

    await updateTask(student.id, doing.id, { title: "改名了" });
    const again = await getIterationHistory(student.id, project.id, iteration.id);
    expect(again!.taskSnapshots.map((t) => t.title)).toEqual(["当时的名字"]);
  });

  it("没结束过的迭代没有历史（返回 null，不编一份出来）", async () => {
    const { student, project } = await scene();
    const iteration = await activeIteration(student.id, project.id, []);
    expect(await getIterationHistory(student.id, project.id, iteration.id)).toBeNull();
  });

  it("已结束的轮，详情读快照：未完成的任务搬走了仍列在这里", async () => {
    const { student, project } = await scene();
    const doing = await createTask(student.id, project.id, { title: "当时的名字" });
    const iteration = await activeIteration(student.id, project.id, [doing.id]);
    await completeIteration(
      student.id,
      project.id,
      iteration.id,
      await completeInput(student.id, project.id, iteration.id),
    );
    // 结束后任务已退回任务池——现查 tasks 会得到空列表，所以必须走快照
    expect((await freshTask(student.id, doing.id)).sprintId).toBeNull();

    const detail = await getIterationDetail(student.id, project.id, iteration.id);
    expect(detail.tasks.map((t) => t.id)).toEqual([doing.id]);
    expect(detail.tasks[0].title).toBe("当时的名字");
    expect(detail.stats).toEqual({ taskTotal: 1, doneCount: 0, doneRatio: 0 });
  });

  it("已结束的轮，任务改名或删除都不改变这一轮", async () => {
    const { student, project } = await scene();
    const done = await createTask(student.id, project.id, { title: "当时做完的" });
    const doing = await createTask(student.id, project.id, { title: "当时没做完的" });
    const iteration = await activeIteration(student.id, project.id, [done.id, doing.id]);
    await updateTask(student.id, done.id, { status: "done" });
    await completeIteration(
      student.id,
      project.id,
      iteration.id,
      await completeInput(student.id, project.id, iteration.id),
    );

    await updateTask(student.id, done.id, { title: "改名了" });

    const detail = await getIterationDetail(student.id, project.id, iteration.id);
    expect(detail.tasks.map((t) => t.title).sort()).toEqual(["当时做完的", "当时没做完的"].sort());
    expect(detail.stats).toEqual({ taskTotal: 2, doneCount: 1, doneRatio: 0.5 });
  });
});

describe("复盘", () => {
  beforeEach(resetDb);

  /** 复盘只属于已结束的轮，所以先把轮结束掉。 */
  async function finishedIteration(actorId: string, projectId: string) {
    const iteration = await activeIteration(actorId, projectId, []);
    await completeIteration(actorId, projectId, iteration.id, await completeInput(actorId, projectId, iteration.id));
    return (await getIterationDetail(actorId, projectId, iteration.id)).iteration;
  }

  it("首次填写不带版本即可创建", async () => {
    const { student, project } = await scene();
    const iteration = await finishedIteration(student.id, project.id);

    const { retrospective } = await saveIterationRetrospective(
      student.id,
      project.id,
      iteration.id,
      {
        requestId: rid(),
        wentWell: "沟通顺畅",
        problems: "估时偏乐观",
        nextActions: "下轮先拆细任务",
      },
    );
    expect(retrospective.revision).toBe(1);
    expect(retrospective.authorId).toBe(student.id);
    expect(retrospective.wentWell).toBe("沟通顺畅");
    expect((await getIterationRetrospective(student.id, project.id, iteration.id))?.id).toBe(
      retrospective.id,
    );
  });

  it("改已有的必须带对版本，且 revision 自增", async () => {
    const { student, project } = await scene();
    const iteration = await finishedIteration(student.id, project.id);
    const first = await saveIterationRetrospective(student.id, project.id, iteration.id, {
      requestId: rid(),
      wentWell: "初版",
    });

    const second = await saveIterationRetrospective(student.id, project.id, iteration.id, {
      requestId: rid(),
      expectedRevision: first.retrospective.revision,
      problems: "补一段",
    });
    expect(second.retrospective.revision).toBe(2);
    // 没传的字段保持原值，不会被清空
    expect(second.retrospective.wentWell).toBe("初版");
    expect(second.retrospective.problems).toBe("补一段");
  });

  it("陈旧 expectedRevision 返回冲突且不改数据", async () => {
    const { student, project } = await scene();
    const iteration = await finishedIteration(student.id, project.id);
    await saveIterationRetrospective(student.id, project.id, iteration.id, {
      requestId: rid(),
      wentWell: "初版",
    });

    await expect(
      saveIterationRetrospective(student.id, project.id, iteration.id, {
        requestId: rid(),
        expectedRevision: 99,
        wentWell: "抢改",
      }),
    ).rejects.toThrow("已被他人修改");

    expect((await getIterationRetrospective(student.id, project.id, iteration.id))?.wentWell).toBe(
      "初版",
    );
  });

  it("一轮迭代只有一份复盘：改了两次仍只有一个 id", async () => {
    const { student, project } = await scene();
    const iteration = await finishedIteration(student.id, project.id);
    const a = await saveIterationRetrospective(student.id, project.id, iteration.id, {
      requestId: rid(),
      wentWell: "A",
    });
    const b = await saveIterationRetrospective(student.id, project.id, iteration.id, {
      requestId: rid(),
      expectedRevision: a.retrospective.revision,
      wentWell: "B",
    });
    expect(b.retrospective.id).toBe(a.retrospective.id);
  });

  it("进行中的迭代不能写复盘", async () => {
    const { student, project } = await scene();
    const iteration = await activeIteration(student.id, project.id, []);
    await expect(
      saveIterationRetrospective(student.id, project.id, iteration.id, {
        requestId: rid(),
        wentWell: "还没结束就写",
      }),
    ).rejects.toThrow("只能为已结束的迭代写复盘");
  });

  it("没写复盘时返回 null（不等于迭代没结束）", async () => {
    const { student, project } = await scene();
    const iteration = await finishedIteration(student.id, project.id);
    expect(await getIterationRetrospective(student.id, project.id, iteration.id)).toBeNull();
  });

  it("teacher 不能写复盘", async () => {
    const { student, teacher, project } = await scene();
    const iteration = await finishedIteration(student.id, project.id);
    await expect(
      saveIterationRetrospective(teacher.id, project.id, iteration.id, {
        requestId: rid(),
        wentWell: "越权",
      }),
    ).rejects.toThrow("没有权限");
  });
});

describe("迭代流水", () => {
  beforeEach(resetDb);

  it("创建 / 开始 / 入轮 / 结束 都留下事件，按发生顺序", async () => {
    const { student, project } = await scene();
    const task = await createTask(student.id, project.id, { title: "写调研报告" });
    const iteration = await createIteration(student.id, project.id, {
      requestId: rid(),
      name: "第一轮",
      startDate: "2026-10-01",
      endDate: "2026-10-14",
    });
    const started = await startIteration(student.id, project.id, iteration.id, {
      requestId: rid(),
      expectedRevision: iteration.revision,
    });
    const fresh = await freshTask(student.id, task.id);
    await assignTasks(student.id, project.id, iteration.id, {
      requestId: rid(),
      expectedRevision: started.revision,
      tasks: [{ taskId: task.id, expectedUpdatedAt: fresh.updatedAt.toISOString() }],
    });
    await completeIteration(
      student.id,
      project.id,
      iteration.id,
      await completeInput(student.id, project.id, iteration.id),
    );

    const detail = await getIterationDetail(student.id, project.id, iteration.id);
    expect(detail.history.map((h) => h.type)).toEqual([
      "created",
      "started",
      "tasks_assigned",
      "completed",
    ]);
    expect(detail.history.every((h) => h.actorId === student.id)).toBe(true);
    // 时间正序：每个都不早于前一个
    for (let i = 1; i < detail.history.length; i++) {
      expect(detail.history[i].at >= detail.history[i - 1].at).toBe(true);
    }
  });

  it("新建的迭代只有 created 一条（不编造事件）", async () => {
    const { student, project } = await scene();
    const iteration = await createIteration(student.id, project.id, {
      requestId: rid(),
      name: "第一轮",
      startDate: "2026-10-01",
      endDate: "2026-10-14",
    });
    const detail = await getIterationDetail(student.id, project.id, iteration.id);
    expect(detail.history.map((h) => h.type)).toEqual(["created"]);
  });
});

describe("deletePlannedIteration", () => {
  beforeEach(resetDb);

  it("删轮不删任务：关联任务退回任务池", async () => {
    const { student, project } = await scene();
    const task = await createTask(student.id, project.id, { title: "待安排" });
    const iteration = await createIteration(student.id, project.id, {
      requestId: rid(),
      name: "还没开始",
      startDate: "2026-10-15",
      endDate: "2026-10-28",
    });
    const fresh = await freshTask(student.id, task.id);
    await assignTasks(student.id, project.id, iteration.id, {
      requestId: rid(),
      expectedRevision: iteration.revision,
      tasks: [{ taskId: task.id, expectedUpdatedAt: fresh.updatedAt.toISOString() }],
    });

    const result = await deletePlannedIteration(student.id, project.id, iteration.id, {
      requestId: rid(),
      expectedRevision: iteration.revision + 1,
    });
    expect(result).toEqual({ deleted: true, iterationId: iteration.id });

    expect((await freshTask(student.id, task.id)).sprintId).toBeNull();
    await expect(getIterationDetail(student.id, project.id, iteration.id)).rejects.toThrow(
      "迭代不存在",
    );
  });

  it("已开始的迭代不能删", async () => {
    const { student, project } = await scene();
    const iteration = await activeIteration(student.id, project.id, []);
    await expect(
      deletePlannedIteration(student.id, project.id, iteration.id, {
        requestId: rid(),
        expectedRevision: iteration.revision,
      }),
    ).rejects.toThrow("只有未开始的迭代才能删除");
  });

  it("teacher 不能删", async () => {
    const { student, teacher, project } = await scene();
    const iteration = await createIteration(student.id, project.id, {
      requestId: rid(),
      name: "还没开始",
      startDate: "2026-10-15",
      endDate: "2026-10-28",
    });
    await expect(
      deletePlannedIteration(teacher.id, project.id, iteration.id, {
        requestId: rid(),
        expectedRevision: iteration.revision,
      }),
    ).rejects.toThrow("没有权限");
  });
});

describe("listMyActiveIterations", () => {
  beforeEach(resetDb);

  it("只返回本人仍在成员的项目里的 active 轮，带项目名与主任务统计", async () => {
    const { student, project } = await scene();
    const done = await createTask(student.id, project.id, { title: "完成" });
    const doing = await createTask(student.id, project.id, { title: "在做" });
    const iteration = await activeIteration(student.id, project.id, [done.id, doing.id]);
    await updateTask(student.id, done.id, { status: "done" });
    // 计划中的轮不算
    await createIteration(student.id, project.id, {
      requestId: rid(),
      name: "第二轮",
      startDate: "2026-10-15",
      endDate: "2026-10-28",
    });

    const page = await listMyActiveIterations(student.id);
    expect(page.total).toBe(1);
    const [item] = page.items;
    expect(item.id).toBe(iteration.id);
    expect(item.projectName).toBe("赤壁演习");
    expect(item.scope).toBe("main-tasks");
    expect(item.taskTotal).toBe(2);
    expect(item.doneCount).toBe(1);
    expect(item.doneRatio).toBe(0.5);
    expect(item.sourceHref).toBe(`/projects/${project.id}/iterations/${iteration.id}`);
  });

  it("不相关的人看不到别人项目的活跃轮", async () => {
    const { student, project } = await scene();
    await activeIteration(student.id, project.id, []);
    const outsider = await makeUser("outsider@example.com");
    await createTeam(outsider.id, "蜀汉营");

    const page = await listMyActiveIterations(outsider.id);
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
  });

  it("退组之后不再出现在工作台", async () => {
    const { student, project, team } = await scene();
    await activeIteration(student.id, project.id, []);
    expect((await listMyActiveIterations(student.id)).total).toBe(1);

    // 目前没有「退出团队」的公开服务，测试直接改成员表来模拟退组
    await db
      .delete(teamMembers)
      .where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, student.id)));

    expect((await listMyActiveIterations(student.id)).total).toBe(0);
  });

  it("已归档项目里的活跃轮不再出现", async () => {
    const { owner, student, project } = await scene();
    await activeIteration(student.id, project.id, []);
    // 归档只有 admin 能做
    await updateProject(owner.id, project.id, { status: "archived" });
    expect((await listMyActiveIterations(student.id)).total).toBe(0);
  });
});

describe("createIterationWithTasks", () => {
  beforeEach(resetDb);

  it("一次建迭代并挂任务，任务拿到 iterationId", async () => {
    const { student, project } = await scene();
    const a = await createTask(student.id, project.id, { title: "甲" });
    const b = await createTask(student.id, project.id, { title: "乙" });

    const { iteration, assignedTaskIds } = await createIterationWithTasks(student.id, project.id, {
      requestId: rid(),
      name: "草案确认",
      startDate: "2026-10-01",
      endDate: "2026-10-14",
      taskIds: [a.id, b.id],
    });
    expect(assignedTaskIds.sort()).toEqual([a.id, b.id].sort());

    const detail = await getIterationDetail(student.id, project.id, iteration.id);
    expect(detail.tasks.map((t) => t.id).sort()).toEqual([a.id, b.id].sort());
    expect(detail.tasks.every((t) => t.iterationId === iteration.id)).toBe(true);
    expect(detail.history.map((h) => h.type)).toEqual(["created", "tasks_assigned"]);
  });

  it("重复的 taskId 只挂一次", async () => {
    const { student, project } = await scene();
    const a = await createTask(student.id, project.id, { title: "甲" });
    const { assignedTaskIds } = await createIterationWithTasks(student.id, project.id, {
      requestId: rid(),
      name: "草案确认",
      startDate: "2026-10-01",
      endDate: "2026-10-14",
      taskIds: [a.id, a.id],
    });
    expect(assignedTaskIds).toEqual([a.id]);
  });

  it("草案里的任务已被排到别处时整体拒绝，不偷偷少挂", async () => {
    const { student, project } = await scene();
    const mine = await createTask(student.id, project.id, { title: "甲" });
    const taken = await createTask(student.id, project.id, { title: "乙" });
    await activeIteration(student.id, project.id, [taken.id]);

    await expect(
      createIterationWithTasks(student.id, project.id, {
        requestId: rid(),
        name: "草案确认",
        startDate: "2026-10-01",
        endDate: "2026-10-14",
        taskIds: [mine.id, taken.id],
      }),
    ).rejects.toThrow("已被排入别的迭代");
  });

  it("草案里的任务已完成时拒绝", async () => {
    const { student, project } = await scene();
    const done = await createTask(student.id, project.id, { title: "甲" });
    await updateTask(student.id, done.id, { status: "done" });

    await expect(
      createIterationWithTasks(student.id, project.id, {
        requestId: rid(),
        name: "草案确认",
        startDate: "2026-10-01",
        endDate: "2026-10-14",
        taskIds: [done.id],
      }),
    ).rejects.toThrow("已完成");
  });

  it("taskIds 为空时只建迭代，不写 tasks_assigned", async () => {
    const { student, project } = await scene();
    const { iteration, assignedTaskIds } = await createIterationWithTasks(student.id, project.id, {
      requestId: rid(),
      name: "空草案",
      startDate: "2026-10-01",
      endDate: "2026-10-14",
      taskIds: [],
    });
    expect(assignedTaskIds).toEqual([]);
    const detail = await getIterationDetail(student.id, project.id, iteration.id);
    expect(detail.history.map((h) => h.type)).toEqual(["created"]);
  });

  it("同 requestId 重放不建第二轮", async () => {
    const { student, project } = await scene();
    const input = {
      requestId: rid(),
      name: "草案确认",
      startDate: "2026-10-01",
      endDate: "2026-10-14",
      taskIds: [],
    };
    const first = await createIterationWithTasks(student.id, project.id, input);
    const replay = await createIterationWithTasks(student.id, project.id, input);
    expect(replay.iteration.id).toBe(first.iteration.id);
  });
});
