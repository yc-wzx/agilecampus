import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { getProjectForUser, getProjectDetail } from "@/lib/project";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getProjectDeliverableStats } from "@/lib/deliverable-reporting";

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!z.string().uuid().safeParse(projectId).success) notFound();

  // 1. 权限校验：确保用户是该项目的团队成员
  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();

  // 2. 获取项目详情（包含里程碑和任务统计）
  const detail = await getProjectDetail(session.user.id, projectId);
  const { project, milestones, taskTotal, byStatus } = detail;

  const stats = await getProjectDeliverableStats(session.user.id, projectId);

  return (
    <main className="mx-auto max-w-4xl space-y-6 py-8">
      <nav className="flex flex-wrap gap-4 text-sm text-primary">
        <Link href={`/projects/${projectId}`}>任务看板</Link>
        <Link href={`/projects/${projectId}/deliverables`}>阶段成果</Link>
        <Link href={`/projects/${projectId}/timeline`}>时间线</Link>
      </nav>
      {/* 项目头部 */}
      <section className="ac-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="break-words font-display text-2xl font-semibold text-ink">
              {project.name}
            </h1>
            {project.description && (
              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-ink-soft">
                {project.description}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-ink-faint">
              <span>
                {project.startDate ?? "未设置开始"} ~ {project.endDate ?? "未设置结束"}
              </span>
              <StatusBadge status={project.status} />
            </div>
          </div>
        </div>
      </section>

      {/* 进度统计 */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="ac-card p-5">
          <h2 className="text-sm text-ink-soft">任务进展</h2>
          <p className="mt-2 font-display text-2xl font-semibold text-ink">
            {byStatus.done}/{taskTotal}
          </p>
          <p className="mt-1 text-xs text-ink-faint">
            已完成任务数 / 全部任务数（含子任务）；{taskTotal === 0 ? "暂无任务" : "按任务条目计数"}
          </p>
        </div>
        <div className="ac-card p-5">
          <h2 className="text-sm text-ink-soft">成果验收</h2>
          <p className="mt-2 font-display text-2xl font-semibold text-ink">
            {stats.byStatus.approved} 通过 · {stats.byStatus.submitted} 待验收 · {stats.byStatus.changes_requested} 需修改
          </p>
          <p className="mt-1 text-xs text-ink-faint">
            {stats.total === 0 ? "暂无正式提交成果" : "仅统计当前正式提交的成果，不含草稿和历史版本"}
          </p>
        </div>
      </section>

      {/* 里程碑列表 */}
      <section className="ac-card p-6">
        <h2 className="text-sm font-medium text-ink-soft">里程碑</h2>
        {milestones.length === 0 ? (
          <p className="mt-3 text-sm text-ink-faint">暂无里程碑</p>
        ) : (
          <ul className="mt-3 divide-y divide-sunken">
            {milestones.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span className="min-w-0 flex-1 break-words text-sm text-ink">{m.title}</span>
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
