import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask, listProjectTasks, updateTask } from "@/lib/task";
import {
  createTaskV1,
  deleteTaskV1,
  getTaskPanelData,
  listBacklog,
  updateTaskV1,
} from "@/lib/task-contract";
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
  const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
  return { owner, team, student, teacher, outsider, project };
}

const rid = () => randomUUID();

describe("createTaskV1", () => {
  beforeEach(resetDb);

  it("建任务返回 TaskSummary，字段口径与定稿一致", async () => {
    const { student, project } = await scene();
    const res = await createTaskV1(student.id, project.id, {
      requestId: rid(),
      title: "写调研报告",
      acceptanceCriteria: "至少 3000 字",
      assigneeId: student.id,
      priority: "high",
    });
    expect(res.task.title).toBe("写调研报告");
    expect(res.task.acceptanceCriteria).toBe("至少 3000 字");
    expect(res.task.priority).toBe("high");
    expect(res.task.assigneeName).toBe("student");
    expect(res.task.iterationId).toBeNull();
    expect(res.task.status).toBe("todo");
    expect(res.task.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("同 requestId 同内容重放返回首次结果，不会建出第二条", async () => {
    const { student, project } = await scene();
    const input = { requestId: rid(), title: "写调研报告" };
    const first = await createTaskV1(student.id, project.id, input);
    const replay = await createTaskV1(student.id, project.id, input);

    expect(replay.task.id).toBe(first.task.id);
    expect(replay.task.updatedAt).toBe(first.task.updatedAt);

    const page = await listBacklog(student.id, project.id);
    expect(page.total).toBe(1);
  });

  it("同 requestId 不同内容返回冲突，且不新建", async () => {
    const { student, project } = await scene();
    const requestId = rid();
    await createTaskV1(student.id, project.id, { requestId, title: "原标题" });
    await expect(
      createTaskV1(student.id, project.id, { requestId, title: "换了标题" }),
    ).rejects.toThrow("同一请求标识");

    const page = await listBacklog(student.id, project.id);
    expect(page.total).toBe(1);
  });

  it("teacher 不能建任务", async () => {
    const { teacher, project } = await scene();
    await expect(
      createTaskV1(teacher.id, project.id, { requestId: rid(), title: "越权任务" }),
    ).rejects.toThrow("没有权限");
  });

  it("无关团队不能建任务", async () => {
    const { outsider, project } = await scene();
    await expect(
      createTaskV1(outsider.id, project.id, { requestId: rid(), title: "越权任务" }),
    ).rejects.toThrow("没有权限");
  });
});

describe("updateTaskV1", () => {
  beforeEach(resetDb);

  it("带对版本可以改，返回新的 updatedAt", async () => {
    const { student, project } = await scene();
    const { task } = await createTaskV1(student.id, project.id, {
      requestId: rid(),
      title: "写调研报告",
    });

    const res = await updateTaskV1(student.id, project.id, task.id, {
      requestId: rid(),
      expectedUpdatedAt: task.updatedAt,
      patch: { title: "写结题报告", acceptanceCriteria: "含数据附录" },
    });
    expect(res.task.title).toBe("写结题报告");
    expect(res.task.acceptanceCriteria).toBe("含数据附录");
    expect(new Date(res.task.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(task.updatedAt).getTime(),
    );
  });

  it("陈旧 expectedUpdatedAt 返回冲突且不改数据", async () => {
    const { student, project } = await scene();
    const { task } = await createTaskV1(student.id, project.id, {
      requestId: rid(),
      title: "写调研报告",
    });
    // 别人先改了一版
    await updateTaskV1(student.id, project.id, task.id, {
      requestId: rid(),
      expectedUpdatedAt: task.updatedAt,
      patch: { title: "别人改的" },
    });

    await expect(
      updateTaskV1(student.id, project.id, task.id, {
        requestId: rid(),
        expectedUpdatedAt: task.updatedAt,
        patch: { title: "我改的" },
      }),
    ).rejects.toThrow("已被他人修改");

    const panel = await getTaskPanelData(student.id, project.id, task.id);
    expect(panel.task.title).toBe("别人改的");
  });

  it("patch 里夹带 projectId 会被忽略，任务不会被挪到别的项目", async () => {
    const { owner, student, team, project } = await scene();
    const other = await createProject(owner.id, team.id, { name: "另一项目" });
    const { task } = await createTaskV1(student.id, project.id, {
      requestId: rid(),
      title: "写调研报告",
    });

    const res = await updateTaskV1(student.id, project.id, task.id, {
      requestId: rid(),
      expectedUpdatedAt: task.updatedAt,
      // 运行时宽对象：白名单构造必须把这些字段丢掉
      patch: { title: "改过的" } as never,
      ...({ projectId: other.id, sortOrder: 1, id: other.id } as object),
    } as never);

    expect(res.task.projectId).toBe(project.id);
    const stillHere = await listBacklog(student.id, project.id);
    expect(stillHere.items.map((t) => t.id)).toContain(task.id);
  });

  it("take 别的项目 taskId 改不动（归属不符）", async () => {
    const { owner, student, team, project } = await scene();
    const other = await createProject(owner.id, team.id, { name: "另一项目" });
    const { task: foreign } = await createTaskV1(owner.id, other.id, {
      requestId: rid(),
      title: "别人项目的任务",
    });

    await expect(
      updateTaskV1(student.id, project.id, foreign.id, {
        requestId: rid(),
        expectedUpdatedAt: foreign.updatedAt,
        patch: { title: "越权改名" },
      }),
    ).rejects.toThrow("任务不存在");

    const untouched = await getTaskPanelData(owner.id, other.id, foreign.id);
    expect(untouched.task.title).toBe("别人项目的任务");
  });

  it("teacher 改任务被拒", async () => {
    const { student, teacher, project } = await scene();
    const { task } = await createTaskV1(student.id, project.id, {
      requestId: rid(),
      title: "写调研报告",
    });
    await expect(
      updateTaskV1(teacher.id, project.id, task.id, {
        requestId: rid(),
        expectedUpdatedAt: task.updatedAt,
        patch: { acceptanceCriteria: "悄悄加一条" },
      }),
    ).rejects.toThrow("没有权限");
  });

  it("同 requestId 同内容重放返回首次结果", async () => {
    const { student, project } = await scene();
    const { task } = await createTaskV1(student.id, project.id, {
      requestId: rid(),
      title: "写调研报告",
    });
    const requestId = rid();
    const input = {
      requestId,
      expectedUpdatedAt: task.updatedAt,
      patch: { acceptanceCriteria: "含数据附录" },
    };
    const first = await updateTaskV1(student.id, project.id, task.id, input);
    // 重放时版本已经变了，但幂等账本应先命中、原样返回，不再去比版本
    const replay = await updateTaskV1(student.id, project.id, task.id, input);
    expect(replay.task.updatedAt).toBe(first.task.updatedAt);
    expect(replay.task.acceptanceCriteria).toBe("含数据附录");
  });
});

describe("deleteTaskV1", () => {
  beforeEach(resetDb);

  it("带对版本可以删，任务从任务池消失", async () => {
    const { student, project } = await scene();
    const { task } = await createTaskV1(student.id, project.id, {
      requestId: rid(),
      title: "写调研报告",
    });
    const res = await deleteTaskV1(student.id, project.id, task.id, {
      requestId: rid(),
      expectedUpdatedAt: task.updatedAt,
    });
    expect(res).toEqual({ taskId: task.id, deleted: true });

    const page = await listBacklog(student.id, project.id);
    expect(page.items.map((t) => t.id)).not.toContain(task.id);
  });

  it("陈旧 expectedUpdatedAt 返回冲突且不删", async () => {
    const { student, project } = await scene();
    const { task } = await createTaskV1(student.id, project.id, {
      requestId: rid(),
      title: "写调研报告",
    });
    await updateTaskV1(student.id, project.id, task.id, {
      requestId: rid(),
      expectedUpdatedAt: task.updatedAt,
      patch: { title: "改过的" },
    });

    await expect(
      deleteTaskV1(student.id, project.id, task.id, {
        requestId: rid(),
        expectedUpdatedAt: task.updatedAt,
      }),
    ).rejects.toThrow("已被他人修改");

    const page = await listBacklog(student.id, project.id);
    expect(page.items.map((t) => t.id)).toContain(task.id);
  });

  it("teacher 删任务被拒", async () => {
    const { student, teacher, project } = await scene();
    const { task } = await createTaskV1(student.id, project.id, {
      requestId: rid(),
      title: "写调研报告",
    });
    await expect(
      deleteTaskV1(teacher.id, project.id, task.id, {
        requestId: rid(),
        expectedUpdatedAt: task.updatedAt,
      }),
    ).rejects.toThrow("没有权限");
  });

  it("TaskSummary.updatedAt 可直接当作下次写入的 expectedUpdatedAt", async () => {
    const { student, project } = await scene();
    const created = await createTaskV1(student.id, project.id, {
      requestId: rid(),
      title: "写调研报告",
    });
    const res = await updateTaskV1(student.id, project.id, created.task.id, {
      requestId: rid(),
      expectedUpdatedAt: created.task.updatedAt,
      patch: { priority: "high" },
    });
    expect(res.task.priority).toBe("high");
  });
});

describe("旧入口不被破坏", () => {
  beforeEach(resetDb);

  it("lib 的 createTask/updateTask 不传新参数时行为不变", async () => {
    const { student, project } = await scene();
    const task = await createTask(student.id, project.id, { title: "旧调用方" });
    expect(task.acceptanceCriteria).toBeNull();
    expect(task.sprintId).toBeNull();

    const updated = await updateTask(student.id, task.id, { status: "doing" });
    expect(updated.status).toBe("doing");
    expect(updated.acceptanceCriteria).toBeNull();
  });

  it("listProjectTasks 仍按 sortOrder 返回，且带上新列", async () => {
    const { student, project } = await scene();
    const task = await createTask(student.id, project.id, {
      title: "旧调用方",
      acceptanceCriteria: "验收标准",
    });
    const rows = await listProjectTasks(student.id, project.id);
    const row = rows.find((t) => t.id === task.id);
    expect(row?.acceptanceCriteria).toBe("验收标准");
    expect(row?.sprintId).toBeNull();
  });
});

describe("重复请求权限回归", () => {
  beforeEach(resetDb);
  it("创建成功后降为教师，重放仍拒绝，不能取回旧结果", async () => {
    const { owner, student, team, project } = await scene();
    const input = { requestId: rid(), title: "私有项目任务" };
    await createTaskV1(student.id, project.id, input);
    await updateMemberRole(owner.id, team.id, student.id, "teacher");
    await expect(createTaskV1(student.id, project.id, input)).rejects.toThrow();
  });
});
