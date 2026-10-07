import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask, updateTask } from "@/lib/task";
import { getTaskPanelData, setTaskBlocked, updateTaskV1 } from "@/lib/task-contract";
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
const nowIso = () => new Date().toISOString();

/** 建一个任务并取回它的 TaskSummary（带 updatedAt，供乐观锁使用）。 */
async function makeTask(actorId: string, projectId: string, title = "写调研报告") {
  const created = await createTask(actorId, projectId, { title });
  const panel = await getTaskPanelData(actorId, projectId, created.id);
  return panel.task;
}

describe("setTaskBlocked", () => {
  beforeEach(resetDb);

  it("阻塞要填原因，三个字段一起写上", async () => {
    const { student, project } = await scene();
    const task = await makeTask(student.id, project.id);

    const res = await setTaskBlocked(student.id, project.id, task.id, {
      requestId: rid(),
      expectedUpdatedAt: task.updatedAt,
      isBlocked: true,
      blockedReason: "等第三方接口",
    });

    expect(res.task.isBlocked).toBe(true);
    expect(res.task.blockedReason).toBe("等第三方接口");
    expect(res.task.blockedAt).not.toBeNull();
    expect(new Date(res.task.blockedAt!).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("阻塞时原因为空串被拒，任务状态不变", async () => {
    const { student, project } = await scene();
    const task = await makeTask(student.id, project.id);

    await expect(
      setTaskBlocked(student.id, project.id, task.id, {
        requestId: rid(),
        expectedUpdatedAt: task.updatedAt,
        isBlocked: true,
        blockedReason: "   ",
      }),
    ).rejects.toThrow("请填写原因");

    const panel = await getTaskPanelData(student.id, project.id, task.id);
    expect(panel.task.isBlocked).toBe(false);
    expect(panel.task.blockedAt).toBeNull();
  });

  it("解除阻塞时清空原因与时间（不留半截状态）", async () => {
    const { student, project } = await scene();
    const task = await makeTask(student.id, project.id);
    const blocked = await setTaskBlocked(student.id, project.id, task.id, {
      requestId: rid(),
      expectedUpdatedAt: task.updatedAt,
      isBlocked: true,
      blockedReason: "等接口",
    });

    const released = await setTaskBlocked(student.id, project.id, task.id, {
      requestId: rid(),
      expectedUpdatedAt: blocked.task.updatedAt,
      isBlocked: false,
    });

    expect(released.task.isBlocked).toBe(false);
    expect(released.task.blockedReason).toBeNull();
    expect(released.task.blockedAt).toBeNull();
  });

  it("陈旧 expectedUpdatedAt 返回冲突且不改数据", async () => {
    const { student, project } = await scene();
    const task = await makeTask(student.id, project.id);

    await updateTaskV1(student.id, project.id, task.id, {
      requestId: rid(),
      expectedUpdatedAt: task.updatedAt,
      patch: { title: "别人改的" },
    });

    await expect(
      setTaskBlocked(student.id, project.id, task.id, {
        requestId: rid(),
        expectedUpdatedAt: task.updatedAt,
        isBlocked: true,
        blockedReason: "过期请求",
      }),
    ).rejects.toThrow("已被他人修改");

    const panel = await getTaskPanelData(student.id, project.id, task.id);
    expect(panel.task.isBlocked).toBe(false);
  });

  it("普通 updateTask 改不动这三个字段（白名单之外）", async () => {
    const { student, project } = await scene();
    const task = await makeTask(student.id, project.id);

    await updateTask(student.id, task.id, {
      title: "改名",
      // 运行时宽对象：白名单构造必须把它们丢掉
      ...({ isBlocked: true, blockedReason: "偷偷阻塞", blockedAt: nowIso() } as object),
    } as never);

    const panel = await getTaskPanelData(student.id, project.id, task.id);
    expect(panel.task.title).toBe("改名");
    expect(panel.task.isBlocked).toBe(false);
    expect(panel.task.blockedReason).toBeNull();
  });

  it("同 requestId 重放不重复写", async () => {
    const { student, project } = await scene();
    const task = await makeTask(student.id, project.id);
    const input = {
      requestId: rid(),
      expectedUpdatedAt: task.updatedAt,
      isBlocked: true,
      blockedReason: "等接口",
    };
    const first = await setTaskBlocked(student.id, project.id, task.id, input);
    const replay = await setTaskBlocked(student.id, project.id, task.id, input);
    expect(replay.task.blockedAt).toBe(first.task.blockedAt);
  });

  it("teacher 不能阻塞任务", async () => {
    const { student, teacher, project } = await scene();
    const task = await makeTask(student.id, project.id);
    await expect(
      setTaskBlocked(teacher.id, project.id, task.id, {
        requestId: rid(),
        expectedUpdatedAt: task.updatedAt,
        isBlocked: true,
        blockedReason: "越权",
      }),
    ).rejects.toThrow("没有权限");
  });

  it("拿别的项目 taskId 阻塞不动（归属不符）", async () => {
    const { owner, student, team, project } = await scene();
    const other = await createProject(owner.id, team.id, { name: "另一项目" });
    const foreign = await makeTask(owner.id, other.id, "别人项目的任务");

    await expect(
      setTaskBlocked(student.id, project.id, foreign.id, {
        requestId: rid(),
        expectedUpdatedAt: foreign.updatedAt,
        isBlocked: true,
        blockedReason: "越权",
      }),
    ).rejects.toThrow("任务不存在");
  });
});

describe("阻塞计时回归", () => {
  beforeEach(resetDb);
  it("编辑阻塞原因保留首次阻塞时间，解阻后再阻塞才重新计时", async () => {
    const { student, project } = await scene();
    const task = await createTask(student.id, project.id, { title: "阻塞任务" });
    const first = await setTaskBlocked(student.id, project.id, task.id, { requestId: rid(), expectedUpdatedAt: task.updatedAt.toISOString(), isBlocked: true, blockedReason: "等待接口" });
    const edited = await setTaskBlocked(student.id, project.id, task.id, { requestId: rid(), expectedUpdatedAt: first.task.updatedAt, isBlocked: true, blockedReason: "等待数据库接口" });
    expect(edited.task.blockedAt).toBe(first.task.blockedAt);
    const cleared = await setTaskBlocked(student.id, project.id, task.id, { requestId: rid(), expectedUpdatedAt: edited.task.updatedAt, isBlocked: false });
    expect(cleared.task.blockedAt).toBeNull();
  });
});
