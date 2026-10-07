import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ProjectNav } from "@/components/projects/project-nav";
import { DeliverableProgress, TaskProgress } from "@/components/projects/progress";
import { QueryUnavailable } from "@/components/projects/query-state";
import { SetupGuide } from "@/components/projects/setup-guide";
import { auth } from "@/lib/auth";
import { ForbiddenError } from "@/lib/errors";
import { deriveSetupSteps } from "@/lib/project-setup-steps";
import { listTeamMembers } from "@/lib/team";
import {
  getProjectOverviewSummary,
  type ProjectOverviewSummary,
} from "@/lib/project-overview-summary";

// 项目概览固定走 B-G01 聚合；单项服务故障只降级该卡片，不整页报错。
async function loadOverview(
  actorId: string,
  projectId: string,
): Promise<ProjectOverviewSummary> {
  try {
    return await getProjectOverviewSummary(actorId, projectId);
  } catch (error) {
    // 非本项目团队成员：与其它项目页一致，不泄露项目是否存在
    if (error instanceof ForbiddenError) notFound();
    throw error;
  }
}

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!z.uuid().safeParse(projectId).success) notFound();

  const summary = await loadOverview(session.user.id, projectId);
  const {
    project,
    milestones,
    taskStats,
    deliverableStats,
    activeIteration,
  } = summary;

  // 空项目引导：纯函数按真实数据推导；取不到的项保持“未完成”，不假装已完成
  const teamMembers = await listTeamMembers(project.teamId);
  const setupSteps = deriveSetupSteps({
    projectId,
    teamId: project.teamId,
    description: project.description,
    milestoneCount: milestones.length,
    taskStats,
    activeIteration,
    memberCount: teamMembers.length,
  });

  return (
    <main className="mx-auto max-w-4xl space-y-6 py-8">
      <ProjectNav projectId={projectId} current="overview" />

      {/* 项目头部：名称、简介/目标、周期、状态 */}
      <section className="ac-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="break-words font-display text-2xl font-semibold text-ink">
              {project.name}
            </h1>
            {project.description ? (
              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-ink-soft">
                {project.description}
              </p>
            ) : (
              <p className="mt-2 text-sm text-ink-faint">
                还没有项目简介，请联系团队管理员补充。
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-ink-faint">
              <span>开始 {project.startDate ?? "未设置"}</span>
              <span>结束 {project.endDate ?? "未设置"}</span>
              <StatusBadge status={project.status} />
            </div>
          </div>
          <Link href={`/projects/${projectId}`} className="ac-btn shrink-0">
            进入任务看板
          </Link>
        </div>
      </section>

      {/* 空项目引导：未完成时才出现，允许跳过 */}
      <SetupGuide steps={setupSteps} />

      {/* 双进展：任务完成情况与成果验收情况分别显示，口径不混用 */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {deliverableStats.state === "ready" ? (
          <DeliverableProgress stats={deliverableStats.data} />
        ) : (
          <QueryUnavailable
            title="成果验收"
            message={deliverableStats.message}
          />
        )}

        {taskStats.state === "ready" ? (
          <TaskProgress stats={taskStats.data} />
        ) : (
          <QueryUnavailable title="任务进展" message={taskStats.message} />
        )}
      </section>

      {/* 当前迭代：C 交付 getCurrentIteration 后自动显示真实活跃轮 */}
      {activeIteration.state === "ready" ? (
        <section className="ac-card p-5">
          <h2 className="text-sm text-ink-soft">当前迭代</h2>
          {activeIteration.data ? (
            <>
              <p className="mt-2 break-words font-medium text-ink">
                {activeIteration.data.name}
              </p>
              {activeIteration.data.goal && (
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink-soft">
                  {activeIteration.data.goal}
                </p>
              )}
              <p className="mt-2 text-xs text-ink-faint">
                {activeIteration.data.startDate} ~ {activeIteration.data.endDate} ·
                已完成 {activeIteration.data.doneCount}/
                {activeIteration.data.taskTotal}
                {activeIteration.data.taskTotal === 0 ? "（本轮暂无任务）" : ""}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-ink-soft">当前没有进行中的迭代。</p>
          )}
        </section>
      ) : (
        <QueryUnavailable
          title="当前迭代"
          message={activeIteration.message}
        />
      )}

      {/* 里程碑 */}
      <section className="ac-card p-6">
        <h2 className="text-sm font-medium text-ink-soft">里程碑</h2>
        {milestones.length === 0 ? (
          <p className="mt-3 text-sm text-ink-faint">
            暂无里程碑——团队管理员可在任务页添加。
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-sunken">
            {milestones.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <span className="min-w-0 flex-1 break-words text-sm text-ink">
                  {m.title}
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-ink-faint">
                    {m.targetDate ?? "未设置日期"}
                  </span>
                  <StatusBadge status={m.status ?? "todo"} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
