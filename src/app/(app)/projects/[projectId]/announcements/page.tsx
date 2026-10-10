import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getProjectForUser } from "@/lib/project";
import { listProjectAnnouncements } from "@/lib/announcement";
import { AnnouncementManager } from "@/components/announcement-manager";
import { AnnouncementEditor } from "@/components/announcements/editor";
import { ProjectNav } from "@/components/projects/project-nav";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ offset?: string }>;
}) {
  const { projectId } = await params;
  if (!z.uuid().safeParse(projectId).success) notFound();
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();
  const query = await searchParams,
    offset = Math.max(0, Number(query.offset) || 0);
  const page = await listProjectAnnouncements(session.user.id, projectId, {
    offset,
    limit: 20,
    includeWithdrawn: access.role !== "student",
  });
  return (
    <main className="mx-auto max-w-4xl space-y-5 py-8 [overflow-wrap:anywhere]">
      <ProjectNav projectId={projectId} current="announcements" />
      <h1 className="font-display text-2xl font-semibold">
        {access.project.name} · 项目公告
      </h1>
      <AnnouncementManager projectId={projectId} />
      {page.items.length === 0 && <p className="ac-card p-5">暂无公告</p>}
      {page.items.map((item) => (
        <article
          id={`announcement-${item.id}`}
          key={item.id}
          className="ac-card space-y-3 p-5"
        >
          <div className="flex flex-wrap gap-3">
            <h2 className="font-semibold">{item.title}</h2>
            {item.isPinned && <span className="ac-badge">置顶</span>}
            {item.status === "withdrawn" && (
              <span className="ac-badge">已撤下（仅管理者可见）</span>
            )}
          </div>
          <p className="whitespace-pre-wrap text-sm">{item.body}</p>
          <time className="text-xs text-ink-soft">
            {new Date(item.publishedAt).toLocaleString("zh-CN", {
              timeZone: "Asia/Shanghai",
            })}
          </time>
          {access.role !== "student" && (
            <AnnouncementEditor
              key={`${item.id}:${item.revision}`}
              projectId={projectId}
              item={item}
            />
          )}
        </article>
      ))}
      <nav className="flex gap-3 text-sm">
        {offset > 0 && (
          <Link href={`?offset=${Math.max(0, offset - 20)}`}>上一页</Link>
        )}
        {page.nextOffset !== null && (
          <Link href={`?offset=${page.nextOffset}`}>下一页</Link>
        )}
        <span>共 {page.total} 条</span>
      </nav>
    </main>
  );
}
