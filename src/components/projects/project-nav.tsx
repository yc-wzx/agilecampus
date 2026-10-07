import Link from "next/link";

/**
 * 项目内部导航（B 主写，第 9.10 节：概览 / 任务 / 迭代 / 成果能进入，旧甘特与 AI 入口仍可用）。
 *
 * 迭代入口由 C 交付 `/projects/[projectId]/iterations` 后打开：
 * 在那之前不渲染该项，避免做出打不开的假按钮（P4：不建空页面、假按钮）。
 */
const ITERATION_ENTRY_ENABLED = true;

export type ProjectNavKey =
  | "overview"
  | "tasks"
  | "iterations"
  | "deliverables"
  | "timeline";

type NavItem = {
  key: ProjectNavKey;
  label: string;
  href: string;
  enabled: boolean;
};

export function ProjectNav({
  projectId,
  current,
}: {
  projectId: string;
  current: ProjectNavKey;
}) {
  const items: NavItem[] = [
    {
      key: "overview",
      label: "概览",
      href: `/projects/${projectId}/overview`,
      enabled: true,
    },
    { key: "tasks", label: "任务", href: `/projects/${projectId}`, enabled: true },
    {
      key: "iterations",
      label: "迭代",
      href: `/projects/${projectId}/iterations`,
      enabled: ITERATION_ENTRY_ENABLED,
    },
    {
      key: "deliverables",
      label: "成果",
      href: `/projects/${projectId}/deliverables`,
      enabled: true,
    },
    {
      key: "timeline",
      label: "时间线",
      href: `/projects/${projectId}/timeline`,
      enabled: true,
    },
  ];

  return (
    <nav aria-label="项目内部导航" className="flex flex-wrap items-center gap-1.5">
      {items
        .filter((item) => item.enabled)
        .map((item) => {
          const active = item.key === current;
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "ac-btn-ghost border-primary bg-primary-soft font-semibold text-primary"
                  : "ac-btn-ghost"
              }
            >
              {item.label}
            </Link>
          );
        })}
    </nav>
  );
}
