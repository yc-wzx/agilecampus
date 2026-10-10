import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { MockLanguageModelV2 } from "ai/test";
import { db } from "@/db";
import {
  personalScheduleEvents,
  personalScheduleState,
  personalScheduleRequests,
  personalWorkPlans,
  projects,
  tasks,
  teamMembers,
  users,
} from "@/db/schema";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask } from "@/lib/task";
import {
  importMySchedule,
  changeMyEvent,
  getMySchedule,
} from "@/lib/schedule/store";
import {
  getTeamAvailability,
  saveScheduleSharing,
  getMyPlansNeedingReview,
  fuzzyBusy,
} from "@/lib/schedule/availability";
import {
  generatePersonalPlan,
  changePersonalPlan,
  getPlanningWorkspace,
  getReplanningSeed,
} from "@/lib/schedule/planner";
import { type GeneratePlanInput } from "@/lib/schedule/types";
import { resetDb } from "./helpers";
import { hashRequest } from "@/lib/write-request";

const now = new Date("2026-10-12T00:00:00Z");
const range = { startDate: "2026-10-12", days: 7 as const };
const secret = {
  title: "不公开的就医原因",
  startAt: "2026-10-12T10:07:00Z",
  endAt: "2026-10-12T11:13:00Z",
};
async function scene() {
  const [admin, student, teacher, outsider] = await db
    .insert(users)
    .values(
      ["admin", "student", "teacher", "outsider"].map((name) => ({
        name,
        email: name + "@availability.test",
        passwordHash: "fixture",
      })),
    )
    .returning();
  const team = await createTeam(admin.id, "临时日程团队");
  await joinTeam(student.id, team.inviteCode);
  await joinTeam(teacher.id, team.inviteCode);
  await db
    .update(teamMembers)
    .set({ role: "teacher" })
    .where(
      and(eq(teamMembers.userId, teacher.id), eq(teamMembers.teamId, team.id)),
    );
  const project = await createProject(admin.id, team.id, {
    name: "课堂项目",
    endDate: "2026-10-30",
  });
  const task = await createTask(admin.id, project.id, {
    title: "私有计划任务目标",
    assigneeId: student.id,
  });
  const input: GeneratePlanInput = {
    requestId: randomUUID(),
    ...range,
    mode: "rules",
    goal: "私有目标",
    selections: [{ taskId: task.id, minutes: 60 }],
  };
  return { admin, student, teacher, outsider, team, project, task, input };
}
async function sharing(
  s: Awaited<ReturnType<typeof scene>>,
  shareWorkPlans = false,
  expectedRevision = 0,
) {
  return saveScheduleSharing(s.student.id, {
    requestId: randomUUID(),
    expectedRevision,
    teamIds: [s.team.id],
    shareWorkPlans,
  });
}
async function confirmed(s: Awaited<ReturnType<typeof scene>>) {
  const row = await generatePersonalPlan(s.student.id, s.project.id, s.input, {
    now,
  });
  return changePersonalPlan(s.student.id, s.project.id, row.id, {
    requestId: randomUUID(),
    expectedRevision: 1,
    action: "confirm",
  });
}
async function myBusy(
  s: Awaited<ReturnType<typeof scene>>,
  actor = s.teacher.id,
) {
  const dto = await getTeamAvailability(actor, s.team.id, range);
  return { dto, member: dto.members.find((m) => m.id === s.student.id)! };
}
describe("自愿共享模糊日程", () => {
  beforeEach(resetDb);
  it("升级前的私有日程请求仍能重放，新增共享字段不会破坏旧去重凭据", async () => {
    const s = await scene(),
      requestId = randomUUID();
    const oldInput = { requestId, source: "csv" as const, events: [secret] };
    await db
      .insert(personalScheduleRequests)
      .values({
        userId: s.student.id,
        operation: "events.import",
        requestId,
        requestHash: hashRequest(oldInput),
        result: { added: 1, skipped: 0, revision: 1 },
      });
    expect(await importMySchedule(s.student.id, oldInput)).toEqual({
      added: 1,
      skipped: 0,
      revision: 1,
    });
    expect(await db.select().from(personalScheduleEvents)).toEqual([]);
    await expect(
      importMySchedule(s.student.id, {
        ...oldInput,
        events: [{ ...secret, shareBusy: true }],
      }),
    ).rejects.toThrow("不同内容");
  });
  it("导入默认私有；选择团队仍不会公开未授权事件", async () => {
    const s = await scene();
    await importMySchedule(s.student.id, {
      requestId: randomUUID(),
      source: "csv",
      events: [secret],
    });
    expect((await myBusy(s)).member.sharingEnabled).toBe(false);
    await sharing(s);
    const { dto, member } = await myBusy(s);
    expect(member.sharingEnabled).toBe(true);
    expect(member.periods).toEqual([]);
    expect(JSON.stringify(dto)).not.toContain(secret.title);
    expect(
      (await getMySchedule(s.student.id, { startDate: range.startDate }))
        .items[0].shareBusy,
    ).toBe(false);
  });
  it("事件勾选共享但未选择团队仍然私有", async () => {
    const s = await scene();
    await importMySchedule(s.student.id, {
      requestId: randomUUID(),
      source: "emergency",
      events: [{ ...secret, shareBusy: true }],
    });
    expect((await myBusy(s)).member.periods).toEqual([]);
  });
  it("老师和组员得到相同的忙碌时间，取整合并且不返回任何事情或记录标识", async () => {
    const s = await scene();
    await sharing(s);
    await importMySchedule(s.student.id, {
      requestId: randomUUID(),
      source: "emergency",
      events: [
        { ...secret, shareBusy: true },
        {
          title: "另一个秘密",
          startAt: "2026-10-12T11:20:00Z",
          endAt: "2026-10-12T11:48:00Z",
          shareBusy: true,
        },
        {
          title: "不公开",
          startAt: "2026-10-13T10:00:00Z",
          endAt: "2026-10-13T12:00:00Z",
        },
      ],
    });
    const teacher = await myBusy(s),
      admin = await myBusy(s, s.admin.id);
    expect(teacher.dto).toEqual(admin.dto);
    expect(teacher.member.periods).toEqual([
      {
        startAt: "2026-10-12T10:00:00.000Z",
        endAt: "2026-10-12T12:00:00.000Z",
      },
    ]);
    expect(Object.keys(teacher.member).sort()).toEqual([
      "id",
      "name",
      "periods",
      "role",
      "sharingEnabled",
    ]);
    expect(Object.keys(teacher.member.periods[0]).sort()).toEqual([
      "endAt",
      "startAt",
    ]);
    const serialized = JSON.stringify(teacher.dto);
    for (const text of [
      secret.title,
      "另一个秘密",
      "source",
      "fingerprint",
      "taskId",
      "goal",
      "projectId",
    ])
      expect(serialized).not.toContain(text);
  });
  it("未加入团队、退出后的成员和未授权的其他团队均无法读到共享日程", async () => {
    const s = await scene();
    await sharing(s);
    await expect(
      getTeamAvailability(s.outsider.id, s.team.id, range),
    ).rejects.toThrow();
    await db.delete(teamMembers).where(eq(teamMembers.userId, s.teacher.id));
    await expect(
      getTeamAvailability(s.teacher.id, s.team.id, range),
    ).rejects.toThrow();
    const second = await createTeam(s.outsider.id, "另一团队");
    await joinTeam(s.student.id, second.inviteCode);
    await importMySchedule(s.student.id, {
      requestId: randomUUID(),
      source: "manual",
      events: [{ ...secret, shareBusy: true }],
    });
    const dto = await getTeamAvailability(s.outsider.id, second.id, range);
    expect(dto.members.find((m) => m.id === s.student.id)?.periods).toEqual([]);
  });
  it("撤回团队授权、事件授权和退出团队后刷新不再出现忙碌时间", async () => {
    const s = await scene();
    await sharing(s);
    await importMySchedule(s.student.id, {
      requestId: randomUUID(),
      source: "manual",
      events: [{ ...secret, shareBusy: true }],
    });
    const [event] = await db.select().from(personalScheduleEvents);
    expect((await myBusy(s)).member.periods).toHaveLength(1);
    await changeMyEvent(s.student.id, event.id, {
      requestId: randomUUID(),
      expectedRevision: 1,
      event: { ...secret, shareBusy: false },
    });
    expect((await myBusy(s)).member.periods).toEqual([]);
    await saveScheduleSharing(s.student.id, {
      requestId: randomUUID(),
      expectedRevision: 1,
      teamIds: [],
      shareWorkPlans: false,
    });
    expect((await myBusy(s)).member.sharingEnabled).toBe(false);
    await db.delete(teamMembers).where(eq(teamMembers.userId, s.student.id));
    expect(
      (await getTeamAvailability(s.admin.id, s.team.id, range)).members.some(
        (m) => m.id === s.student.id,
      ),
    ).toBe(false);
  });
  it("授权设置核对团队成员身份、版本和幂等内容；更改共享设置不使工作草案过时", async () => {
    const s = await scene(),
      plan = await generatePersonalPlan(s.student.id, s.project.id, s.input, {
        now,
      });
    const input = {
      requestId: randomUUID(),
      expectedRevision: 0,
      teamIds: [s.team.id],
      shareWorkPlans: false,
    };
    await saveScheduleSharing(s.student.id, input);
    await saveScheduleSharing(s.student.id, input);
    await expect(
      saveScheduleSharing(s.student.id, { ...input, shareWorkPlans: true }),
    ).rejects.toThrow("不同内容");
    await expect(sharing(s)).rejects.toThrow("已变化");
    await expect(
      saveScheduleSharing(s.student.id, {
        ...input,
        requestId: randomUUID(),
        expectedRevision: 1,
        teamIds: [randomUUID()],
      }),
    ).rejects.toThrow();
    expect(
      (await getPlanningWorkspace(s.student.id, s.project.id)).plans.find(
        (p) => p.id === plan.id,
      )?.isStale,
    ).toBe(false);
    expect((await db.select().from(personalScheduleState))[0].revision).toBe(0);
  });
  it("导入去重不会悄悄修改已有事件的公开权限", async () => {
    const s = await scene();
    await importMySchedule(s.student.id, {
      requestId: randomUUID(),
      source: "csv",
      events: [secret],
    });
    const result = await importMySchedule(s.student.id, {
      requestId: randomUUID(),
      source: "csv",
      events: [{ ...secret, shareBusy: true }],
    });
    expect(result.added).toBe(0);
    expect((await db.select().from(personalScheduleEvents))[0].shareBusy).toBe(
      false,
    );
  });
  it("公开工作时段只包含对应团队的已确认安排，隐藏目标及任务", async () => {
    const s = await scene(),
      plan = await confirmed(s);
    expect((await myBusy(s)).member.periods).toEqual([]);
    await sharing(s, true);
    const shared = await myBusy(s);
    expect(shared.member.periods.length).toBeGreaterThan(0);
    expect(JSON.stringify(shared.dto)).not.toContain(s.input.goal);
    expect(JSON.stringify(shared.dto)).not.toContain(s.task.title);
    await changePersonalPlan(s.student.id, s.project.id, plan.id, {
      requestId: randomUUID(),
      expectedRevision: 2,
      action: "cancel",
    });
    expect((await myBusy(s)).member.periods).toEqual([]);
  });
  it("模糊时间跨日取整后仍限定在查询范围，接壤片段合并", () => {
    expect(
      fuzzyBusy(
        [
          { startAt: "2026-10-11T23:50:00Z", endAt: "2026-10-12T00:07:00Z" },
          { startAt: "2026-10-12T00:20:00Z", endAt: "2026-10-12T00:31:00Z" },
        ],
        Date.parse("2026-10-12T00:00:00Z"),
        Date.parse("2026-10-13T00:00:00Z"),
      ),
    ).toEqual([
      {
        startAt: "2026-10-12T00:00:00.000Z",
        endAt: "2026-10-12T01:00:00.000Z",
      },
    ]);
  });
});
describe("临时事件与原子重新规划", () => {
  beforeEach(resetDb);
  it("补充事件后标记旧安排，新草案避让事件，确认才替换；共享任务保持原样", async () => {
    const s = await scene(),
      first = await confirmed(s),
      block = first.items[0];
    const before = await db.select().from(tasks);
    await importMySchedule(s.student.id, {
      requestId: randomUUID(),
      source: "emergency",
      events: [
        { title: "临时安排", startAt: block.startAt, endAt: block.endAt },
      ],
    });
    expect((await getMyPlansNeedingReview(s.student.id))[0].id).toBe(first.id);
    const seed = await getReplanningSeed(s.student.id, s.project.id, first.id);
    expect(seed.selections).toEqual(s.input.selections);
    const next = await generatePersonalPlan(
      s.student.id,
      s.project.id,
      { ...s.input, requestId: randomUUID(), replacePlanId: first.id },
      { now },
    );
    expect(
      next.items.every(
        (b) =>
          Date.parse(b.startAt) >= Date.parse(block.endAt) ||
          Date.parse(b.endAt) <= Date.parse(block.startAt),
      ),
    ).toBe(true);
    expect(
      (
        await db
          .select()
          .from(personalWorkPlans)
          .where(eq(personalWorkPlans.id, first.id))
      )[0].status,
    ).toBe("confirmed");
    const confirm = {
      requestId: randomUUID(),
      expectedRevision: 1,
      action: "confirm" as const,
    };
    const updated = await changePersonalPlan(
      s.student.id,
      s.project.id,
      next.id,
      confirm,
    );
    expect(updated.status).toBe("confirmed");
    expect(
      (
        await db
          .select()
          .from(personalWorkPlans)
          .where(eq(personalWorkPlans.id, first.id))
      )[0].status,
    ).toBe("cancelled");
    expect(
      (await getPlanningWorkspace(s.student.id, s.project.id)).plans.find(
        (p) => p.id === next.id,
      )?.isStale,
    ).toBe(false);
    await changePersonalPlan(s.student.id, s.project.id, next.id, confirm);
    expect(await db.select().from(tasks)).toEqual(before);
  });
  it("取消替换草案或模型生成失败都保留原已确认安排", async () => {
    const s = await scene(),
      first = await confirmed(s);
    const data = {
      ...s.input,
      requestId: randomUUID(),
      replacePlanId: first.id,
    };
    const next = await generatePersonalPlan(s.student.id, s.project.id, data, {
      now,
    });
    await changePersonalPlan(s.student.id, s.project.id, next.id, {
      requestId: randomUUID(),
      expectedRevision: 1,
      action: "cancel",
    });
    const bad = new MockLanguageModelV2({
      doGenerate: async () => ({
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        content: [{ type: "text", text: "invalid" }],
        warnings: [],
      }),
    });
    await expect(
      generatePersonalPlan(
        s.student.id,
        s.project.id,
        { ...data, requestId: randomUUID(), mode: "ai" },
        { now, model: bad },
      ),
    ).rejects.toThrow();
    expect(
      (
        await db
          .select()
          .from(personalWorkPlans)
          .where(eq(personalWorkPlans.id, first.id))
      )[0].status,
    ).toBe("confirmed");
  });
  it("两个替换草案只能确认一个，旧请求重放不会重新激活原计划", async () => {
    const s = await scene(),
      first = await confirmed(s);
    const input = {
      ...s.input,
      requestId: randomUUID(),
      replacePlanId: first.id,
    };
    const a = await generatePersonalPlan(s.student.id, s.project.id, input, {
      now,
    });
    const b = await generatePersonalPlan(
      s.student.id,
      s.project.id,
      { ...input, requestId: randomUUID() },
      { now },
    );
    await changePersonalPlan(s.student.id, s.project.id, a.id, {
      requestId: randomUUID(),
      expectedRevision: 1,
      action: "confirm",
    });
    await expect(
      changePersonalPlan(s.student.id, s.project.id, b.id, {
        requestId: randomUUID(),
        expectedRevision: 1,
        action: "confirm",
      }),
    ).rejects.toThrow("原计划");
    expect(
      (await generatePersonalPlan(s.student.id, s.project.id, s.input, { now }))
        .status,
    ).toBe("cancelled");
    expect(
      (await generatePersonalPlan(s.student.id, s.project.id, input, { now }))
        .id,
    ).toBe(a.id);
    expect(
      (await db.select().from(personalWorkPlans)).filter(
        (p) => p.status === "confirmed",
      ),
    ).toHaveLength(1);
  });
  it("确认前新增突发事件则拒绝旧草案，并保留原安排", async () => {
    const s = await scene(),
      first = await confirmed(s);
    const next = await generatePersonalPlan(
      s.student.id,
      s.project.id,
      { ...s.input, requestId: randomUUID(), replacePlanId: first.id },
      { now },
    );
    await importMySchedule(s.student.id, {
      requestId: randomUUID(),
      source: "emergency",
      events: [secret],
    });
    await expect(
      changePersonalPlan(s.student.id, s.project.id, next.id, {
        requestId: randomUUID(),
        expectedRevision: 1,
        action: "confirm",
      }),
    ).rejects.toThrow("变化");
    expect(
      (
        await db
          .select()
          .from(personalWorkPlans)
          .where(eq(personalWorkPlans.id, first.id))
      )[0].status,
    ).toBe("confirmed");
  });
  it("不能替换他人计划、草案或另一项目的计划；教师和归档项目也不能重新规划", async () => {
    const s = await scene(),
      first = await confirmed(s);
    await expect(
      getReplanningSeed(s.admin.id, s.project.id, first.id),
    ).rejects.toThrow();
    await expect(
      generatePersonalPlan(
        s.teacher.id,
        s.project.id,
        { ...s.input, replacePlanId: first.id },
        { now },
      ),
    ).rejects.toThrow();
    const second = await createProject(s.admin.id, s.team.id, {
      name: "另一项目",
    });
    await expect(
      generatePersonalPlan(
        s.student.id,
        second.id,
        { ...s.input, requestId: randomUUID(), replacePlanId: first.id },
        { now },
      ),
    ).rejects.toThrow();
    await db
      .update(projects)
      .set({ status: "archived" })
      .where(eq(projects.id, s.project.id));
    await expect(
      generatePersonalPlan(
        s.student.id,
        s.project.id,
        { ...s.input, requestId: randomUUID(), replacePlanId: first.id },
        { now },
      ),
    ).rejects.toThrow("归档");
  });
});
