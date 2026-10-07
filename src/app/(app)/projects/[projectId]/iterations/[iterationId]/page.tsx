import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getProjectForUser } from "@/lib/project";
import { NotFoundError, ForbiddenError } from "@/lib/errors";
import { getIterationDetail, getIterationHistory, listProjectIterations } from "@/lib/iteration";
import { listBacklog } from "@/lib/task-contract";
import { IterationDetailView } from "./iteration-detail-view";

// C / P0-P1：单轮迭代页。任务增删、开始、结束（含未完成去向）、历史快照与复盘都在这里。
//
// 路由不是可选的：Iteration / MyActiveIteration 的 sourceHref 冻结为
// `/projects/{projectId}/iterations/{iterationId}`，这个页面存在，那些链接才不是死链。

export default async function IterationDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; iterationId: string }>;
}) {
  const { projectId, iterationId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(iterationId).success) {
    notFound();
  }

  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();
  const { project, role } = access;
  const actorId = session.user.id;

  // 读服务对「不存在」抛 NotFoundError，页面只关心 404。
  const detail = await getIterationDetail(actorId, projectId, iterationId).catch((error: unknown) => { if (error instanceof NotFoundError || error instanceof ForbiddenError) return null; throw error; });
  if (!detail) notFound();

  const locked = detail.iteration.status === "completed";

  const [backlog, history, iterations] = await Promise.all([
    // 已结束的轮不再需要往里面加任务，省一次查询。
    locked ? Promise.resolve({ items: [] }) : listBacklog(actorId, projectId, { limit: 100 }),
    locked
      ? getIterationHistory(actorId, projectId, iterationId).catch(() => null)
      : Promise.resolve(null),
    // 只为了把「转入的哪一轮」显示成人看得懂的名字。
    listProjectIterations(actorId, projectId, { limit: 100 }),
  ]);
  const iterationNames = Object.fromEntries(iterations.items.map((it) => [it.id, it.name]));

  return (
    <main className="mx-auto max-w-4xl space-y-8 py-8 [overflow-wrap:anywhere]">
      <header>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 max-w-full">
            <a
              href={`/projects/${projectId}/iterations`}
              className="text-xs text-ink-faint hover:underline"
            >
              ← 迭代总览
            </a>
            <h1 className="mt-1 min-w-0 break-words font-display text-2xl font-semibold text-ink">
              {detail.iteration.name}
            </h1>
            <p className="mt-1 text-xs text-ink-faint">{project.name}</p>
          </div>
          <nav className="flex flex-wrap items-center gap-2 whitespace-nowrap" aria-label="项目页面">
            <a href={`/projects/${projectId}`} className="ac-btn-ghost">
              看板
            </a>
            <a href={`/projects/${projectId}/iterations`} className="ac-btn-ghost">
              迭代
            </a>
            <a href={`/projects/${projectId}/overview`} className="ac-btn-ghost">
              概览
            </a>
          </nav>
        </div>
      </header>

      <IterationDetailView
        projectId={projectId}
        canWrite={role === "admin" || role === "student"}
        detail={detail}
        backlog={backlog.items}
        history={history}
        iterationNames={iterationNames}
      />
    </main>
  );
}
