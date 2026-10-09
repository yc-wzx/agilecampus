import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { projectActivities, tasks } from "@/db/schema";
import { listProjectActivities } from "@/lib/activity";
import {
  assignTasks,
  completeIteration,
  createIteration,
  previewIterationCompletion,
  saveIterationRetrospective,
  startIteration,
} from "@/lib/iteration";
import { createProject } from "@/lib/project";
import { createTask, updateTask } from "@/lib/task";
import { createTaskV1, setTaskBlocked, updateTaskV1 } from "@/lib/task-contract";
import { createTeam, joinTeam } from "@/lib/team";
import { createUser } from "@/lib/user";
import { resetDb } from "./helpers";

// E / P0：事件目录的接入点（定稿 §9.4）。断言的是「哪些业务操作留下了活动」，
// 不是「活动长什么样」——后者归 activity.test.ts。

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

async function scene() {
  const owner = await makeUser("owner@example.com");
  const team = await createTeam(owner.id, "东吴实验室");
  const student = await makeUser("student@example.com");
  await joinTeam(student.id, team.inviteCode);
  const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
  return { owner, team, student, project };
}

const rid = () => randomUUID();

async function activities(actorId: string, projectId: string) {
  return (await listProjectActivities(actorId, projectId, { limit: 100 })).items;
}

const typesOf = (items: { type: string }[]) => items.map((i) => i.type).sort();

/** 活动的 metadata 不在 DTO 里（定稿 §9.4 的形状），直接查表看落库内容。 */
async function storedMetadata(activityId: string) {
  const [row] = await db
    .select({ metadata: projectActivities.metadata })
    .from(projectActivities)
    .where(eq(projectActivities.id, activityId));
  return row?.metadata;
}

