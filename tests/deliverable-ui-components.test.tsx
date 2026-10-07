import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  ProjectDeliverableStats,
  ProjectTaskStats,
} from "@/contracts/p0-p2";
import {
  DeliverableProgress,
  TaskProgress,
} from "@/components/projects/progress";
import { ReviewForm } from "@/app/(app)/projects/[projectId]/deliverables/review-form";
import { StartRevisionButton } from "@/app/(app)/projects/[projectId]/deliverables/start-revision-button";
import { FeedbackTaskForm } from "@/app/(app)/projects/[projectId]/deliverables/feedback-task-form";

// 这些组件在浏览器里用 next 的运行时；静态渲染时替换掉。
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
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// 表单 import 的 actions 会拉进 next-auth → next/server；静态渲染用不到会话，直接替换
vi.mock("@/lib/auth", () => ({ auth: async () => null }));

const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DELIVERABLE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TASK_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const REQUEST_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

describe("TaskProgress / DeliverableProgress", () => {
  it("没有任务时显示“暂无任务”，不显示 0% 或 100%", () => {
    const stats: ProjectTaskStats = {
      projectId: PROJECT_ID,
      asOf: "2026-10-07T02:00:00.000Z",
      scope: "main-tasks",
      byStatus: { todo: 0, doing: 0, done: 0 },
      total: 0,
      doneRatio: null,
      overdueCount: 0,
      blockedCount: 0,
    };
    const html = renderToStaticMarkup(<TaskProgress stats={stats} />);
    expect(html).toContain("暂无任务");
    expect(html).toContain("主任务口径");
    expect(html).not.toContain("0%");
    expect(html).not.toContain("100%");
  });

  it("有任务时给出完成比例、逾期与阻塞数", () => {
    const stats: ProjectTaskStats = {
      projectId: PROJECT_ID,
      asOf: "2026-10-07T02:00:00.000Z",
      scope: "main-tasks",
      byStatus: { todo: 1, doing: 1, done: 1 },
      total: 3,
      doneRatio: 1 / 3,
      overdueCount: 2,
      blockedCount: 1,
    };
    const html = renderToStaticMarkup(<TaskProgress stats={stats} />);
    expect(html).toContain("1/3");
    expect(html).toContain("33%");
    expect(html).toContain("逾期 2");
    expect(html).toContain("阻塞 1");
  });

  it("没有正式成果时不写通过率，也不显示 100%", () => {
    const stats: ProjectDeliverableStats = {
      projectId: PROJECT_ID,
      projectStatus: "active",
      byStatus: { submitted: 0, changes_requested: 0, approved: 0 },
      total: 0,
      approvedRatio: null,
      scope: "current-submitted-deliverables",
    };
    const html = renderToStaticMarkup(<DeliverableProgress stats={stats} />);
    expect(html).toContain("暂无正式提交成果");
    expect(html).not.toContain("通过率");
    expect(html).not.toContain("100%");
  });

  it("有正式成果时分开显示通过/待验收/需修改，归档项目带标记", () => {
    const stats: ProjectDeliverableStats = {
      projectId: PROJECT_ID,
      projectStatus: "archived",
      byStatus: { submitted: 1, changes_requested: 1, approved: 1 },
      total: 3,
      approvedRatio: 1 / 3,
      scope: "current-submitted-deliverables",
    };
    const html = renderToStaticMarkup(<DeliverableProgress stats={stats} />);
    expect(html).toContain("1 通过");
    expect(html).toContain("已通过 1");
    expect(html).toContain("待验收 1");
    expect(html).toContain("需修改 1");
    expect(html).toContain("通过率 33%");
    expect(html).toContain("已归档");
    expect(html).toContain("不含初版草稿和历史版本");
  });
});

describe("ReviewForm", () => {
  it("针对具体版本渲染两个决定与意见框", () => {
    const html = renderToStaticMarkup(
      <ReviewForm
        projectId={PROJECT_ID}
        deliverableId={DELIVERABLE_ID}
        versionId="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
        versionNumber={2}
        requestId={REQUEST_ID}
      />,
    );
    expect(html).toContain("教师验收 · 当前待审第 2 版");
    expect(html).toContain('value="approved"');
    expect(html).toContain('value="changes_requested"');
    expect(html).toContain('id="review-comment"');
    expect(html).toContain("确认通过");
    expect(html).toContain("旧版本与当时的意见都会保留");
  });
});

describe("StartRevisionButton", () => {
  it("需修改时提示按意见修改", () => {
    const html = renderToStaticMarkup(
      <StartRevisionButton
        projectId={PROJECT_ID}
        deliverableId={DELIVERABLE_ID}
        revision={3}
        requestId={REQUEST_ID}
        status="changes_requested"
      />,
    );
    expect(html).toContain("开始修改（新建草稿）");
    expect(html).toContain("按教师意见修改");
  });

  it("已通过时说明旧版仍有效", () => {
    const html = renderToStaticMarkup(
      <StartRevisionButton
        projectId={PROJECT_ID}
        deliverableId={DELIVERABLE_ID}
        revision={4}
        requestId={REQUEST_ID}
        status="approved"
      />,
    );
    expect(html).toContain("旧版本仍然有效");
  });
});

describe("FeedbackTaskForm", () => {
  const base = {
    projectId: PROJECT_ID,
    feedbackId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    versionLabel: "第 1 版",
    defaultTitle: "按教师意见修改：用户调研报告",
    defaultDescription: "请补充三场访谈记录。",
    members: [{ id: "11111111-1111-4111-8111-111111111111", name: "张同学" }],
    requestId: REQUEST_ID,
  };

  it("教师仅可查看已关联任务，不显示创建任务入口", () => {
    expect(renderToStaticMarkup(<FeedbackTaskForm {...base} canCreate={false} existingTaskId={null} existingTaskDeleted={false} />)).toBe("");
    expect(renderToStaticMarkup(<FeedbackTaskForm {...base} canCreate={false} existingTaskId={TASK_ID} existingTaskDeleted={false} />)).toContain("打开任务查看来源反馈");
  });

  it("还没有关联任务时给「转为修改任务」入口，不直接建任务", () => {
    const html = renderToStaticMarkup(
      <FeedbackTaskForm {...base} existingTaskId={null} existingTaskDeleted={false} />,
    );
    expect(html).toContain("将这条意见转为修改任务");
    expect(html).not.toContain("已创建修改任务");
    // 默认收起：负责人/截止日等字段要等用户点开确认后才出现
    expect(html).not.toContain("确认创建修改任务");
  });

  it("已有关联任务时给任务入口，不重复创建", () => {
    const html = renderToStaticMarkup(
      <FeedbackTaskForm
        {...base}
        existingTaskId={TASK_ID}
        existingTaskDeleted={false}
      />,
    );
    expect(html).toContain("已创建修改任务");
    expect(html).toContain(`/projects/${PROJECT_ID}?task=${TASK_ID}`);
    expect(html).toContain("同一反馈只会创建一个修改任务");
    expect(html).not.toContain("将这条意见转为修改任务");
  });

  it("关联任务已删除时给占位，不自动补建", () => {
    const html = renderToStaticMarkup(
      <FeedbackTaskForm {...base} existingTaskId={null} existingTaskDeleted />,
    );
    expect(html).toContain("原修改任务已删除");
    expect(html).not.toContain("将这条意见转为修改任务");
  });
});
