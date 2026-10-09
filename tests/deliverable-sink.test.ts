import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { deliverableOutbox, deliverables, projectActivities } from "@/db/schema";
import { listProjectActivities } from "@/lib/activity";
import { createDeliverableDraft, submitDeliverable } from "@/lib/deliverable";
import { dispatchDeliverableEvents, type DeliverableEvent } from "@/lib/deliverable-events";
import { handleDeliverableEvent, mapDeliverableEventToActivity } from "@/lib/deliverable-sink";
import { ValidationError } from "@/lib/errors";
import { createProject } from "@/lib/project";
import { createTeam, joinTeam } from "@/lib/team";
import { createUser } from "@/lib/user";
import { resetDb } from "./helpers";

// E / P0：成果 outbox 的消费端（定稿 §8 合并 sink 的 E 部分）。
// 重点是幂等：投递是 at-least-once，sink 成功但 deliveredAt 未落库时会重投，
// 重投绝不能写出第二条活动。

const rid = () => randomUUID();

function fakeEvent(overrides: Partial<DeliverableEvent> = {}): DeliverableEvent {
  return {
    id: randomUUID(),
    eventKey: "deliverable.submitted:v1",
    projectId: randomUUID(),
    actorId: randomUUID(),
    type: "deliverable.submitted",
    payload: { deliverableId: randomUUID(), versionId: randomUUID() },
    recipientIds: [],
    createdAt: new Date("2026-10-07T02:00:00.000Z"),
    deliveredAt: null,
    ...overrides,
  };
}

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

async function activities(actorId: string, projectId: string) {
  return (await listProjectActivities(actorId, projectId, { limit: 100 })).items;
}

/** 造一条真实的成果提交事件（走 D 的入口，不手工塞 outbox）。 */
async function submittedDeliverable(actorId: string, projectId: string, title: string) {
  const draft = await createDeliverableDraft(actorId, projectId, {
    title,
    type: "report",
    // 正式提交要求填链接，草稿才允许留空
    url: "https://example.com/report",
    description: "",
    milestoneId: null,
    requestId: rid(),
  });
  return submitDeliverable(actorId, projectId, draft.id, {
    requestId: rid(),
    expectedRevision: draft.revision,
  });
}

describe("mapDeliverableEventToActivity（纯函数）", () => {
  it("提交：指向成果本身，metadata 只有 payload 里那几个 ID", () => {
    const event = fakeEvent();
    const activity = mapDeliverableEventToActivity(event, { deliverableTitle: "调研报告" });

    expect(activity).toMatchObject({
      eventKey: event.eventKey,
      projectId: event.projectId,
      actorId: event.actorId,
      objectType: "deliverable",
      objectId: event.payload.deliverableId,
      type: "deliverable.submitted",
      occurredAt: "2026-10-07T02:00:00.000Z",
    });
    expect(activity.summary).toContain("调研报告");
    expect(activity.metadata).toEqual(event.payload);
  });

  it("名称查不到时摘要不编名字，也不留空的书名号", () => {
    const activity = mapDeliverableEventToActivity(fakeEvent());
    expect(activity.summary).toBe("提交了成果");
    expect(activity.summary).not.toContain("《》");
  });

  it("通过 / 退回各说各的话，decision 原样留在 metadata 里", () => {
    const event = fakeEvent({
      type: "deliverable.approved",
      eventKey: "deliverable.reviewed:fb1",
      payload: {
        deliverableId: randomUUID(),
        versionId: randomUUID(),
        feedbackId: randomUUID(),
        decision: "approved",
      },
    });

    expect(mapDeliverableEventToActivity(event, { deliverableTitle: "调研报告" }).summary).toBe(
      "通过了成果《调研报告》",
    );
    expect(
      mapDeliverableEventToActivity({ ...event, type: "deliverable.changes_requested" }).summary,
    ).toBe("退回了成果");
  });

  it("里程碑反馈挂在 feedback 上，反馈转任务挂在 task 上", () => {
    const feedbackId = randomUUID();
    const milestoneFeedback = mapDeliverableEventToActivity(
      fakeEvent({
        type: "milestone.feedback",
        eventKey: `milestone.feedback:${feedbackId}`,
        payload: { milestoneId: randomUUID(), feedbackId },
      }),
      { milestoneTitle: "中期答辩" },
    );
    expect(milestoneFeedback).toMatchObject({ objectType: "feedback", objectId: feedbackId });
    expect(milestoneFeedback.summary).toBe("给里程碑《中期答辩》留下了反馈");

    const taskId = randomUUID();
    const taskCreated = mapDeliverableEventToActivity(
      fakeEvent({
        type: "feedback.task_created",
        eventKey: `feedback.task_created:${feedbackId}`,
        payload: { feedbackId, taskId },
      }),
    );
    expect(taskCreated).toMatchObject({ objectType: "task", objectId: taskId });
  });

  it("没登记的 event type 直接报错——宁可卡住等人处理，也不静默丢掉", () => {
    expect(() =>
      mapDeliverableEventToActivity(fakeEvent({ type: "deliverable.deleted" })),
    ).toThrow(ValidationError);
  });

  it("payload 缺键时报错，不写一条内容残缺的活动", () => {
    expect(() =>
      mapDeliverableEventToActivity(fakeEvent({ payload: { deliverableId: randomUUID() } })),
    ).toThrow("缺少 payload.versionId");
  });
});

