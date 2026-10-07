import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { ProjectNav } from "@/components/projects/project-nav";
import { auth } from "@/lib/auth";
import { getProjectForUser, listProjectMilestones } from "@/lib/project";
import { DeliverableEditor } from "../editor";

export default async function NewDeliverablePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!z.uuid().safeParse(projectId).success) notFound();

  // 教师只验收，不代学生提交成果（服务端同样拒绝）
  const access = await getProjectForUser(session.user.id, projectId);
  if (!access || access.role === "teacher") notFound();

  const milestones = await listProjectMilestones(session.user.id, projectId);

  return (
    <main className="mx-auto max-w-3xl space-y-5 py-8">
      <ProjectNav projectId={projectId} current="deliverables" />
      <Link
        className="text-sm text-primary hover:underline"
        href={`/projects/${projectId}/deliverables`}
      >
        ← 返回成果列表
      </Link>
      <h1 className="font-display text-2xl font-semibold text-ink">新建成果</h1>
      <p className="text-xs text-ink-faint">
        先保存草稿（链接可以留空），确认内容后再在详情页正式提交；正式提交会保存版本快照。
      </p>
      <DeliverableEditor
        projectId={projectId}
        requestId={randomUUID()}
        milestones={milestones}
      />
    </main>
  );
}
