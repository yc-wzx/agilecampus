import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { conversations, messages as messagesTable } from "@/db/schema";
import { getProjectForUser, listProjectMilestones } from "@/lib/project";
import { listTeamMembers } from "@/lib/team";
import { listProjectTasks, listProjectDependencies } from "@/lib/task";
import { getTaskPanelData } from "@/lib/task-contract";
import { AppError } from "@/lib/errors";
import type { TaskPanelState } from "@/components/tasks/task-detail-panel";
import { listTeamLabels } from "@/lib/label";
import { parseFilters, applyFilters } from "@/lib/board-filters";
import { MilestoneSection } from "./milestone-section";
import { NewTaskForm } from "./new-task-form";
import { Board } from "./board";
import { ChatPanel } from "./chat-panel";
import { FilterBar } from "./filter-bar";

/**
 * 解析 ?task= 并取回侧边栏数据。无参数或参数非法时返回 null（面板不打开）。
 * 取数失败翻成面板内的错误提示，不打断整页。
 */
async function loadTaskPanel(
  actorId: string,
  projectId: string,
  raw: string | string[] | undefined,
): Promise<TaskPanelState | null> {
  if (typeof raw !== "string" || !z.uuid().safeParse(raw).success) return null;
  try {
    return { taskId: raw, data: await getTaskPanelData(actorId, projectId, raw), error: null };
  } catch (e) {
    const message = e instanceof AppError ? e.message : "任务详情暂时不可用";
    return { taskId: raw, data: null, error: message };
  }
}

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId } = await params;
  const sp = await searchParams;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!z.uuid().safeParse(projectId).success) notFound();

  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();
  const { project, role } = access;

  const [projectMilestones, projectTasks, members, dependencies, teamLabels] = await Promise.all([
    listProjectMilestones(session.user.id, projectId),
    listProjectTasks(session.user.id, projectId),
    listTeamMembers(project.teamId),
    listProjectDependencies(session.user.id, projectId),
    listTeamLabels(session.user.id, project.teamId),
  ]);

  const filters = parseFilters(
    new URLSearchParams(
      Object.entries(sp).flatMap(([k, v]) =>
        typeof v === "string" ? [[k, v] as [string, string]] : [],
      ),
    ),
  );
  // 「今日」在服务端按本地时区取 YYYY-MM-DD，随后仅作字符串比较
  const today = new Date().toLocaleDateString("sv-SE");
  const visibleTasks = applyFilters(projectTasks, filters, today);

  const canWrite = role === "admin" || role === "student";
  const isAdmin = role === "admin";

  // 详情侧边栏由 URL 的 ?task= 驱动：服务端在这里取数并鉴权，客户端只负责渲染。
  // 取不到（越权 / 已删除）不抛 404 整页，而是把错误交给面板显示——用户还在看板上，
  // 不该因为一个失效的深链就丢掉整页上下文。
  const panel = await loadTaskPanel(session.user.id, projectId, sp.task);

  const [latestConv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.projectId, projectId))
    .orderBy(desc(conversations.createdAt))
    .limit(1);

  const history = latestConv
    ? await db
        .select({ role: messagesTable.role, content: messagesTable.content })
        .from(messagesTable)
        .where(eq(messagesTable.conversationId, latestConv.id))
        .orderBy(messagesTable.createdAt)
    : [];

  const initialMessages = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  return (
    <main className="mx-auto max-w-5xl space-y-8 py-8">
      <header>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="min-w-0 break-words font-display text-2xl font-semibold text-ink">{project.name}</h1>
          <nav className="flex flex-wrap items-center gap-2 whitespace-nowrap" aria-label="项目页面">
            <a href={`/projects/${projectId}/overview`} className="ac-btn-ghost">概览</a>
            <a href={`/projects/${projectId}/deliverables`} className="ac-btn-ghost">阶段成果</a>
            <a href={`/projects/${projectId}/timeline`} className="ac-btn-ghost">时间线</a>
          </nav>
        </div>
        {project.description && (
          <p className="mt-1 text-sm text-ink-soft">{project.description}</p>
        )}
        <p className="mt-1 text-xs text-ink-faint">
          {project.startDate ?? "?"} ~ {project.endDate ?? "?"} · {project.status}
        </p>
      </header>

      <MilestoneSection
        projectId={projectId}
        milestones={projectMilestones}
        isAdmin={isAdmin}
      />

      <section className="space-y-3">
        <h2 className="font-medium text-ink">看板</h2>
        <FilterBar
          members={members.map((m) => ({ id: m.id, name: m.name }))}
          milestones={projectMilestones.map((m) => ({ id: m.id, name: m.title }))}
          labels={teamLabels.map((l) => ({ id: l.id, name: l.name }))}
          visible={visibleTasks.length}
          total={projectTasks.length}
        />
        <Board
          projectId={projectId}
          groupBy={filters.group}
          tasks={visibleTasks.map((t) => ({
            id: t.id,
            title: t.title,
            description: t.description,
            completionNote: t.completionNote,
            status: t.status,
            priority: t.priority,
            startDate: t.startDate,
            dueDate: t.dueDate,
            assigneeName: t.assigneeName,
            assigneeId: t.assigneeId,
            milestoneId: t.milestoneId,
            labels: t.labels,
          }))}
          canWrite={canWrite}
          members={members}
          milestones={projectMilestones.map((m) => ({ id: m.id, name: m.title }))}
          allTasks={projectTasks.map((t) => ({ id: t.id, title: t.title }))}
          allLabels={teamLabels.map((l) => ({ id: l.id, name: l.name }))}
          dependencies={dependencies}
          panel={panel}
        />
      </section>

      <ChatPanel
        projectId={projectId}
        initialMessages={initialMessages}
        members={members}
        milestones={projectMilestones.map((m) => ({ id: m.id, name: m.title }))}
      />

      {canWrite && (
        <NewTaskForm
          projectId={projectId}
          members={members}
          milestones={projectMilestones.map((m) => ({ id: m.id, title: m.title }))}
        />
      )}
    </main>
  );
}
