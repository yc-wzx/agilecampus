import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getProjectForUser, listProjectMilestones } from "@/lib/project";
import { DeliverableEditor } from "../editor";
export default async function NewDeliverablePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!z.uuid().safeParse(projectId).success) notFound();
  const access = await getProjectForUser(session.user.id, projectId);
  if (!access || access.role === "teacher") notFound();
  const milestones = await listProjectMilestones(session.user.id, projectId);
  return <main className="mx-auto max-w-3xl space-y-5 py-8">
    <Link className="text-sm text-primary" href={`/projects/${projectId}/deliverables`}>← 返回成果列表</Link>
    <h1 className="font-display text-2xl font-semibold">新建成果</h1>
    <DeliverableEditor projectId={projectId} requestId={randomUUID()} milestones={milestones} />
  </main>;
}
