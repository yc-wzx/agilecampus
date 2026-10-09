import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import type { RecordProjectActivityInput } from "@/contracts/p0-p2";
import {
  computeActivityCoverageFromMin,
  getActivityEvidence,
  listProjectActivities,
  recordProjectActivity,
} from "@/lib/activity";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { createProject } from "@/lib/project";
import { createTeam, joinTeam } from "@/lib/team";
import { createUser } from "@/lib/user";
import { resetDb } from "./helpers";

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

async function scene() {
  const owner = await makeUser("owner@example.com");
  const team = await createTeam(owner.id, "东吴实验室");
  const student = await makeUser("student@example.com");
  await joinTeam(student.id, team.inviteCode);
  const outsider = await makeUser("outsider@example.com");
  const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
  return { owner, team, student, outsider, project };
}

const BASE_TIME = "2026-10-07T02:00:00.000Z";

/** 用一条事务写一条活动，模拟业务事务内的真实调用方式。 */
async function record(
  projectId: string,
  actorId: string,
  overrides: Partial<RecordProjectActivityInput> = {},
) {
  return db.transaction((tx) =>
    recordProjectActivity(tx, {
      eventKey: `test:${randomUUID()}`,
      projectId,
      actorId,
      objectType: "task",
      objectId: randomUUID(),
      type: "task.created",
      summary: "创建了任务《测试》",
      occurredAt: BASE_TIME,
      ...overrides,
    }),
  );
}

