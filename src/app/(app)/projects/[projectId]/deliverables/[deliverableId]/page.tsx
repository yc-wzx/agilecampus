import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getDeliverableDetail } from "@/lib/deliverable";
import { listProjectMilestones } from "@/lib/project";
import { ForbiddenError } from "@/lib/errors";
import { DELIVERABLE_LABELS } from "@/lib/deliverable-labels";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DeliverableEditor } from "../editor";
import { SubmitButton } from "../submit-button";
export default async function DeliverablePage({ params }: { params: Promise<{ projectId: string; deliverableId: string }> }) {
  const { projectId, deliverableId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (![projectId, deliverableId].every((id) => z.uuid().safeParse(id).success)) notFound();
  let detail;
  try { detail = await getDeliverableDetail(session.user.id, projectId, deliverableId); }
  catch (error) { if (error instanceof ForbiddenError) notFound(); throw error; }
  const item = detail.deliverable;
  const milestones = item.allowedActions.edit ? await listProjectMilestones(session.user.id, projectId) : [];
  const date = (value: Date) => value.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  return <main className="mx-auto max-w-3xl space-y-5 py-8">
    <Link className="text-sm text-primary" href={`/projects/${projectId}/deliverables`}>← 返回成果列表</Link>
    <header className="space-y-2"><h1 className="break-words font-display text-2xl font-semibold">{item.title}</h1><StatusBadge status={item.status} /></header>
    <section className="ac-card space-y-3 p-4">
      <h2 className="font-medium">{item.status === "draft" ? "当前草稿" : "当前正式成果"}</h2>
      <p className="text-sm">类型：{DELIVERABLE_LABELS[item.type]}</p>
      <p className="break-words whitespace-pre-wrap text-sm">{item.description || "暂无说明"}</p>
      {item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer" className="break-all text-sm text-primary underline">查看成果链接</a> : <p className="text-sm text-ink-soft">尚未填写链接，正式提交前需要补充。</p>}
    </section>
    {item.allowedActions.edit && <section className="space-y-3">
      <h2 className="font-medium">{item.workingCopy ? "编辑新版本草稿" : "编辑草稿"}</h2>
      <DeliverableEditor key={item.revision} projectId={projectId} deliverableId={item.id} revision={item.revision} milestones={milestones} initial={item.workingCopy ?? item} />
    </section>}
    {item.allowedActions.submit && <section className="ac-card space-y-3 p-4">
      <p className="text-sm text-ink-soft">正式提交将保存版本快照，并向团队开放该版本。先保存修改，再提交。</p>
      <SubmitButton key={item.revision} projectId={projectId} deliverableId={item.id} revision={item.revision} requestId={randomUUID()} />
    </section>}
    <section className="ac-card space-y-3 p-4">
      <h2 className="font-medium">已提交版本（{detail.versions.length}）</h2>
      {!detail.versions.length && <p className="text-sm text-ink-soft">暂无已提交版本。</p>}
      {detail.versions.map((v) => <article key={v.id} className="space-y-2 border-t border-line pt-3 text-sm">
        <h3 className="break-words font-medium">第 {v.versionNumber} 版 · {v.title}</h3>
        <p className="text-ink-soft">{date(v.submittedAt)} · {DELIVERABLE_LABELS[v.type]} · {v.milestoneTitle ?? "未关联里程碑"}</p>
        <p className="break-words whitespace-pre-wrap">{v.description}</p>
        <a className="break-all text-primary underline" href={v.url} target="_blank" rel="noopener noreferrer">查看该版成果</a>
      </article>)}
    </section>
    {detail.feedback.length > 0 && <section className="ac-card space-y-3 p-4"><h2 className="font-medium">历史反馈</h2>{detail.feedback.map((f) => <article key={f.id} className="border-t border-line pt-3 text-sm"><p>对应版本：{detail.versions.find((v) => v.id === f.versionId)?.versionNumber ?? "里程碑反馈"}</p><p className="break-words whitespace-pre-wrap">{f.comment}</p></article>)}</section>}
  </main>;
}
