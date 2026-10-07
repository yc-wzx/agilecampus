import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createSubtask, createTask, setTaskSuccessors, updateTask } from "@/lib/task";
import { getTaskPanelData, getSubtaskProgress, listBacklog } from "@/lib/task-contract";
import { assignTasks, createIteration } from "@/lib/iteration";
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

describe("listBacklog", () => {
  beforeEach(resetDb);

  it("默认只给无迭代 + 未完成 + 仅主任务", async () => {
    const { student, project } = await scene();
    const plain = await createTask(student.id, project.id, { title: "池里的" });
    const done = await createTask(student.id, project.id, { title: "已完成" });
    await updateTask(student.id, done.id, { status: "done" });
    const parent = await createTask(student.id, project.id, { title: "有子任务的" });
    const child = await createSubtask(student.id, parent.id, { title: "子任务" });

    const it0 = await createIteration(student.id, project.id, {
      requestId: randomUUID(),
      name: "第一轮",
      startDate: "2026-10-01",
      endDate: "2026-10-14",
    });
    const inIter = await createTask(student.id, project.id, { title: "轮里的" });
    await assignTasks(student.id, project.id, it0.id, {
      requestId: randomUUID(),
      expectedRevision: it0.revision,
      tasks: [{ taskId: inIter.id, expectedUpdatedAt: inIter.updatedAt.toISOString() }],
    });

    const page = await listBacklog(student.id, project.id);
    const ids = page.items.map((t) => t.id);
    expect(ids).toContain(plain.id);
    expect(ids).toContain(parent.id);
    expect(ids).not.toContain(done.id);
    expect(ids).not.toContain(child.id);
    expect(ids).not.toContain(inIter.id);
    expect(page.total).toBe(2);
    expect(page.nextOffset).toBeNull();
  });

  it("按 sortOrder 升序，补 id 兜底保证稳定", async () => {
    const { student, project } = await scene();
    const a = await createTask(student.id, project.id, { title: "甲" });
    const b = await createTask(student.id, project.id, { title: "乙" });
    const first = await listBacklog(student.id, project.id);
    const second = await listBacklog(student.id, project.id);
    expect(first.items.map((t) => t.id)).toEqual(second.items.map((t) => t.id));
    expect(first.items.map((t) => t.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("分页 limit 夹到合法区间，nextOffset 按已取条数推进", async () => {
    const { student, project } = await scene();
    for (let i = 0; i < 3; i += 1) {
      await createTask(student.id, project.id, { title: `任务${i}` });
    }
    const firstPage = await listBacklog(student.id, project.id, { limit: 2 });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.total).toBe(3);
    expect(firstPage.nextOffset).toBe(2);

    const secondPage = await listBacklog(student.id, project.id, {
      limit: 2,
      offset: firstPage.nextOffset!,
    });
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.nextOffset).toBeNull();
    expect(secondPage.items[0].id).not.toBe(firstPage.items[0].id);
  });

  it("按负责人筛选", async () => {
    const { student, owner, project } = await scene();
    await createTask(student.id, project.id, { title: "我的", assigneeId: student.id });
    await createTask(student.id, project.id, { title: "他的", assigneeId: owner.id });
    const mine = await listBacklog(student.id, project.id, { assigneeId: student.id });
    expect(mine.total).toBe(1);
    expect(mine.items[0].title).toBe("我的");
  });

  it("无关团队读不到（拿不到项目就报错）", async () => {
    const { outsider, project } = await scene();
    await expect(listBacklog(outsider.id, project.id)).rejects.toThrow("没有权限");
  });

  it("teacher 可读任务池（只读角色不影响读）", async () => {
    const { student, teacher, project } = await scene();
    await createTask(student.id, project.id, { title: "看得见" });
    const page = await listBacklog(teacher.id, project.id);
    expect(page.total).toBe(1);
  });
});

describe("getTaskPanelData", () => {
  beforeEach(resetDb);

  it("返回 DTO：sprint_id 映射为 iterationId，updatedAt 为 ISO 串", async () => {
    const { student, project } = await scene();
    const task = await createTask(student.id, project.id, {
      title: "写调研报告",
      acceptanceCriteria: "至少 3000 字",
    });

    const panel = await getTaskPanelData(student.id, project.id, task.id);
    expect(panel.task.id).toBe(task.id);
    expect(panel.task.projectId).toBe(project.id);
    expect(panel.task.iterationId).toBeNull();
    expect(panel.task.acceptanceCriteria).toBe("至少 3000 字");
    // 不得出现 DB 内部列名
    expect(panel.task as unknown as Record<string, unknown>).not.toHaveProperty("sprintId");
    // P1 才落库的列，P0 如实返回字面量
    expect(panel.task.isBlocked).toBe(false);
    expect(panel.task.blockedReason).toBeNull();
    expect(panel.task.blockedAt).toBeNull();
    expect(panel.task.updatedAt).toBe(task.updatedAt.toISOString());
    expect(panel.task.sourceHref).toBe(`/projects/${project.id}?task=${task.id}`);
  });

  it("updatedAt 的 ISO 串可原样回传比对（乐观锁的前提）", async () => {
    const { student, project } = await scene();
    const task = await createTask(student.id, project.id, { title: "写调研报告" });
    const panel = await getTaskPanelData(student.id, project.id, task.id);

    const echoed = new Date(panel.task.updatedAt);
    expect(echoed.getTime()).toBe(task.updatedAt.getTime());

    // 回传后改一次，版本就该对不上了
    await updateTask(student.id, task.id, { title: "改过的标题" });
    const again = await getTaskPanelData(student.id, project.id, task.id);
    expect(new Date(again.task.updatedAt).getTime()).not.toBe(echoed.getTime());
  });

  it("入轮后 iterationId 指向该轮", async () => {
    const { student, project } = await scene();
    const it0 = await createIteration(student.id, project.id, {
      requestId: randomUUID(),
      name: "第一轮",
      startDate: "2026-10-01",
      endDate: "2026-10-14",
    });
    const task = await createTask(student.id, project.id, { title: "写调研报告" });
    const assigned = await assignTasks(student.id, project.id, it0.id, {
      requestId: randomUUID(),
      expectedRevision: it0.revision,
      tasks: [{ taskId: task.id, expectedUpdatedAt: task.updatedAt.toISOString() }],
    });
    expect(assigned.taskIds).toEqual([task.id]);

    const panel = await getTaskPanelData(student.id, project.id, task.id);
    expect(panel.task.iterationId).toBe(it0.id);
  });

  it("带上该任务的依赖（出边与入边都要）", async () => {
    const { student, project } = await scene();
    const before = await createTask(student.id, project.id, { title: "前置" });
    const middle = await createTask(student.id, project.id, { title: "中间" });
    const after = await createTask(student.id, project.id, { title: "后置" });
    await setTaskSuccessors(student.id, before.id, [middle.id]);
    await setTaskSuccessors(student.id, middle.id, [after.id]);

    const panel = await getTaskPanelData(student.id, project.id, middle.id);
    expect(panel.dependencies).toHaveLength(2);
    expect(panel.dependencies).toEqual(
      expect.arrayContaining([
        { predecessorId: before.id, successorId: middle.id },
        { predecessorId: middle.id, successorId: after.id },
      ]),
    );
  });

  it("allowedActions 随角色变化，teacher 无写入口", async () => {
    const { student, teacher, project } = await scene();
    const task = await createTask(student.id, project.id, { title: "写调研报告" });

    const asStudent = await getTaskPanelData(student.id, project.id, task.id);
    expect(asStudent.allowedActions).toEqual({ edit: true, delete: true, comment: false });

    const asTeacher = await getTaskPanelData(teacher.id, project.id, task.id);
    expect(asTeacher.allowedActions).toEqual({ edit: false, delete: false, comment: false });
  });

  it("拿别的项目 id 拼本项目 taskId 取不到", async () => {
    const { owner, student, team, project } = await scene();
    const other = await createProject(owner.id, team.id, { name: "另一项目" });
    const task = await createTask(student.id, project.id, { title: "写调研报告" });
    await expect(getTaskPanelData(student.id, other.id, task.id)).rejects.toThrow("任务不存在");
  });

  it("不存在的任务报「任务不存在」", async () => {
    const { student, project } = await scene();
    await expect(
      getTaskPanelData(student.id, project.id, randomUUID()),
    ).rejects.toThrow("任务不存在");
  });

  it("无关团队读不到", async () => {
    const { student, outsider, project } = await scene();
    const task = await createTask(student.id, project.id, { title: "写调研报告" });
    await expect(getTaskPanelData(outsider.id, project.id, task.id)).rejects.toThrow("没有权限");
  });
});

describe("getSubtaskProgress", () => {
  beforeEach(resetDb);

  it("无子任务时 ratio 为 null（不是 0）", async () => {
    const { student, project } = await scene();
    const parent = await createTask(student.id, project.id, { title: "父" });
    const [progress] = await getSubtaskProgress(student.id, project.id, [parent.id]);
    expect(progress.parentTaskId).toBe(parent.id);
    expect(progress.total).toBe(0);
    expect(progress.doneCount).toBe(0);
    expect(progress.ratio).toBeNull();
  });

  it("只数直接子级，不递归", async () => {
    const { student, project } = await scene();
    const parent = await createTask(student.id, project.id, { title: "父" });
    const c1 = await createSubtask(student.id, parent.id, { title: "子1" });
    await createSubtask(student.id, parent.id, { title: "子2" });
    await createSubtask(student.id, c1.id, { title: "孙" });
    await updateTask(student.id, c1.id, { status: "done" });

    const [progress] = await getSubtaskProgress(student.id, project.id, [parent.id]);
    expect(progress.total).toBe(2);
    expect(progress.doneCount).toBe(1);
    expect(progress.ratio).toBe(0.5);
  });

  it("批量：每个请求到的父任务都有一条，没子任务的 ratio 为 null", async () => {
    const { student, project } = await scene();
    const withChild = await createTask(student.id, project.id, { title: "有子任务" });
    const bare = await createTask(student.id, project.id, { title: "没子任务" });
    await createSubtask(student.id, withChild.id, { title: "子" });

    const list = await getSubtaskProgress(student.id, project.id, [withChild.id, bare.id]);
    expect(list.map((p) => p.parentTaskId)).toEqual([withChild.id, bare.id]);
    expect(list[0].total).toBe(1);
    expect(list[1].ratio).toBeNull();
  });

  it("重复的父任务只回一条；混进别的项目的任务整体拒绝", async () => {
    const { owner, student, team, project } = await scene();
    const parent = await createTask(student.id, project.id, { title: "父" });
    const deduped = await getSubtaskProgress(student.id, project.id, [parent.id, parent.id]);
    expect(deduped).toHaveLength(1);

    const other = await createProject(owner.id, team.id, { name: "别处" });
    const foreign = await createTask(owner.id, other.id, { title: "外项目的任务" });
    await expect(
      getSubtaskProgress(student.id, project.id, [foreign.id]),
    ).rejects.toThrow("任务不存在");
  });

  it("一次超过上限就拒绝", async () => {
    const { student, project } = await scene();
    const ids = Array.from({ length: 101 }, () => randomUUID());
    await expect(getSubtaskProgress(student.id, project.id, ids)).rejects.toThrow("最多");
  });
});
