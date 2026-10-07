import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getProjectForUser } from "@/lib/project";
import { listProjectDeliverables } from "@/lib/deliverable";
import { DELIVERABLE_LABELS } from "@/lib/deliverable-labels";
import { StatusBadge } from "@/components/ui/StatusBadge";
export default async function DeliverablesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!z.uuid().safeParse(projectId).success) notFound();
  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();
  const items = await listProjectDeliverables(session.user.id, projectId);
  return <main className="mx-auto max-w-4xl space-y-6 py-8">
    <nav className="flex flex-wrap gap-4 text-sm text-primary">
      <Link href={`/projects/${projectId}/overview`}>项目概览</Link>
      <Link href={`/projects/${projectId}`}>任务看板</Link>
    </nav>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="font-display text-2xl font-semibold">阶段成果</h1>
      {access.role !== "teacher" && <Link href={`/projects/${projectId}/deliverables/new`} className="ac-btn">新建成果</Link>}
    </div>
    {!items.length && <p className="ac-card p-8 text-center text-sm text-ink-soft">暂无可查看的成果。</p>}
    <ul className="space-y-3">{items.map((item) => <li key={item.id} className="ac-card flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="min-w-0 flex-1">
        <Link href={`/projects/${projectId}/deliverables/${item.id}`} className="break-words font-medium text-ink hover:text-primary hover:underline">{item.title}</Link>
        <p className="mt-1 text-sm text-ink-soft">{DELIVERABLE_LABELS[item.type]}</p>
      </div>
      <StatusBadge status={item.status} />
    </li>)}</ul>
  </main>;
}
