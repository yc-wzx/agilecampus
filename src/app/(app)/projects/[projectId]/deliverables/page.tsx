import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ProjectNav } from "@/components/projects/project-nav";
import { auth } from "@/lib/auth";
import { listProjectDeliverables } from "@/lib/deliverable";
import { DELIVERABLE_LABELS } from "@/lib/deliverable-labels";
import { getProjectForUser } from "@/lib/project";

/** 列表项的状态说明：把 D 的状态机翻译成学生看得懂的一句话。 */
const STATUS_HINT: Record<string, string> = {
  draft: "草稿，尚未正式提交",
  submitted: "已正式提交，等待教师验收",
  approved: "教师已通过",
  changes_requested: "教师已退回，请查看意见后重新提交",
};

export default async function DeliverablesPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!z.uuid().safeParse(projectId).success) notFound();

  // 非团队成员一律 notFound，不泄露项目是否存在
  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();

  const items = await listProjectDeliverables(session.user.id, projectId);
  // 教师只验收，不代学生提交成果（服务端同样会拒绝）
  const canCreate = access.role === "admin" || access.role === "student";

  return (
    <main className="mx-auto max-w-4xl space-y-6 py-8">
      <ProjectNav projectId={projectId} current="deliverables" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-ink">阶段成果</h1>
        <div className="flex flex-wrap items-center gap-2">
          {/* 答辩/过程证据：相关页面的操作入口，不增加一级菜单 */}
          <Link
            href={`/projects/${projectId}/evidence`}
            className="ac-btn-ghost shrink-0"
          >
            成果证据
          </Link>
          {canCreate && (
            <Link
              href={`/projects/${projectId}/deliverables/new`}
              className="ac-btn shrink-0"
            >
              新建成果
            </Link>
          )}
        </div>
      </div>

      <p className="text-xs text-ink-faint">
        只保存外部链接（报告 / PPT / 视频 / 问卷 / 代码 / 原型 / 演示 / 其他），不上传本地文件；
        草稿仅本人和团队管理员可见，正式提交后对本项目成员开放。
      </p>

      {items.length === 0 ? (
        <div className="ac-card p-8 text-center text-sm text-ink-soft">
          <p>暂无可查看的成果。</p>
          <p className="mt-2 text-xs text-ink-faint">
            {canCreate
              ? "点击右上角「新建成果」保存一个链接草稿，确认内容后再正式提交。"
              : "教师可在这里查看并验收学生正式提交的成果。"}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li
              key={item.id}
              className="ac-card flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <div className="min-w-0 flex-1">
                <Link
                  href={`/projects/${projectId}/deliverables/${item.id}`}
                  className="break-words font-medium text-ink hover:text-primary hover:underline"
                >
                  {item.title}
                </Link>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-faint">
                  <span>{DELIVERABLE_LABELS[item.type]}</span>
                  <span aria-hidden>·</span>
                  <span>{STATUS_HINT[item.status] ?? item.status}</span>
                  {item.workingCopy && (
                    <>
                      <span aria-hidden>·</span>
                      <span>有未提交的新版本草稿</span>
                    </>
                  )}
                </p>
              </div>
              <StatusBadge status={item.status} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
