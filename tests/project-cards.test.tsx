import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  ActivityItem,
  CurrentIteration,
  ProjectDeliverableStats,
  ProjectRiskResult,
  ProjectTaskStats,
  QueryPart,
  RiskItem,
  TeacherProjectOverview,
} from "@/contracts/p0-p2";
import { TeacherProjectCard } from "@/components/projects/teacher-project-card";
import { RiskCard, RISK_RULE_LABELS } from "@/components/projects/risk-card";

// next/link 需要 App Router 上下文；这里只做静态渲染，替换成普通 <a>（保留其余 props）。
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TASK_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function ready<T>(data: T): QueryPart<T> {
  return { state: "ready", data };
}
function unavailable<T>(message: string): QueryPart<T> {
  return { state: "unavailable", code: "INTERNAL", message };
}

const TASK_STATS: ProjectTaskStats = {
  projectId: PROJECT_ID,
  asOf: "2026-10-07T02:00:00.000Z",
  scope: "main-tasks",
  byStatus: { todo: 2, doing: 0, done: 1 },
  total: 3,
  doneRatio: 1 / 3,
  overdueCount: 0,
  blockedCount: 0,
};

const DELIVERABLE_STATS: ProjectDeliverableStats = {
  projectId: PROJECT_ID,
  projectStatus: "active",
  byStatus: { submitted: 1, changes_requested: 1, approved: 1 },
  total: 3,
  approvedRatio: 1 / 3,
  scope: "current-submitted-deliverables",
};

const ACTIVE_ITERATION: CurrentIteration = {
  id: "11111111-1111-4111-8111-111111111111",
  projectId: PROJECT_ID,
  name: "第一轮",
  goal: "完成用户调研",
  startDate: "2026-10-01",
  endDate: "2026-10-21",
  status: "active",
  revision: 2,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
  startedAt: "2026-10-02T00:00:00.000Z",
  completedAt: null,
  taskTotal: 3,
  doneCount: 1,
  doneRatio: 1 / 3,
  scope: "main-tasks",
  asOf: "2026-10-07T02:00:00.000Z",
  sourceHref: `/projects/${PROJECT_ID}/iterations/11111111-1111-4111-8111-111111111111`,
};

const ACTIVITY: ActivityItem = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  eventKey: `task.completed:${TASK_ID}:2026-10-06T00:00:00.000Z`,
  projectId: PROJECT_ID,
  actorId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  objectType: "task",
  objectId: TASK_ID,
  type: "task.completed",
  summary: "完成了「用户调研」",
  occurredAt: "2026-10-06T01:00:00.000Z",
  sourceRef: {
    sourceKind: "task",
    sourceId: TASK_ID,
    projectId: PROJECT_ID,
    sourceHref: `/projects/${PROJECT_ID}?task=${TASK_ID}`,
    evidenceKey: `task:${TASK_ID}`,
    availability: "available",
  },
};

const RISK: RiskItem = {
  ruleId: "overdue_task",
  severity: "warning",
  message: "有 2 个主任务已逾期",
  threshold: { daysOverdue: 1 },
  observedValue: { overdueCount: 2 },
  evaluatedAt: "2026-10-07T02:00:00.000Z",
  sourceRefs: [
    {
      sourceKind: "task",
      sourceId: TASK_ID,
      projectId: PROJECT_ID,
      sourceHref: `/projects/${PROJECT_ID}?task=${TASK_ID}`,
      evidenceKey: `task:${TASK_ID}`,
      availability: "available",
    },
  ],
  evidenceKeys: [`task:${TASK_ID}`],
};

const RISK_RESULT: ProjectRiskResult = {
  projectId: PROJECT_ID,
  asOf: "2026-10-07T02:00:00.000Z",
  coverage: { availableFrom: "2026-10-01", complete: true, note: null },
  items: [RISK],
  unknownRules: [],
};

function overview(
  overrides: Partial<TeacherProjectOverview> = {},
): TeacherProjectOverview {
  return {
    projectId: PROJECT_ID,
    projectName: "赤壁演习",
    taskStats: ready(TASK_STATS),
    activeIteration: ready(ACTIVE_ITERATION),
    deliverableStats: ready(DELIVERABLE_STATS),
    lastActivity: ready(ACTIVITY),
    risks: ready(RISK_RESULT),
    pendingItems: ready({ submittedCount: 1, changesRequestedCount: 1, sourceHref: null }),
    asOf: "2026-10-07T02:00:00.000Z",
    ...overrides,
  };
}