describe("任务写入产生的活动", () => {
  beforeEach(resetDb);

  it("createTaskV1 产生一条 task.created，occurredAt 取该行的 updatedAt", async () => {
    const { owner, project } = await scene();
    const { task } = await createTaskV1(owner.id, project.id, {
      requestId: rid(),
      title: "写调研报告",
    });

    const items = await activities(owner.id, project.id);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: "task.created",
      objectType: "task",
      objectId: task.id,
      actorId: owner.id,
    });
    expect(items[0].summary).toContain("写调研报告");
    expect(items[0].occurredAt).toBe(task.updatedAt);
  });

  it("todo -> done 记 task.completed，done -> doing 记 task.reopened", async () => {
    const { owner, project } = await scene();
    const { task } = await createTaskV1(owner.id, project.id, {
      requestId: rid(),
      title: "写调研报告",
    });

    const done = await updateTaskV1(owner.id, project.id, task.id, {
      requestId: rid(),
      expectedUpdatedAt: task.updatedAt,
      patch: { status: "done" },
    });
    let items = await activities(owner.id, project.id);
    expect(typesOf(items)).toEqual(["task.completed", "task.created"]);
    expect(items.find((i) => i.type === "task.completed")!.summary).toContain("完成");
    expect(await storedMetadata(items.find((i) => i.type === "task.completed")!.id)).toMatchObject({
      taskId: task.id,
      fromStatus: "todo",
    });

    const reopened = await updateTaskV1(owner.id, project.id, task.id, {
      requestId: rid(),
      expectedUpdatedAt: done.task.updatedAt,
      patch: { status: "doing" },
    });
    items = await activities(owner.id, project.id);
    expect(typesOf(items)).toEqual(["task.completed", "task.created", "task.reopened"]);
    expect(await storedMetadata(items.find((i) => i.type === "task.reopened")!.id)).toMatchObject({
      fromStatus: "done",
    });
    expect(reopened.task.status).toBe("doing");
  });

  it("todo <-> doing 没有专用事件类型，退回 task.updated，不硬说成「完成」", async () => {
    const { owner, project } = await scene();
    const { task } = await createTaskV1(owner.id, project.id, {
      requestId: rid(),
      title: "写调研报告",
    });

    await updateTaskV1(owner.id, project.id, task.id, {
      requestId: rid(),
      expectedUpdatedAt: task.updatedAt,
      patch: { status: "doing" },
    });

    const items = await activities(owner.id, project.id);
    expect(typesOf(items)).toEqual(["task.created", "task.updated"]);
    const updated = items.find((i) => i.type === "task.updated")!;
    expect(await storedMetadata(updated.id)).toMatchObject({
      changedFields: ["status"],
      fromStatus: "todo",
      toStatus: "doing",
    });
  });

  it("改派单独记 task.assigned，并把前后负责人一起留下", async () => {
    const { owner, student, project } = await scene();
    const { task } = await createTaskV1(owner.id, project.id, {
      requestId: rid(),
      title: "写调研报告",
    });

    await updateTaskV1(owner.id, project.id, task.id, {
      requestId: rid(),
      expectedUpdatedAt: task.updatedAt,
      patch: { assigneeId: student.id },
    });

    const assigned = (await activities(owner.id, project.id)).find(
      (i) => i.type === "task.assigned",
    )!;
    expect(assigned.summary).toContain("student");
    expect(await storedMetadata(assigned.id)).toMatchObject({
      fromAssigneeId: null,
      toAssigneeId: student.id,
    });
  });

  it("一次修改里的每个字段名都记下来，但只出一条 task.updated", async () => {
    const { owner, project } = await scene();
    const { task } = await createTaskV1(owner.id, project.id, {
      requestId: rid(),
      title: "写调研报告",
    });

    await updateTaskV1(owner.id, project.id, task.id, {
      requestId: rid(),
      expectedUpdatedAt: task.updatedAt,
      patch: { status: "doing", title: "写调研报告（修订）", dueDate: "2026-10-20" },
    });

    const items = await activities(owner.id, project.id);
    expect(typesOf(items)).toEqual(["task.created", "task.updated"]);
    expect(await storedMetadata(items.find((i) => i.type === "task.updated")!.id)).toMatchObject({
      changedFields: ["status", "title", "dueDate"],
    });
  });

  it("状态与负责人一起改，两条活动各出一条", async () => {
    const { owner, student, project } = await scene();
    const { task } = await createTaskV1(owner.id, project.id, {
      requestId: rid(),
      title: "写调研报告",
    });

    await updateTaskV1(owner.id, project.id, task.id, {
      requestId: rid(),
      expectedUpdatedAt: task.updatedAt,
      patch: { status: "done", assigneeId: student.id },
    });

    const items = await activities(owner.id, project.id);
    expect(typesOf(items)).toEqual(["task.assigned", "task.completed", "task.created"]);
  });

  it("只改描述这类正文时，活动里只有字段名，没有正文", async () => {
    const { owner, project } = await scene();
    const { task } = await createTaskV1(owner.id, project.id, {
      requestId: rid(),
      title: "写调研报告",
    });

    await updateTaskV1(owner.id, project.id, task.id, {
      requestId: rid(),
      expectedUpdatedAt: task.updatedAt,
      patch: { description: "机密草稿：结论是……" },
    });

    const updated = (await activities(owner.id, project.id)).find(
      (i) => i.type === "task.updated",
    )!;
    expect(updated.summary).not.toContain("机密草稿");
    const metadata = await storedMetadata(updated.id);
    expect(metadata).toMatchObject({ changedFields: ["description"] });
    expect(JSON.stringify(metadata)).not.toContain("机密草稿");
  });

  it("原地不动的 patch 不产生活动（没变就不该留痕）", async () => {
    const { owner, project } = await scene();
    const { task } = await createTaskV1(owner.id, project.id, {
      requestId: rid(),
      title: "写调研报告",
    });

    await updateTaskV1(owner.id, project.id, task.id, {
      requestId: rid(),
      expectedUpdatedAt: task.updatedAt,
      patch: { title: "写调研报告" },
    });

    expect(typesOf(await activities(owner.id, project.id))).toEqual(["task.created"]);
  });

  it("阻塞 / 解除阻塞各记一条，且原因原文不进活动", async () => {
    const { owner, project } = await scene();
    const { task } = await createTaskV1(owner.id, project.id, {
      requestId: rid(),
      title: "写调研报告",
    });

    const blocked = await setTaskBlocked(owner.id, project.id, task.id, {
      requestId: rid(),
      expectedUpdatedAt: task.updatedAt,
      isBlocked: true,
      blockedReason: "等第三方接口联调",
    });
    let items = await activities(owner.id, project.id);
    expect(typesOf(items)).toEqual(["task.blocked", "task.created"]);
    const blockedActivity = items.find((i) => i.type === "task.blocked")!;
    expect(blockedActivity.summary).not.toContain("第三方接口");
    expect(await storedMetadata(blockedActivity.id)).toMatchObject({
      taskId: task.id,
      blockedReasonLength: "等第三方接口联调".length,
    });

    await setTaskBlocked(owner.id, project.id, task.id, {
      requestId: rid(),
      expectedUpdatedAt: blocked.task.updatedAt,
      isBlocked: false,
    });
    items = await activities(owner.id, project.id);
    expect(typesOf(items)).toEqual(["task.blocked", "task.created", "task.unblocked"]);
  });

  it("只改阻塞原因不重复记阻塞，同值提交不产生活动，首次阻塞时间保留", async () => {
    const { owner, project } = await scene();
    const { task } = await createTaskV1(owner.id, project.id, { requestId: rid(), title: "阻塞状态回归" });
    const blocked = await setTaskBlocked(owner.id, project.id, task.id, {
      requestId: rid(), expectedUpdatedAt: task.updatedAt, isBlocked: true, blockedReason: "私有原因一",
    });
    const changed = await setTaskBlocked(owner.id, project.id, task.id, {
      requestId: rid(), expectedUpdatedAt: blocked.task.updatedAt, isBlocked: true, blockedReason: "私有原因二",
    });
    expect(changed.task.blockedAt).toBe(blocked.task.blockedAt);
    const unchanged = await setTaskBlocked(owner.id, project.id, task.id, {
      requestId: rid(), expectedUpdatedAt: changed.task.updatedAt, isBlocked: true, blockedReason: "私有原因二",
    });
    await setTaskBlocked(owner.id, project.id, task.id, {
      requestId: rid(), expectedUpdatedAt: unchanged.task.updatedAt, isBlocked: false,
    });
    const items = await activities(owner.id, project.id);
    expect(typesOf(items)).toEqual(["task.blocked", "task.created", "task.unblocked", "task.updated"]);
    const updated = items.find(item => item.type === "task.updated")!;
    expect(await storedMetadata(updated.id)).toMatchObject({ changedFields: ["blockedReason"] });
    expect(JSON.stringify(items)).not.toContain("私有原因");
  });

  it("同一 requestId 重放不会多出一条活动（幂等账本挡在前头）", async () => {
    const { owner, project } = await scene();
    const requestId = rid();
    const input = { requestId, title: "写调研报告" };

    const first = await createTaskV1(owner.id, project.id, input);
    const replay = await createTaskV1(owner.id, project.id, input);

    expect(replay.task.id).toBe(first.task.id);
    expect(typesOf(await activities(owner.id, project.id))).toEqual(["task.created"]);
  });
});

