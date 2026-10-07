import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getProjectForUser } from "@/lib/project";
import { getCurrentIteration, getIterationDetail, listProjectIterations } from "@/lib/iteration";
import { listBacklog } from "@/lib/task-contract";
import { IterationsView } from "./iterations-view";

// C / P0：迭代总览页。列表、建轮、任务池排序都在这里；单轮的任务与复盘在 [iterationId] 页。

export default async function IterationsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!z.uuid().safeParse(projectId).success) notFound();

  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();
  const { project, role } = access;
  const actorId = session.user.id;

  const [iterations, current, backlog] = await Promise.all([
    listProjectIterations(actorId, projectId, { limit: 100 }),
    getCurrentIteration(actorId, projectId),
    listBacklog(actorId, projectId, { limit: 100 }),
  ]);
  const currentDetail = current ? await getIterationDetail(actorId, projectId, current.id) : null;

  return (
    <main className="mx-auto max-w-4xl space-y-8 py-8">
      <header>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <a href={`/projects/${projectId}`} className="text-xs text-ink-faint hover:underline">
              ← 回到看板
            </a>
            <h1 className="mt-1 min-w-0 break-words font-display text-2xl font-semibold text-ink">
              {project.name} · 迭代
            </h1>
          </div>
          <nav className="flex flex-wrap items-center gap-2 whitespace-nowrap" aria-label="项目页面">
            <a href={`/projects/${projectId}`} className="ac-btn-ghost">
              看板
            </a>
            <a href={`/projects/${projectId}/overview`} className="ac-btn-ghost">
              概览
            </a>
            <a href={`/projects/${projectId}/deliverables`} className="ac-btn-ghost">
              阶段成果
            </a>
            <a href={`/projects/${projectId}/timeline`} className="ac-btn-ghost">
              时间线
            </a>
          </nav>
        </div>
      </header>

      <IterationsView
        projectId={projectId}
        canWrite={role === "admin" || role === "student"}
        iterations={iterations.items}
        current={current}
        currentTasks={currentDetail ? currentDetail.tasks : []}
        backlog={backlog.items}
      />
    </main>
  );
}
