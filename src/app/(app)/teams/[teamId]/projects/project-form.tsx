"use client";

import { useActionState, useState } from "react";
import {
  PROJECT_TEMPLATES,
  type ProjectTemplateId,
} from "@/lib/project-templates";
import { createProjectAction, type FormState } from "./actions";

export function ProjectForm({
  teamId,
  requestId,
}: {
  teamId: string;
  requestId: string;
}) {
  const [templateId, setTemplateId] = useState<ProjectTemplateId>("blank");
  const template = PROJECT_TEMPLATES.find((t) => t.id === templateId)!;
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createProjectAction,
    null,
  );

  return (
    <form action={formAction} className="ac-card space-y-2 p-4">
      <h2 className="font-medium text-ink">创建项目</h2>
      <input type="hidden" name="teamId" value={teamId} />
      <input type="hidden" name="requestId" value={requestId} />
      <label className="block text-sm text-ink-soft">
        项目名称
        <input
          name="name"
          placeholder="项目名称"
          required
          maxLength={200}
          className="ac-field"
        />
      </label>
      <label className="block text-sm text-ink-soft">
        项目模板
        <select
          name="templateId"
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value as ProjectTemplateId)}
          className="ac-field"
        >
          {PROJECT_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <div className="rounded-lg bg-sunken p-3 text-sm text-ink-soft">
        <p>{template.summary}</p>
        {template.milestones.length ? (
          <ol className="mt-2 list-inside list-decimal">
            {template.milestones.map((title) => (
              <li key={title}>{title}</li>
            ))}
          </ol>
        ) : (
          <p className="mt-1">不自动生成阶段。</p>
        )}
        <p className="mt-2 text-xs">
          仅生成以上里程碑；任务和各阶段日期由团队自行安排。
        </p>
      </div>
      <textarea
        name="description"
        placeholder="项目描述（可选）"
        className="ac-field"
        rows={2}
      />
      <div className="flex gap-2">
        <label className="flex-1 text-sm text-ink-soft">
          开始日期
          <input type="date" name="startDate" className="ac-field" />
        </label>
        <label className="flex-1 text-sm text-ink-soft">
          结束日期
          <input type="date" name="endDate" className="ac-field" />
        </label>
      </div>
      {state?.error && <p className="text-sm text-high">{state.error}</p>}
      <button disabled={pending} className="ac-btn">
        {pending ? "创建中…" : "创建"}
      </button>
    </form>
  );
}
