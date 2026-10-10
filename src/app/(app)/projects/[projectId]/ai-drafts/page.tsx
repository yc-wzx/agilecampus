import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getProjectForUser, listProjectMilestones } from "@/lib/project";
import { listTeamMembers } from "@/lib/team";
import { listBacklog } from "@/lib/task-contract";
import {
  getOrCreateScopedConversation,
  listBoundedConversationMessages,
} from "@/lib/agent/context";
import { listMyIterationDrafts } from "@/lib/agent/iteration-draft";
import { ProjectNav } from "@/components/projects/project-nav";
import {
  IterationDraftEditor,
  IterationDraftGenerator,
} from "@/components/iteration-draft-editor";
import { ChatPanel } from "../chat-panel";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { projectId } = await params,
    sp = await searchParams;
  if (!z.uuid().safeParse(projectId).success) notFound();
  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();
  const scope = sp.scope === "personal" ? "personal" : "project",
    offset = Math.max(0, Number(sp.offset) || 0),
    conversation = await getOrCreateScopedConversation(
      session.user.id,
      projectId,
      { scope },
    );
  const [history, drafts, pool, members, milestones] = await Promise.all([
    listBoundedConversationMessages(session.user.id, conversation.id, {
      beforeMessageId: z.uuid().safeParse(sp.beforeMessageId).success
        ? sp.beforeMessageId
        : undefined,
    }),
    listMyIterationDrafts(session.user.id, projectId, { offset }),
    listBacklog(session.user.id, projectId, { limit: 100 }),
    listTeamMembers(access.project.teamId),
    listProjectMilestones(session.user.id, projectId),
  ]);
  return (
    <main className="mx-auto max-w-5xl space-y-5 py-8">
      <header className="space-y-3">
        <h1 className="font-display text-2xl">
          {access.project.name} · AI 助手
        </h1>
        <ProjectNav projectId={projectId} current="ai" />
        <nav className="flex gap-3 text-sm">
          <Link
            href={`?scope=project`}
            aria-current={scope === "project" ? "page" : undefined}
          >
            项目共享会话
          </Link>
          <Link
            href={`?scope=personal`}
            aria-current={scope === "personal" ? "page" : undefined}
          >
            我的个人会话
          </Link>
          <Link href={`/projects/${projectId}/iterations`}>手动规划迭代</Link>
        </nav>
      </header>
      <ChatPanel
        key={`${conversation.id}:${sp.beforeMessageId ?? ""}`}
        projectId={projectId}
        conversationId={conversation.id}
        scope={scope}
        initialMessages={history.items
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }))}
        members={members.map((m) => ({ id: m.id, name: m.name }))}
        milestones={milestones.map((m) => ({ id: m.id, name: m.title }))}
      />
      {history.truncated && (
        <p className="text-sm text-ink-soft">本页长消息已截断。</p>
      )}
      <nav className="flex gap-3 text-sm">
        {history.nextBeforeMessageId && (
          <Link
            href={`?scope=${scope}&beforeMessageId=${history.nextBeforeMessageId}`}
          >
            更早的 20 条消息
          </Link>
        )}
        {sp.beforeMessageId && <Link href={`?scope=${scope}`}>最新消息</Link>}
      </nav>
      {access.role !== "teacher" && (
        <IterationDraftGenerator
          projectId={projectId}
          conversationId={conversation.id}
        />
      )}
      <h2 className="font-semibold">我的迭代草案</h2>
      <p className="text-xs text-ink-soft">
        草案仅本人可读。确认后的迭代对当前项目成员可读。
      </p>
      {drafts.items.map((draft) => (
        <IterationDraftEditor
          key={`${draft.id}:${draft.revision}:${draft.status}`}
          projectId={projectId}
          draft={draft}
          candidates={pool.items.map((t) => ({ id: t.id, title: t.title }))}
        />
      ))}
      {!drafts.items.length && (
        <p className="text-sm text-ink-soft">暂无草案</p>
      )}
      <nav className="flex gap-3">
        {offset > 0 && (
          <Link href={`?scope=${scope}&offset=${Math.max(0, offset - 20)}`}>
            上一页
          </Link>
        )}
        {drafts.nextOffset !== null && (
          <Link href={`?scope=${scope}&offset=${drafts.nextOffset}`}>
            下一页
          </Link>
        )}
      </nav>
    </main>
  );
}
