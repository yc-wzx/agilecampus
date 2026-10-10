"use client";

import { useState } from "react";
import type { listProjectReferences } from "@/lib/project-extras";
import { REFERENCE_TYPES } from "@/lib/reference-labels";
import { saveReferenceAction, deleteReferenceAction } from "../extras/actions";
import { useExtraSubmit } from "../extras/use-extra-submit";
type Reference = Awaited<
  ReturnType<typeof listProjectReferences>
>["items"][number];
type Props = {
  projectId: string;
  requestId: string;
  record?: Reference;
  members: { id: string; name: string }[];
  milestones: { id: string; title: string }[];
};

export function ReferenceForm({
  projectId,
  requestId,
  record,
  members,
  milestones,
}: Props) {
  const [type, setType] = useState(record?.type ?? "meeting");
  const { state, pending, onSubmit } = useExtraSubmit(
    saveReferenceAction.bind(null, projectId, record?.id ?? null),
  );
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="requestId" value={requestId} />
      {record && (
        <input type="hidden" name="expectedRevision" value={record.revision} />
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-ink-soft">
          名称
          <input
            name="title"
            required
            maxLength={200}
            defaultValue={record?.title}
            placeholder="例如：需求讨论组会"
            className="ac-field"
          />
        </label>
        <label className="text-sm text-ink-soft">
          类型
          <select
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
            className="ac-field"
          >
            {REFERENCE_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block text-sm text-ink-soft">
        会议或资料链接
        <input
          name="url"
          type="url"
          required
          maxLength={2048}
          defaultValue={record?.url}
          placeholder="https://"
          className="ac-field"
        />
      </label>
      <label className="block text-sm text-ink-soft">
        关联阶段（可选）
        <select
          name="milestoneId"
          defaultValue={record?.milestoneId ?? ""}
          className="ac-field"
        >
          <option value="">不关联阶段</option>
          {milestones.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title}
            </option>
          ))}
        </select>
      </label>
      {type === "meeting" && (
        <fieldset className="space-y-3 rounded-lg border border-line p-3">
          <legend className="px-1 text-sm text-ink-soft">
            会议信息（可选）
          </legend>
          <label className="block text-sm text-ink-soft">
            会议日期
            <input
              name="meetingDate"
              type="date"
              defaultValue={record?.meetingDate ?? ""}
              className="ac-field"
            />
          </label>
          <label className="block text-sm text-ink-soft">
            纪要链接
            <input
              name="minutesUrl"
              type="url"
              maxLength={2048}
              defaultValue={record?.minutesUrl ?? ""}
              className="ac-field"
              placeholder="腾讯会议纪要或腾讯文档链接"
            />
          </label>
          <label className="block text-sm text-ink-soft">
            录制链接
            <input
              name="recordingUrl"
              type="url"
              maxLength={2048}
              defaultValue={record?.recordingUrl ?? ""}
              className="ac-field"
              placeholder="第三方已保存的录制链接"
            />
          </label>
          <fieldset>
            <legend className="mb-1 text-sm text-ink-soft">参与成员</legend>
            <div className="flex flex-wrap gap-3">
              {members.map((m) => (
                <label key={m.id} className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    name="participantIds"
                    value={m.id}
                    defaultChecked={record?.participants.some(
                      (p) => p.id === m.id,
                    )}
                  />
                  {m.name}
                </label>
              ))}
            </div>
            {record?.participants.some(
              (p) => !members.some((m) => m.id === p.id),
            ) && (
              <p className="mt-1 text-xs text-ink-faint">
                已离队成员保留在原会议记录中，本次保存以当前勾选成员为准。
              </p>
            )}
          </fieldset>
        </fieldset>
      )}
      <label className="block text-sm text-ink-soft">
        说明（可选）
        <textarea
          name="note"
          maxLength={5000}
          rows={3}
          defaultValue={record?.note}
          className="ac-field"
        />
      </label>
      {state && (
        <p
          role="status"
          className={"text-sm " + (state.ok ? "text-done" : "text-high")}
        >
          {state.message}
        </p>
      )}
      <button disabled={pending} className="ac-btn">
        {pending ? "保存中…" : record ? "保存修改" : "添加记录"}
      </button>
    </form>
  );
}

export function DeleteReferenceForm({
  projectId,
  record,
  requestId,
}: {
  projectId: string;
  record: Reference;
  requestId: string;
}) {
  const { state, pending, onSubmit } = useExtraSubmit(
    deleteReferenceAction.bind(null, projectId, record.id),
  );
  return (
    <form
      onSubmit={(event) => {
        if (!window.confirm("删除这条会议或资料记录？原始外部文件不会被删除。"))
          event.preventDefault();
        else void onSubmit(event);
      }}
    >
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="expectedRevision" value={record.revision} />
      <button disabled={pending} className="text-sm text-high underline">
        {pending ? "删除中…" : "删除记录"}
      </button>
      {state && (
        <p role="status" className="text-sm text-high">
          {state.message}
        </p>
      )}
    </form>
  );
}