describe("handleDeliverableEvent", () => {
  beforeEach(resetDb);

  it("投递一次：写出活动，并把 outbox 标记为已投递", async () => {
    const { owner, project } = await scene();
    await submittedDeliverable(owner.id, project.id, "调研报告");

    const result = await dispatchDeliverableEvents(handleDeliverableEvent);

    expect(result).toEqual({ delivered: 1, failed: 0 });
    const items = await activities(owner.id, project.id);
    expect(items).toHaveLength(1);
    // 摘要用的是成果标题，能直接看懂是哪一份
    expect(items[0]).toMatchObject({ type: "deliverable.submitted", objectType: "deliverable" });
    expect(items[0].summary).toContain("调研报告");

    const rows = await db.select({ deliveredAt: deliverableOutbox.deliveredAt }).from(deliverableOutbox);
    expect(rows).toHaveLength(1);
    expect(rows[0].deliveredAt).not.toBeNull();
  });

  it("事件重投不会写出第二条活动（outbox 的 eventKey 直接当活动事件键）", async () => {
    const { owner, project } = await scene();
    await submittedDeliverable(owner.id, project.id, "调研报告");
    await dispatchDeliverableEvents(handleDeliverableEvent);

    // 模拟「sink 成功、deliveredAt 还没来得及落库就崩了」：把标记抹掉再投一次
    await db.update(deliverableOutbox).set({ deliveredAt: null });
    const replay = await dispatchDeliverableEvents(handleDeliverableEvent);

    expect(replay).toEqual({ delivered: 1, failed: 0 });
    expect(await activities(owner.id, project.id)).toHaveLength(1);
  });

  it("已经没有待投递事件时是空转，不是失败", async () => {
    const { owner, project } = await scene();
    await submittedDeliverable(owner.id, project.id, "调研报告");
    await dispatchDeliverableEvents(handleDeliverableEvent);

    expect(await dispatchDeliverableEvents(handleDeliverableEvent)).toEqual({
      delivered: 0,
      failed: 0,
    });
  });

  it("sink 抛异常时不标记已投递，事件留着下次重投", async () => {
    const { owner, project } = await scene();
    await submittedDeliverable(owner.id, project.id, "调研报告");

    const failedRun = await dispatchDeliverableEvents(async () => {
      throw new Error("下游暂时不可用");
    });
    expect(failedRun).toEqual({ delivered: 0, failed: 1 });
    expect(await activities(owner.id, project.id)).toEqual([]);

    const rows = await db.select({ deliveredAt: deliverableOutbox.deliveredAt }).from(deliverableOutbox);
    expect(rows[0].deliveredAt).toBeNull();

    // 重投：这次真的投出去了，而且只投出去一次
    expect(await dispatchDeliverableEvents(handleDeliverableEvent)).toEqual({
      delivered: 1,
      failed: 0,
    });
    expect(await activities(owner.id, project.id)).toHaveLength(1);
  });

  it("活动里只留 ID：成果描述这类正文不进活动表", async () => {
    const { owner, project } = await scene();
    const draft = await createDeliverableDraft(owner.id, project.id, {
      title: "调研报告",
      type: "report",
      url: "https://example.com/report",
      description: "内部草稿：访谈结果指向……",
      milestoneId: null,
      requestId: rid(),
    });
    await submitDeliverable(owner.id, project.id, draft.id, {
      requestId: rid(),
      expectedRevision: draft.revision,
    });
    await dispatchDeliverableEvents(handleDeliverableEvent);

    const [row] = await db
      .select({ metadata: projectActivities.metadata, summary: projectActivities.summary })
      .from(projectActivities);
    expect(JSON.stringify(row)).not.toContain("访谈结果");
    expect(row.metadata).toMatchObject({ versionId: expect.any(String) });
  });

  it("成果被删除后再投递，摘要退化成不带名称的说法而不是报错", async () => {
    const { owner, project } = await scene();
    await submittedDeliverable(owner.id, project.id, "调研报告");
    const [event] = await db.select().from(deliverableOutbox);
    // 直接把成果删掉，模拟 sink 拿到一个指向已删成果的事件
    await db.delete(deliverables).where(eq(deliverables.id, event.payload.deliverableId));

    await dispatchDeliverableEvents(handleDeliverableEvent);

    const items = await activities(owner.id, project.id);
    expect(items).toHaveLength(1);
    expect(items[0].summary).toBe("提交了成果");
  });
});