function emptyOverview(): TeacherProjectOverview {
  return overview({
    taskStats: ready({ ...TASK_STATS, byStatus: { todo: 0, doing: 0, done: 0 }, total: 0, doneRatio: null, overdueCount: 0, blockedCount: 0 }),
    activeIteration: ready(null),
    deliverableStats: ready({ ...DELIVERABLE_STATS, byStatus: { submitted: 0, changes_requested: 0, approved: 0 }, total: 0, approvedRatio: null }),
    lastActivity: ready(null),
    risks: ready({ ...RISK_RESULT, items: [], unknownRules: [] }),
    pendingItems: ready({ submittedCount: 0, changesRequestedCount: 0, sourceHref: null }),
  });
}

describe("TeacherProjectCard", () => {
  it("空项目显示“暂无”，不显示 0/0 或 100%", () => {
    const html = renderToStaticMarkup(<TeacherProjectCard item={emptyOverview()} />);
    expect(html).toContain("暂无任务");
    expect(html).toContain("暂无正式提交");
    expect(html).toContain("当前没有进行中的迭代");
    expect(html).toContain("未发现符合规则的风险");
    expect(html).toContain("暂无记录");
    expect(html).not.toContain("0/0");
    expect(html).not.toContain("100%");
  });

  it("有数据时给出任务口径、成果口径、当前迭代与风险规则名", () => {
    const html = renderToStaticMarkup(<TeacherProjectCard item={overview()} />);
    expect(html).toContain("1/3 已完成");
    expect(html).toContain("通过 1 · 待验收 1 · 需修改 1");
    expect(html).toContain("第一轮");
    expect(html).toContain("已完成 1/3");
    expect(html).toContain("待验收 1");
    expect(html).toContain("需修改 1");
    expect(html).toContain(RISK_RULE_LABELS.overdue_task);
    expect(html).toContain("完成了「用户调研」");
  });

  it("单个数据源不可用时如实显示，不用 0 或“暂无”顶替", () => {
    const html = renderToStaticMarkup(
      <TeacherProjectCard
        item={overview({
          taskStats: unavailable("任务统计待接入"),
          lastActivity: unavailable("最近活动待接入"),
        })}
      />,
    );
    expect(html).toContain("暂时不可用");
    expect(html).toContain("待接入（E-A02）");
    expect(html).not.toContain("暂无任务");
    // 不能把取不到的任务数渲染成 0/N（注意北京时间串里本身含 "0/"，只断言具体口径文本）
    expect(html).not.toContain("0/0");
    expect(html).not.toContain("已完成 0/");
  });

  it("教师卡片链到项目概览", () => {
    const html = renderToStaticMarkup(<TeacherProjectCard item={overview()} />);
    expect(html).toContain(`/projects/${PROJECT_ID}/overview`);
  });
});

describe("RiskCard", () => {
  it("展示规则名、消息、阈值、观察值和真实来源", () => {
    const html = renderToStaticMarkup(<RiskCard item={RISK} />);
    expect(html).toContain(RISK_RULE_LABELS.overdue_task);
    expect(html).toContain("overdue_task");
    expect(html).toContain("有 2 个主任务已逾期");
    expect(html).toContain("daysOverdue=1");
    expect(html).toContain("overdueCount=2");
    expect(html).toContain(`/projects/${PROJECT_ID}?task=${TASK_ID}`);
    expect(html).toContain("打开任务");
  });

  it("来源已删除时给占位，不输出链接", () => {
    const html = renderToStaticMarkup(
      <RiskCard
        item={{
          ...RISK,
          ruleId: "inactive_project",
          sourceRefs: [
            {
              sourceKind: "iteration",
              sourceId: ACTIVE_ITERATION.id,
              projectId: PROJECT_ID,
              sourceHref: null,
              evidenceKey: `iteration:${ACTIVE_ITERATION.id}`,
              availability: "deleted",
            },
          ],
        }}
      />,
    );
    expect(html).toContain(RISK_RULE_LABELS.inactive_project);
    expect(html).toContain("来源已删除");
    expect(html).not.toContain("打开迭代");
  });
});
