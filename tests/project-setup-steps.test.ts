import { describe, expect, it } from "vitest";
import { deriveSetupSteps } from "@/lib/project-setup-steps";
import type { CurrentIteration, ProjectTaskStats, QueryPart } from "@/contracts/p0-p2";

const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEAM_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const TASK_STATS: ProjectTaskStats = {
  projectId: PROJECT_ID,
  asOf: "2026-10-07T02:00:00.000Z",
  scope: "main-tasks",
  byStatus: { todo: 2, doing: 0, done: 0 },
  total: 2,
  doneRatio: 0,
  overdueCount: 0,
  blockedCount: 0,
};

const ITERATION: CurrentIteration = {
  id: "11111111-1111-4111-8111-111111111111",
  projectId: PROJECT_ID,
  name: "第一轮",
  goal: null,
  startDate: "2026-10-01",
  endDate: "2026-10-28",
  status: "active",
  revision: 1,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  startedAt: "2026-10-01T00:00:00.000Z",
  completedAt: null,
  taskTotal: 2,
  doneCount: 0,
  doneRatio: 0,
  scope: "main-tasks",
  asOf: "2026-10-07T02:00:00.000Z",
  sourceHref: null,
};

function ready<T>(data: T): QueryPart<T> {
  return { state: "ready", data };
}
function unavailable<T>(): QueryPart<T> {
  return { state: "unavailable", code: "INTERNAL", message: "待接入" };
}

function steps(overrides: Partial<Parameters<typeof deriveSetupSteps>[0]> = {}) {
  return deriveSetupSteps({
    projectId: PROJECT_ID,
    teamId: TEAM_ID,
    description: null,
    milestoneCount: 0,
    taskStats: ready({ ...TASK_STATS, total: 0, byStatus: { todo: 0, doing: 0, done: 0 }, doneRatio: null }),
    activeIteration: ready(null),
    memberCount: 1,
    ...overrides,
  });
}

function step(result: ReturnType<typeof steps>, key: string) {
  const found = result.find((item) => item.key === key);
  if (!found) throw new Error(`缺少步骤 ${key}`);
  return found;
}

describe("deriveSetupSteps", () => {
  it("空项目：五项都未完成，且只给有真实入口的步骤配链接", () => {
    const result = steps();
    expect(result).toHaveLength(5);
    expect(result.every((item) => !item.done)).toBe(true);

    // 项目简介目前没有编辑入口 → 不给 href，避免放假链接
    expect(step(result, "goal").href).toBeUndefined();
    expect(step(result, "milestone").href).toBe(`/projects/${PROJECT_ID}`);
    expect(step(result, "task").href).toBe(`/projects/${PROJECT_ID}`);
    expect(step(result, "members").href).toBe(`/teams/${TEAM_ID}/members`);
    expect(step(result, "iteration").href).toBe(
      `/projects/${PROJECT_ID}/iterations`,
    );
  });

  it("项目简介只有空白字符时不算完成", () => {
    expect(step(steps({ description: "   " }), "goal").done).toBe(false);
    expect(step(steps({ description: "让同学知道下一步" }), "goal").done).toBe(true);
  });

  it("任务统计取不到时算未完成，而不是算完成或算 0 个任务", () => {
    const result = steps({ taskStats: unavailable<ProjectTaskStats>() });
    expect(step(result, "task").done).toBe(false);
  });

  it("任务数为 0 未完成，有主任务才完成", () => {
    expect(step(steps(), "task").done).toBe(false);
    expect(step(steps({ taskStats: ready(TASK_STATS) }), "task").done).toBe(true);
  });

  it("成员至少 2 人才算完成，并在提示里显示真实人数", () => {
    const one = steps({ memberCount: 1 });
    expect(step(one, "members").done).toBe(false);
    expect(step(one, "members").hint).toContain("当前 1 人");

    const two = steps({ memberCount: 2 });
    expect(step(two, "members").done).toBe(true);
    expect(step(two, "members").hint).toContain("当前 2 人");
  });

  it("当前迭代：planned 不算、没有活跃轮不算、取不到也不算", () => {
    expect(step(steps(), "iteration").done).toBe(false);
    expect(
      step(steps({ activeIteration: unavailable<CurrentIteration | null>() }), "iteration")
        .done,
    ).toBe(false);
    expect(
      step(steps({ activeIteration: ready(ITERATION) }), "iteration").done,
    ).toBe(true);
  });

  it("里程碑与全部完成的情形", () => {
    const done = steps({
      description: "目标",
      milestoneCount: 1,
      taskStats: ready(TASK_STATS),
      activeIteration: ready(ITERATION),
      memberCount: 3,
    });
    expect(done.every((item) => item.done)).toBe(true);
  });
});
