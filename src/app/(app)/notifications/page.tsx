import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getUnreadNotificationCount, listMyNotifications } from "@/lib/notifications";
import { notificationFilters } from "@/lib/notification-access";
import { ReadControl } from "./read-controls";

export default async function Page({ searchParams }: {
  searchParams: Promise<{ offset?: string; unreadOnly?: string; projectId?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const query = await searchParams;
  const filters = notificationFilters(new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined) as [string, string][]));
  const { asOf, count } = await getUnreadNotificationCount(session.user.id);
  const page = await listMyNotifications(session.user.id, filters);
  const pageHref = (offset: number) => {
    const params = new URLSearchParams({ offset: String(offset) });
    if (filters.unreadOnly) params.set("unreadOnly", "true");
    if (filters.projectId) params.set("projectId", filters.projectId);
    return `/notifications?${params}`;
  };
  const toggleParams = new URLSearchParams();
  if (filters.projectId) toggleParams.set("projectId", filters.projectId);
  if (!filters.unreadOnly) toggleParams.set("unreadOnly", "true");
  return <main className="mx-auto max-w-3xl space-y-5 [overflow-wrap:anywhere]">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="font-display text-2xl font-semibold">通知</h1>
      <span className="text-sm text-ink-soft">未读 {count} 条</span>
      <ReadControl key={`${asOf}:${filters.projectId ?? "all"}`} requestId={randomUUID()} beforeCreatedAt={asOf} projectId={filters.projectId} />
    </div>
    <Link className="text-primary underline" href={`/notifications?${toggleParams}`}>{filters.unreadOnly ? "查看全部" : "只看未读"}</Link>
    {page.items.length === 0 ? <p className="ac-card p-4 text-ink-soft">暂无通知</p> : <ul className="space-y-3">
      {page.items.map(item => <li key={item.id} className="ac-card space-y-2 p-4" data-notification-id={item.id}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">{item.title}</span>
          <span className="ac-badge">{item.readAt ? "已读" : "未读"}</span>
        </div>
        <p className="text-sm text-ink-soft">{item.summary}</p>
        <time className="text-xs text-ink-faint" dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</time>
        <div className="flex flex-wrap items-center gap-2">
          {item.sourceRef.sourceHref && <Link href={item.sourceRef.sourceHref} className="ac-btn-ghost">查看来源</Link>}
          {!item.readAt && <ReadControl id={item.id} />}
        </div>
      </li>)}
    </ul>}
    <nav aria-label="通知分页" className="flex flex-wrap gap-4 text-sm">
      {page.offset > 0 && <Link href={pageHref(Math.max(0, page.offset - page.limit))}>上一页</Link>}
      {page.nextOffset !== null && <Link href={pageHref(page.nextOffset)}>下一页</Link>}
      <span>共 {page.total} 条</span>
    </nav>
    <p className="text-xs text-ink-faint">标记已读不会完成任务，也不会消除需要修改的成果。</p>
  </main>;
}
