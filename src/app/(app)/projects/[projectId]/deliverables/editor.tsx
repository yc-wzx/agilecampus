"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createDeliverableDraftAction, updateDeliverableDraftAction } from "./actions";
import { DELIVERABLE_LABELS } from "@/lib/deliverable-labels";
import type { DeliverableType } from "@/db/schema";

type Content = { title: string; type: DeliverableType; url: string; description: string; milestoneId: string | null };
export function DeliverableEditor({ projectId, requestId, initial, deliverableId, revision, milestones }: {
  projectId: string; requestId?: string; initial?: Content; deliverableId?: string; revision?: number;
  milestones: { id: string; title: string }[];
}) {
  const [values, setValues] = useState<Content>({
    title: initial?.title ?? "", type: initial?.type ?? "report", url: initial?.url ?? "",
    description: initial?.description ?? "", milestoneId: initial?.milestoneId ?? null,
  });
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const locked = useRef(false), request = useRef(requestId);
  const router = useRouter();
  return <form className="ac-card space-y-4 p-4 sm:p-6" onSubmit={(event) => {
    event.preventDefault();
    if (locked.current) return;
    locked.current = true; setError("");
    startTransition(async () => {
      try {
        const result = deliverableId
          ? await updateDeliverableDraftAction(projectId, deliverableId, { ...values, expectedRevision: revision! })
          : await createDeliverableDraftAction(projectId, { ...values, requestId: request.current! });
        if (!result.ok) { setError(result.error); return; }
        router.push(`/projects/${projectId}/deliverables/${result.data.id}`); router.refresh();
      } catch { setError("未能确认保存结果，请保持当前内容并重试；如提示冲突，请刷新核对。"); }
      finally { locked.current = false; }
    });
  }}>
    <fieldset disabled={pending} className="space-y-4">
      <label className="block text-sm">成果标题<input name="title" required maxLength={200} className="ac-field" value={values.title} onChange={(e) => setValues({ ...values, title: e.target.value })} /></label>
      <label className="block text-sm">成果类型<select name="type" className="ac-field" value={values.type} onChange={(e) => setValues({ ...values, type: e.target.value as DeliverableType })}>{Object.entries(DELIVERABLE_LABELS).map(([type, label]) => <option key={type} value={type}>{label}</option>)}</select></label>
      <label className="block text-sm">成果链接（草稿可留空）<input name="url" type="url" maxLength={2048} className="ac-field" value={values.url} onChange={(e) => setValues({ ...values, url: e.target.value })} placeholder="https://" /></label>
      <label className="block text-sm">成果说明<textarea name="description" rows={4} maxLength={10000} className="ac-field" value={values.description} onChange={(e) => setValues({ ...values, description: e.target.value })} /></label>
      <label className="block text-sm">关联里程碑<select name="milestoneId" className="ac-field" value={values.milestoneId ?? ""} onChange={(e) => setValues({ ...values, milestoneId: e.target.value || null })}>
        <option value="">不关联</option>{milestones.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
      </select></label>
      {values.milestoneId && !milestones.some((m) => m.id === values.milestoneId) && <p className="text-sm text-high">原里程碑已不可用，请重新选择。</p>}
      <button className="ac-btn">{pending ? "保存中…" : "保存草稿"}</button>
    </fieldset>
    {error && <p role="alert" className="text-sm text-high">{error}</p>}
    <p className="text-xs text-ink-soft">保存草稿后，在成果详情确认内容并正式提交。这里仅保存外部链接。</p>
  </form>;
}