describe("迭代写入产生的活动", () => {
  beforeEach(resetDb);

  async function activeIteration(actorId: string, projectId: string) {
    const created = await createIteration(actorId, projectId, {
      requestId: rid(),
      name: "第一轮",
      goal: "完成用户调研",
      startDate: "2026-10-01",
      endDate: "2026-10-21",
    });
    return startIteration(actorId, projectId, created.id, {
      requestId: rid(),
      expectedRevision: created.revision,
    });
  }

  it("createIteration 本身不留痕，startIteration 才记 iteration.started", async () => {
    const { owner, project } = await scene();
    await createIteration(owner.id, project.id, {
      requestId: rid(),
      name: "第一轮",
      goal: "完成用户调研",
      startDate: "2026-10-01",
      endDate: "2026-10-21",
    });
    // 事件目录里没有 iteration.created——不硬造一个
    expect(await activities(owner.id, project.id)).toEqual([]);

    const started = await activeIteration(owner.id, project.id);
    const items = await activities(owner.id, project.id);
    expect(typesOf(items)).toEqual(["iteration.started"]);
    expect(items[0]).toMatchObject({
      objectType: "iteration",
      objectId: started.id,
      actorId: owner.id,
    });
    expect(items[0].occurredAt).toBe(started.startedAt);
  });

  it("completeIteration 记一条完成，带上当时的主任务统计与历史 id", async () => {
    const { owner, project } = await scene();
    const iteration = await activeIteration(owner.id, project.id);
    const { task } = await createTaskV1(owner.id, project.id, {
      requestId: rid(),
      title: "本轮唯一的主任务",
    });
    await assignTasks(owner.id, project.id, iteration.id, {
      requestId: rid(),
      expectedRevision: iteration.revision,
      tasks: [{ taskId: task.id, expectedUpdatedAt: task.updatedAt }],
    });
    const [assignedTask] = await db.select().from(tasks).where(eq(tasks.id, task.id));
    await updateTaskV1(owner.id, project.id, task.id, {
      requestId: rid(),
      expectedUpdatedAt: assignedTask.updatedAt.toISOString(),
      patch: { status: "done" },
    });

    const preview = await previewIterationCompletion(owner.id, project.id, iteration.id);
    const closed = await completeIteration(owner.id, project.id, iteration.id, {
      requestId: rid(),
      expectedRevision: preview.iterationRevision,
      taskVersions: preview.taskVersions,
      unfinishedDisposition: [],
    });

    const completed = (await activities(owner.id, project.id)).find(
      (i) => i.type === "iteration.completed",
    )!;
    expect(completed.objectId).toBe(iteration.id);
    expect(completed.occurredAt).toBe(closed.iteration.completedAt);
    expect(await storedMetadata(completed.id)).toMatchObject({
      iterationId: iteration.id,
      historyId: closed.historyId,
      taskTotal: 1,
      doneCount: 1,
      doneRatio: 1,
    });
  });

  it("复盘只记「谁保存了第几版」，正文一字不进活动表", async () => {
    const { owner, project } = await scene();
    const iteration = await activeIteration(owner.id, project.id);
    const preview = await previewIterationCompletion(owner.id, project.id, iteration.id);
    await completeIteration(owner.id, project.id, iteration.id, {
      requestId: rid(),
      expectedRevision: preview.iterationRevision,
      taskVersions: preview.taskVersions,
      unfinishedDisposition: [],
    });

    const saved = await saveIterationRetrospective(owner.id, project.id, iteration.id, {
      requestId: rid(),
      wentWell: "需求澄清比以前早",
      problems: "联调窗口太短",
      nextActions: "提前锁定接口",
    });

    const items = await activities(owner.id, project.id);
    expect(typesOf(items)).toEqual([
      "iteration.completed",
      "iteration.started",
      "retrospective.saved",
    ]);
    const retro = items.find((i) => i.type === "retrospective.saved")!;
    // 复盘挂在它描述的那轮迭代上——ActivityItem.objectType 没有 retrospective 这一档
    expect(retro.objectType).toBe("iteration");
    expect(retro.summary).not.toContain("联调窗口太短");
    const metadata = await storedMetadata(retro.id);
    expect(metadata).toMatchObject({
      iterationId: iteration.id,
      retrospectiveId: saved.id,
      revision: 1,
    });
    expect(JSON.stringify(metadata)).not.toContain("联调窗口");
  });
});

describe("旧任务入口的活动接入", () => {
  beforeEach(resetDb);

  it("旧 updateTask 同样记录创建和完成：覆盖看板拖拽 / Agent API / plan_sprint", async () => {
    const { owner, project } = await scene();
    const created = await createTask(owner.id, project.id, { title: "看板拖拽的任务" });
    await updateTask(owner.id, created.id, { status: "done" });

    expect(typesOf(await activities(owner.id, project.id))).toEqual(["task.completed", "task.created"]);
  });
});
