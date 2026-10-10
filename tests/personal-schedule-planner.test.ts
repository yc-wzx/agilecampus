import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { MockLanguageModelV2 } from "ai/test";
import { db } from "@/db";
import {
  users,
  tasks,
  teamMembers,
  projects,
  personalScheduleEvents,
  personalWorkPlans,
  taskDependencies,
} from "@/db/schema";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask } from "@/lib/task";
import {
  getMySchedule,
  importMySchedule,
  saveMyPreferences,
  changeMyEvent,
} from "@/lib/schedule/store";
import {
  generatePersonalPlan,
  changePersonalPlan,
  getPlanningWorkspace,
} from "@/lib/schedule/planner";
import {
  DEFAULT_PREFERENCES,
  type GeneratePlanInput,
} from "@/lib/schedule/types";
import { resetDb } from "./helpers";
const now = new Date("2026-10-12T00:00:00Z");
async function scene() {
  const [admin, student, other, outsider] = await db
    .insert(users)
    .values(
      ["admin", "student", "other", "outsider"].map((name) => ({
        name,
        email: name + "@schedule.test",
        passwordHash: "fixture",
      })),
    )
    .returning();
  const team = await createTeam(admin.id, "课表规划团队");
  await joinTeam(student.id, team.inviteCode);
  await joinTeam(other.id, team.inviteCode);
  const project = await createProject(admin.id, team.id, {
    name: "课程项目",
    endDate: "2026-10-30",
  });
  const task = await createTask(admin.id, project.id, {
    title: "完成登录接口",
    assigneeId: student.id,
    dueDate: "2026-10-14",
  });
  const input: GeneratePlanInput = {
    requestId: randomUUID(),
    startDate: "2026-10-12",
    days: 7,
    mode: "rules",
    goal: "推进展示",
    selections: [{ taskId: task.id, minutes: 60 }],
  };
  return { admin, student, other, outsider, team, project, task, input };
}
const event = {
  title: "私人课程-123",
  startAt: "2026-10-12T10:00:00Z",
  endAt: "2026-10-12T12:00:00Z",
};
const model = (
  text: string,
  inspect?: (prompt: unknown) => Promise<void> | void,
) =>
  new MockLanguageModelV2({
    doGenerate: async (input) => {
      await inspect?.(input.prompt);
      return {
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        content: [{ type: "text", text }],
        warnings: [],
      };
    },
  });