describe("recordProjectActivity / listProjectActivities (E-A01 / E-A02)", () => {
  beforeEach(resetDb);

  it("同一 eventKey 重放只落一行，返回的是已存在的那条，内容不被改写", async () => {
    const { owner, project } = await scene();
    const eventKey = `task.created:${randomUUID()}`;

    const first = await record(project.id, owner.id, { eventKey });
    const replay = await record(project.id, owner.id, {
      eventKey,
      summary: "换了个说法",
      occurredAt: "2026-10-08T02:00:00.000Z",
    });

    expect(replay.id).toBe(first.id);
    expect(replay.summary).toBe(first.summary);
    expect((await listProjectActivities(owner.id, project.id)).total).toBe(1);
  });

  it("按 occurredAt 倒序；同一时刻按 id 升序，翻页才不重不漏", async () => {
    const { owner, project } = await scene();
    const older = await record(project.id, owner.id, {
      occurredAt: "2026-10-05T02:00:00.000Z",
    });
    const newer = await record(project.id, owner.id, {
      occurredAt: "2026-10-06T02:00:00.000Z",
    });

    const page = await listProjectActivities(owner.id, project.id);
    expect(page.items.map((i) => i.id)).toEqual([newer.id, older.id]);

    // 同一时刻的两条：顺序由 id 决定，而不是数据库的偶然顺序
    const same = "2026-10-09T02:00:00.000Z";
    const a = await record(project.id, owner.id, { occurredAt: same });
    const b = await record(project.id, owner.id, { occurredAt: same });
    const tied = await listProjectActivities(owner.id, project.id, { fromDate: "2026-10-09", toDate: "2026-10-10" });
    expect(tied.items.map((i) => i.id)).toEqual([a.id, b.id].sort());
  });

  it("分页：nextOffset 以实际取出条数为准，末尾不给取不到的游标", async () => {
    const { owner, project } = await scene();
    for (let i = 0; i < 3; i++) await record(project.id, owner.id);

    const first = await listProjectActivities(owner.id, project.id, { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.total).toBe(3);
    expect(first.nextOffset).toBe(2);

    const second = await listProjectActivities(owner.id, project.id, {
      limit: 2,
      offset: first.nextOffset!,
    });
    expect(second.items).toHaveLength(1);
    expect(second.nextOffset).toBeNull();
  });

  it("筛选按对象类型 / 对象 / 操作人各管各的", async () => {
    const { owner, student, project } = await scene();
    const taskId = randomUUID();
    await record(project.id, owner.id, { objectType: "task", objectId: taskId });
    await record(project.id, student.id, { objectType: "iteration", objectId: randomUUID() });
    await record(project.id, owner.id, {
      objectType: "deliverable",
      objectId: randomUUID(),
      type: "deliverable.submitted",
    });

    const onlyTask = await listProjectActivities(owner.id, project.id, { objectType: "task" });
    expect(onlyTask.items.map((i) => i.objectType)).toEqual(["task"]);

    const byObject = await listProjectActivities(owner.id, project.id, { objectId: taskId });
    expect(byObject.total).toBe(1);

    const byActor = await listProjectActivities(owner.id, project.id, { actorId: student.id });
    expect(byActor.items.map((i) => i.actorId)).toEqual([student.id]);
  });

  it("日期筛选是北京时间：16:00Z 才是次日零点", async () => {
    const { owner, project } = await scene();
    await record(project.id, owner.id, {
      occurredAt: "2026-10-07T15:59:59.000Z",
      summary: "十月七日 23:59",
    });
    await record(project.id, owner.id, {
      occurredAt: "2026-10-07T16:00:00.000Z",
      summary: "十月八日 00:00",
    });

    const day8 = await listProjectActivities(owner.id, project.id, {
      fromDate: "2026-10-08",
      toDate: "2026-10-09",
    });
    expect(day8.items.map((i) => i.summary)).toEqual(["十月八日 00:00"]);

    const day7 = await listProjectActivities(owner.id, project.id, {
      fromDate: "2026-10-07",
      toDate: "2026-10-08",
    });
    expect(day7.items.map((i) => i.summary)).toEqual(["十月七日 23:59"]);
  });

  it("结束日期不晚于开始日期时直接拒绝，不返回半个区间", async () => {
    const { owner, project } = await scene();
    await expect(
      listProjectActivities(owner.id, project.id, {
        fromDate: "2026-10-08",
        toDate: "2026-10-08",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      listProjectActivities(owner.id, project.id, {
        fromDate: "2026-10-09",
        toDate: "2026-10-08",
      }),
    ).rejects.toThrow("结束日期必须晚于开始日期");
  });

  it("metadata 只认登记过的键：正文类字段（含阻塞原因原文）进不来", async () => {
    const { owner, project } = await scene();

    await expect(
      record(project.id, owner.id, { metadata: { comment: "这是一段评论正文" } }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      record(project.id, owner.id, { metadata: { blockedReason: "等第三方接口" } }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      record(project.id, owner.id, { metadata: { description: "任务描述全文" } }),
    ).rejects.toThrow("含未允许字段");

    // 登记过的键照写不误
    const ok = await record(project.id, owner.id, {
      metadata: { taskId: randomUUID(), status: "todo", dueDate: "2026-10-20" },
    });
    expect(ok.id).toBeTruthy();
  });

  it("还没登记 metadata 白名单的类型不许携带额外信息", async () => {
    const { owner, project } = await scene();
    // comment.* 属 E-C01（P1），事件目录里有、白名单里还没有：
    // 现在就想带 metadata 的调用方必须先来登记，而不是由着它顺手塞
    await expect(
      record(project.id, owner.id, { type: "comment.created", metadata: { extra: "x" } }),
    ).rejects.toThrow("尚未登记 metadata 白名单");
  });

  it("事件目录外的类型与空摘要都被拒——不悄悄放宽白名单", async () => {
    const { owner, project } = await scene();
    await expect(
      record(project.id, owner.id, { type: "task.deleted" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      record(project.id, owner.id, { summary: "   " }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("非团队成员读不到：与「项目不存在」同一句话，不泄露项目是否存在", async () => {
    const { owner, outsider, project } = await scene();
    await record(project.id, owner.id);

    await expect(listProjectActivities(outsider.id, project.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(listProjectActivities(outsider.id, project.id)).rejects.toThrow(
      "项目不存在或无权访问",
    );
  });

  it("没有活动时是空列表，不是错误、也不是伪造的 0 条", async () => {
    const { owner, project } = await scene();
    const page = await listProjectActivities(owner.id, project.id);

    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.offset).toBe(0);
    expect(page.nextOffset).toBeNull();
    expect(page.coverage.availableFrom).toBeNull();
    expect(page.coverage.complete).toBe(false);
    expect(page.coverage.note).toBeTruthy();
  });

  it("覆盖说明用真实最早一条的时间，不拿「上线日期」冒充", async () => {
    const { owner, project } = await scene();
    await record(project.id, owner.id, { occurredAt: "2026-10-06T09:00:00.000Z" });
    await record(project.id, owner.id, { occurredAt: "2026-10-06T02:00:00.000Z" });

    const page = await listProjectActivities(owner.id, project.id);
    expect(page.coverage.availableFrom).toBe("2026-10-06T02:00:00.000Z");
    // 请求全部时，最早记录之前仍有未留痕的历史，不能声称完整。
    expect(page.coverage.complete).toBe(false);

    // 窗口起点（10-06 00:00 +08:00 = 10-05T16:00Z）早于最早记录 → 如实标为不完整
    const early = await listProjectActivities(owner.id, project.id, {
      fromDate: "2026-10-06",
      toDate: "2026-10-31",
    });
    expect(early.coverage.complete).toBe(false);
  });

  it("活动条目不带自行发明的深链接：sourceHref 为 null，证据键稳定", async () => {
    const { owner, project } = await scene();
    const item = await record(project.id, owner.id);

    expect(item.sourceRef.sourceHref).toBeNull();
    expect(item.sourceRef.sourceKind).toBe("activity");
    expect(item.sourceRef.evidenceKey).toBe(`activity:${item.id}`);
    expect(item.sourceRef.availability).toBe("available");
    expect(item.occurredAt).toBe(BASE_TIME);
  });
});

describe("getActivityEvidence (E-A03)", () => {
  beforeEach(resetDb);

  it("按 id 取回同一条；不存在或跨项目一律「活动不存在」", async () => {
    const { owner, team, project } = await scene();
    const item = await record(project.id, owner.id);
    const other = await createProject(owner.id, team.id, { name: "第二战场" });

    expect((await getActivityEvidence(owner.id, project.id, item.id)).id).toBe(item.id);

    await expect(
      getActivityEvidence(owner.id, project.id, randomUUID()),
    ).rejects.toThrow("活动不存在");
    // 拿 A 项目的活动 id 去 B 项目问：取不到，且不泄露它的归属
    await expect(
      getActivityEvidence(owner.id, other.id, item.id),
    ).rejects.toThrow("活动不存在");
  });

  it("非团队成员连证据也读不到", async () => {
    const { owner, outsider, project } = await scene();
    const item = await record(project.id, owner.id);
    await expect(
      getActivityEvidence(outsider.id, project.id, item.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("computeActivityCoverageFromMin", () => {
  it("库里没有任何记录时 availableFrom 为 null，且不声称完整", () => {
    expect(computeActivityCoverageFromMin(null)).toMatchObject({
      availableFrom: null,
      complete: false,
    });
    expect(computeActivityCoverageFromMin(null).note).toContain("没有留痕");
  });

  it("窗口起点不早于可用起点才算完整", () => {
    const min = "2026-10-06T02:00:00.000Z";
    // 10-06 的零点（10-05T16:00Z）早于最早记录 → 缺失前段
    expect(computeActivityCoverageFromMin(min, "2026-10-06").complete).toBe(false);
    // 10-07 的零点（10-06T16:00Z）晚于最早记录 → 窗口内是完整的
    expect(computeActivityCoverageFromMin(min, "2026-10-07").complete).toBe(true);
    expect(computeActivityCoverageFromMin(min).availableFrom).toBe(min);
  });
});
