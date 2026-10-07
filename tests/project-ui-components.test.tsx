import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SetupStep } from "@/lib/project-setup-steps";
import { SetupGuide } from "@/components/projects/setup-guide";
import { ProjectNav } from "@/components/projects/project-nav";

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

const GOAL_STEP: SetupStep = {
  key: "goal",
  label: "写下项目简介 / 目标",
  done: false,
  hint: "让成员知道这个项目要做什么",
};
const MILESTONE_STEP: SetupStep = {
  key: "milestone",
  label: "添加里程碑",
  done: false,
  hint: "把阶段目标排进时间线",
  href: `/projects/${PROJECT_ID}`,
};

describe("SetupGuide", () => {
  it("全部完成时不渲染任何东西", () => {
    const html = renderToStaticMarkup(
      <SetupGuide steps={[{ ...MILESTONE_STEP, done: true }]} />,
    );
    expect(html).toBe("");
  });

  it("只给有真实入口的未完成步骤配「去完成」，没有入口的步骤不放假链接", () => {
    const html = renderToStaticMarkup(
      <SetupGuide
        steps={[GOAL_STEP, MILESTONE_STEP, { ...MILESTONE_STEP, key: "members", done: true }]}
      />,
    );
    expect(html).toContain("项目起步引导");
    expect(html).toContain("暂时跳过");
    // 两个未完成步骤里，只有 milestone 有 href
    expect((html.match(/去完成/g) ?? []).length).toBe(1);
    expect(html).toContain(`/projects/${PROJECT_ID}`);
  });

  it("只有一个按钮（暂时跳过），不提供“标记完成”开关", () => {
    const html = renderToStaticMarkup(<SetupGuide steps={[GOAL_STEP, MILESTONE_STEP]} />);
    expect((html.match(/<button/g) ?? []).length).toBe(1);
    expect(html).toContain("没有“标记完成”开关");
    expect(html).toContain("还剩");
  });
});

describe("ProjectNav", () => {
  it("迭代入口已打开，五个入口齐备", () => {
    const html = renderToStaticMarkup(
      <ProjectNav projectId={PROJECT_ID} current="overview" />,
    );
    for (const label of ["概览", "任务", "迭代", "成果", "时间线"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain(`/projects/${PROJECT_ID}/iterations`);
    expect(html).toContain(`/projects/${PROJECT_ID}/deliverables`);
    expect(html).toContain(`/projects/${PROJECT_ID}/timeline`);
    // 任务入口就是项目根路径
    expect(html).toContain(`href="/projects/${PROJECT_ID}"`);
  });

  it("当前页面只标记一次 aria-current", () => {
    const html = renderToStaticMarkup(
      <ProjectNav projectId={PROJECT_ID} current="deliverables" />,
    );
    expect((html.match(/aria-current="page"/g) ?? []).length).toBe(1);
  });
});