describe("个人日程权限、去重与版本", () => {
  beforeEach(resetDb);
  it("课表只返回本人，团队管理员也看不到别人的记录", async () => {
    const s = await scene();
    await importMySchedule(s.student.id, {
      requestId: randomUUID(),
      source: "ics",
      events: [event],
    });
    expect(
      (
        await getMySchedule(s.student.id, {
          startDate: "2026-10-12",
          endDate: "2026-10-20",
        })
      ).items,
    ).toHaveLength(1);
    expect(
      (
        await getMySchedule(s.admin.id, {
          startDate: "2026-10-12",
          endDate: "2026-10-20",
        })
      ).items,
    ).toHaveLength(0);
  });
  it("同一导入重放及不同请求重复内容不增加课程", async () => {
    const s = await scene(),
      input = {
        requestId: randomUUID(),
        source: "csv" as const,
        events: [event],
      };
    expect((await importMySchedule(s.student.id, input)).added).toBe(1);
    expect((await importMySchedule(s.student.id, input)).added).toBe(1);
    expect(
      (
        await importMySchedule(s.student.id, {
          ...input,
          requestId: randomUUID(),
        })
      ).added,
    ).toBe(0);
    expect(await db.select().from(personalScheduleEvents)).toHaveLength(1);
    await expect(
      importMySchedule(s.student.id, {
        ...input,
        events: [{ ...event, title: "修改内容" }],
      }),
    ).rejects.toThrow("不同内容");
  });
  it("修改与删除核对所有者和版本，删除后重复导入请求不复活", async () => {
    const s = await scene(),
      input = {
        requestId: randomUUID(),
        source: "csv" as const,
        events: [event],
      };
    await importMySchedule(s.student.id, input);
    const [row] = await db.select().from(personalScheduleEvents);
    await expect(
      changeMyEvent(s.admin.id, row.id, {
        requestId: randomUUID(),
        expectedRevision: 1,
      }),
    ).rejects.toThrow();
    await changeMyEvent(s.student.id, row.id, {
      requestId: randomUUID(),
      expectedRevision: 1,
      event: { ...event, title: "更改课程" },
    });
    await expect(
      changeMyEvent(s.student.id, row.id, {
        requestId: randomUUID(),
        expectedRevision: 1,
      }),
    ).rejects.toThrow("已变化");
    const remove = { requestId: randomUUID(), expectedRevision: 2 };
    await changeMyEvent(s.student.id, row.id, remove);
    await changeMyEvent(s.student.id, row.id, remove);
    await importMySchedule(s.student.id, input);
    expect(await db.select().from(personalScheduleEvents)).toHaveLength(0);
  });
  it("偏好保存遵守全局版本，不覆盖并发课表更新", async () => {
    const s = await scene();
    await importMySchedule(s.student.id, {
      requestId: randomUUID(),
      source: "manual",
      events: [event],
    });
    await expect(
      saveMyPreferences(s.student.id, {
        requestId: randomUUID(),
        expectedRevision: 0,
        preferences: DEFAULT_PREFERENCES,
      }),
    ).rejects.toThrow("已变化");
    await saveMyPreferences(s.student.id, {
      requestId: randomUUID(),
      expectedRevision: 1,
      preferences: { ...DEFAULT_PREFERENCES, dailyMinutes: 90 },
    });
    expect((await getMySchedule(s.student.id)).preferences.dailyMinutes).toBe(
      90,
    );
  });
});
describe("课表驱动短期草案与确认", () => {
  beforeEach(resetDb);
  it("计划前一天结束的课程，其跨午夜缓冲也必须避开", async () => {
    const s = await scene();
    await saveMyPreferences(s.student.id, {
      requestId: randomUUID(),
      expectedRevision: 0,
      preferences: {
        ...DEFAULT_PREFERENCES,
        workStart: "00:00",
        workEnd: "02:00",
        bufferMinutes: 60,
      },
    });
    await importMySchedule(s.student.id, {
      requestId: randomUUID(),
      source: "manual",
      events: [
        {
          title: "前一晚实验",
          startAt: "2026-10-11T22:30:00+08:00",
          endAt: "2026-10-11T23:30:00+08:00",
        },
      ],
    });
    const plan = await generatePersonalPlan(
      s.student.id,
      s.project.id,
      s.input,
      {
        now: new Date("2026-10-11T12:00:00+08:00"),
      },
    );
    expect(plan.items[0].startAt).toBe("2026-10-11T16:30:00.000Z");
  });
  it("相邻规划周期内的已确认工作也保留跨午夜休息", async () => {
    const s = await scene();
    await saveMyPreferences(s.student.id, {
      requestId: randomUUID(),
      expectedRevision: 0,
      preferences: {
        ...DEFAULT_PREFERENCES,
        days: [0, 1, 2, 3, 4, 5, 6],
        workStart: "00:00",
        workEnd: "23:45",
        bufferMinutes: 60,
        blockMinutes: 30,
      },
    });
    const lateNow = new Date("2026-10-11T23:00:00+08:00");
    const prior = await generatePersonalPlan(
      s.student.id,
      s.project.id,
      {
        ...s.input,
        startDate: "2026-10-05",
      },
      { now: new Date("2026-10-05T23:00:00+08:00") },
    );
    // Use a saved, finished earlier period with a last-night block. A confirmed
    // history may come from a real previous generation with a different horizon.
    await db
      .update(personalWorkPlans)
      .set({
        status: "confirmed",
        endDate: "2026-10-11",
        items: [
          {
            ...prior.items[0],
            startAt: "2026-10-11T23:00:00+08:00",
            endAt: "2026-10-11T23:30:00+08:00",
            minutes: 30,
          },
        ],
      })
      .where(eq(personalWorkPlans.id, prior.id));
    const plan = await generatePersonalPlan(
      s.student.id,
      s.project.id,
      {
        ...s.input,
        requestId: randomUUID(),
      },
      { now: lateNow },
    );
    expect(plan.items[0].startAt).toBe("2026-10-11T16:30:00.000Z");
  });
  it("生成不改共享任务；确认只保存个人安排并保留私有边界", async () => {
    const s = await scene();
    await importMySchedule(s.student.id, {
      requestId: randomUUID(),
      source: "ics",
      events: [event],
    });
    const plan = await generatePersonalPlan(
      s.student.id,
      s.project.id,
      s.input,
      { now },
    );
    expect(plan.status).toBe("draft");
    expect(Date.parse(plan.items[0].startAt)).toBeGreaterThanOrEqual(
      Date.parse(event.endAt) + 15 * 60000,
    );
    expect(
      (await db.select().from(tasks).where(eq(tasks.id, s.task.id)))[0].status,
    ).toBe("todo");
    const input = {
      requestId: randomUUID(),
      expectedRevision: 1,
      action: "confirm" as const,
    };
    expect(
      (await changePersonalPlan(s.student.id, s.project.id, plan.id, input))
        .status,
    ).toBe("confirmed");
    await changePersonalPlan(s.student.id, s.project.id, plan.id, input);
    expect(
      (await getPlanningWorkspace(s.other.id, s.project.id)).plans,
    ).toHaveLength(0);
    await expect(
      changePersonalPlan(s.admin.id, s.project.id, plan.id, {
        requestId: randomUUID(),
        expectedRevision: 1,
        action: "cancel",
      }),
    ).rejects.toThrow();
  });
  it("重复生成请求不增加草案；取消后旧请求不复活", async () => {
    const s = await scene(),
      first = await generatePersonalPlan(s.student.id, s.project.id, s.input, {
        now,
      });
    expect(
      (await generatePersonalPlan(s.student.id, s.project.id, s.input, { now }))
        .id,
    ).toBe(first.id);
    await changePersonalPlan(s.student.id, s.project.id, first.id, {
      requestId: randomUUID(),
      expectedRevision: 1,
      action: "cancel",
    });
    expect(
      (await generatePersonalPlan(s.student.id, s.project.id, s.input, { now }))
        .status,
    ).toBe("cancelled");
    expect(await db.select().from(personalWorkPlans)).toHaveLength(1);
  });
  it("其他团队、教师、改派任务或已归档不能生成", async () => {
    const s = await scene();
    await expect(
      generatePersonalPlan(s.outsider.id, s.project.id, s.input, { now }),
    ).rejects.toThrow();
    await db
      .update(teamMembers)
      .set({ role: "teacher" })
      .where(
        and(
          eq(teamMembers.userId, s.student.id),
          eq(teamMembers.teamId, s.team.id),
        ),
      );
    await expect(
      generatePersonalPlan(s.student.id, s.project.id, s.input, { now }),
    ).rejects.toThrow();
    await db
      .update(teamMembers)
      .set({ role: "student" })
      .where(eq(teamMembers.userId, s.student.id));
    await db
      .update(tasks)
      .set({ assigneeId: s.other.id })
      .where(eq(tasks.id, s.task.id));
    await expect(
      generatePersonalPlan(s.student.id, s.project.id, s.input, { now }),
    ).rejects.toThrow("改派");
    await db
      .update(tasks)
      .set({ assigneeId: s.student.id })
      .where(eq(tasks.id, s.task.id));
    await db
      .update(projects)
      .set({ status: "archived" })
      .where(eq(projects.id, s.project.id));
    await expect(
      generatePersonalPlan(s.student.id, s.project.id, s.input, { now }),
    ).rejects.toThrow("归档");
  });
  it("阻塞、依赖未完和父任务不能当作可安排任务", async () => {
    const s = await scene();
    await db
      .update(tasks)
      .set({ isBlocked: true })
      .where(eq(tasks.id, s.task.id));
    await expect(
      generatePersonalPlan(s.student.id, s.project.id, s.input, { now }),
    ).rejects.toThrow("阻塞");
    await db
      .update(tasks)
      .set({ isBlocked: false })
      .where(eq(tasks.id, s.task.id));
    const predecessor = await createTask(s.admin.id, s.project.id, {
      title: "前置",
      assigneeId: s.student.id,
    });
    await db
      .insert(taskDependencies)
      .values({ predecessorId: predecessor.id, successorId: s.task.id });
    await expect(
      generatePersonalPlan(s.student.id, s.project.id, s.input, { now }),
    ).rejects.toThrow("前置");
  });
  it("课表或任务变化后拒绝确认，页面将草案标记需重规划", async () => {
    const s = await scene(),
      plan = await generatePersonalPlan(s.student.id, s.project.id, s.input, {
        now,
      });
    await importMySchedule(s.student.id, {
      requestId: randomUUID(),
      source: "manual",
      events: [event],
    });
    await expect(
      changePersonalPlan(s.student.id, s.project.id, plan.id, {
        requestId: randomUUID(),
        expectedRevision: 1,
        action: "confirm",
      }),
    ).rejects.toThrow("变化");
    expect(
      (await getPlanningWorkspace(s.student.id, s.project.id)).plans[0].isStale,
    ).toBe(true);
  });
  it("已有个人安排跨项目避让，同项目重规划需要指定原计划", async () => {
    const s = await scene(),
      first = await generatePersonalPlan(s.student.id, s.project.id, s.input, {
        now,
      });
    await changePersonalPlan(s.student.id, s.project.id, first.id, {
      requestId: randomUUID(),
      expectedRevision: 1,
      action: "confirm",
    });
    await expect(
      generatePersonalPlan(
        s.student.id,
        s.project.id,
        { ...s.input, requestId: randomUUID() },
        { now },
      ),
    ).rejects.toThrow("重新规划");
    const second = await createProject(s.admin.id, s.team.id, {
        name: "另一个项目",
      }),
      otherTask = await createTask(s.admin.id, second.id, {
        title: "第二项目工作",
        assigneeId: s.student.id,
      });
    const later = await generatePersonalPlan(
      s.student.id,
      second.id,
      {
        ...s.input,
        requestId: randomUUID(),
        selections: [{ taskId: otherTask.id, minutes: 60 }],
      },
      { now },
    );
    expect(
      later.items.every((b) =>
        first.items.every(
          (a) =>
            Date.parse(b.startAt) >= Date.parse(a.endAt) ||
            Date.parse(b.endAt) <= Date.parse(a.startAt),
        ),
      ),
    ).toBe(true);
  });
  it("超容量如实列出缺口，没有时段不能确认空计划", async () => {
    const s = await scene();
    await saveMyPreferences(s.student.id, {
      requestId: randomUUID(),
      expectedRevision: 0,
      preferences: { ...DEFAULT_PREFERENCES, days: [1], dailyMinutes: 30 },
    });
    const plan = await generatePersonalPlan(
      s.student.id,
      s.project.id,
      { ...s.input, selections: [{ taskId: s.task.id, minutes: 240 }] },
      { now },
    );
    expect(plan.unmet[0].minutes).toBe(210);
    const expired = await generatePersonalPlan(
      s.student.id,
      s.project.id,
      { ...s.input, requestId: randomUUID(), startDate: "2026-10-15" },
      { now },
    );
    expect(expired.items).toEqual([]);
    await expect(
      changePersonalPlan(s.student.id, s.project.id, expired.id, {
        requestId: randomUUID(),
        expectedRevision: 1,
        action: "confirm",
      }),
    ).rejects.toThrow("没有可安排");
  });
  it("AI 接收真实进度和可用时间统计，不接收私人课程名称", async () => {
    const s = await scene();
    await importMySchedule(s.student.id, {
      requestId: randomUUID(),
      source: "ics",
      events: [event],
    });
    let prompt = "";
    const ai = model(
      JSON.stringify({
        goal: "本周完善登录",
        tasks: [
          {
            taskId: s.task.id,
            objective: "联调登录接口并检查验收标准",
            reason: "近期展示所需",
          },
        ],
      }),
      (p) => {
        prompt = JSON.stringify(p);
      },
    );
    const plan = await generatePersonalPlan(
      s.student.id,
      s.project.id,
      { ...s.input, mode: "ai" },
      { model: ai, now },
    );
    expect(plan.mode).toBe("ai");
    expect(plan.items[0].objective).toContain("联调");
    expect(prompt).toContain("progress");
    expect(prompt).not.toContain(event.title);
  });
  it("模型伪造任务拒绝保存，失败请求可以安全重试", async () => {
    const s = await scene(),
      input = { ...s.input, mode: "ai" as const };
    await expect(
      generatePersonalPlan(s.student.id, s.project.id, input, {
        model: model(
          JSON.stringify({
            goal: "伪造",
            tasks: [{ taskId: randomUUID(), objective: "bad", reason: "bad" }],
          }),
        ),
        now,
      }),
    ).rejects.toThrow("无效");
    expect(await db.select().from(personalWorkPlans)).toEqual([]);
    const valid = model(
      JSON.stringify({
        goal: "真实目标",
        tasks: [
          { taskId: s.task.id, objective: "真实工作", reason: "真实期限" },
        ],
      }),
    );
    expect(
      (
        await generatePersonalPlan(s.student.id, s.project.id, input, {
          model: valid,
          now,
        })
      ).status,
    ).toBe("draft");
  });
  it("生成期间任务改变，旧模型输出不会保存", async () => {
    const s = await scene();
    const ai = model(
      JSON.stringify({
        goal: "短期目标",
        tasks: [{ taskId: s.task.id, objective: "登录", reason: "截止临近" }],
      }),
      async () => {
        await db
          .update(tasks)
          .set({ title: "已改任务" })
          .where(eq(tasks.id, s.task.id));
      },
    );
    await expect(
      generatePersonalPlan(
        s.student.id,
        s.project.id,
        { ...s.input, mode: "ai" },
        { model: ai, now },
      ),
    ).rejects.toThrow("生成期间");
    expect(await db.select().from(personalWorkPlans)).toEqual([]);
  });
  it("退出团队后确认和请求重放都重新鉴权", async () => {
    const s = await scene();
    await generatePersonalPlan(s.student.id, s.project.id, s.input, { now });
    await db.delete(teamMembers).where(eq(teamMembers.userId, s.student.id));
    await expect(
      generatePersonalPlan(s.student.id, s.project.id, s.input, { now }),
    ).rejects.toThrow();
    await expect(
      getPlanningWorkspace(s.student.id, s.project.id),
    ).rejects.toThrow();
  });
});
