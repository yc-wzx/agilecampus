/**
 * 空项目引导的步骤推导（纯函数，便于单测）。
 *
 * 第 9.10 节要求五项都由真实数据推导：`goalSet / milestoneCreated / taskCreated /
 * membersPresent / iterationCreated`。这里只做判断，不落库、不提供“标记完成”开关。
 *
 * 两条自我约束：
 * - 取不到的数据一律按“未完成”，不能因为接口不可用就把项目说成已完成；
 * - 没有真实入口的步骤不给 href，避免放假链接（目前只有“项目简介”没有编辑入口）。
 */
import type { CurrentIteration, ProjectTaskStats, QueryPart } from "@/contracts/p0-p2";

export type SetupStep = {
  key: "goal" | "milestone" | "task" | "members" | "iteration";
  label: string;
  done: boolean;
  hint: string;
  /** 没有真实入口时留空 */
  href?: string;
};

export type SetupStepInput = {
  projectId: string;
  teamId: string;
  description: string | null;
  milestoneCount: number;
  taskStats: QueryPart<ProjectTaskStats>;
  activeIteration: QueryPart<CurrentIteration | null>;
  memberCount: number;
};

export function deriveSetupSteps(input: SetupStepInput): SetupStep[] {
  const { projectId, teamId, description, milestoneCount, taskStats, activeIteration, memberCount } = input;
  const taskHref = `/projects/${projectId}`;

  return [
    {
      key: "goal",
      label: "写下项目简介 / 目标",
      done: Boolean(description?.trim()),
      hint: "让成员知道这个项目要做什么（目前需要团队管理员在项目设置中补充）",
    },
    {
      key: "milestone",
      label: "添加里程碑",
      done: milestoneCount > 0,
      hint: "把阶段目标排进时间线",
      href: taskHref,
    },
    {
      key: "task",
      label: "创建第一个任务",
      // 统计服务不可用时不能当作“已完成”，也不能当作“零任务”
      done: taskStats.state === "ready" && taskStats.data.total > 0,
      hint: "任务先落在任务池，再排进迭代",
      href: taskHref,
    },
    {
      key: "members",
      label: "邀请成员加入团队",
      done: memberCount >= 2,
      hint: `至少两名成员才能分工（当前 ${memberCount} 人）`,
      href: `/teams/${teamId}/members`,
    },
    {
      key: "iteration",
      label: "开始一轮迭代",
      done: activeIteration.state === "ready" && activeIteration.data !== null,
      hint: "本轮目标 + 日期 + 任务",
      href: `/projects/${projectId}/iterations`,
    },
  ];
}
