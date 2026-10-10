import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { listTeacherProjectOverview } from "@/lib/workspace-summary";
import { TeacherProjectCard } from "@/components/projects/teacher-project-card";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string; archived?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const query = await searchParams;
  const offset = Math.max(0, Number(query.offset) || 0),
    includeArchived = query.archived === "true";
  const page = await listTeacherProjectOverview(session.user.id, {
    offset,
    limit: 12,
    includeArchived,
  });
  const href = (n: number) =>
    `/teacher?offset=${n}&archived=${includeArchived}`;
  return (
    <main className="mx-auto max-w-5xl space-y-5 py-8 [overflow-wrap:anywhere]">
      <h1 className="font-display text-2xl font-semibold">教师项目总览</h1>
      <Link
        href={`/teacher?archived=${!includeArchived}`}
        className="text-sm text-primary underline"
      >
        {includeArchived ? "只看活跃项目" : "包含归档项目"}
      </Link>
      <p className="text-sm text-ink-soft">
        仅显示当前担任教师或管理员的团队项目。风险提供事实来源，不用于自动评分。
      </p>
      {page.total === 0 && <p className="ac-card p-5">暂无可查看的教学项目</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {page.items.map((item) => (
          <TeacherProjectCard key={item.projectId} item={item} />
        ))}
      </div>
      <nav className="flex gap-4 text-sm">
        {offset > 0 && (
          <Link href={href(Math.max(0, offset - 12))}>上一页</Link>
        )}
        {page.nextOffset !== null && (
          <Link href={href(page.nextOffset)}>下一页</Link>
        )}
        <span>共 {page.total} 个项目</span>
      </nav>
    </main>
  );
}
