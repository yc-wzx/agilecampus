"use client";
import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import type {
  IterationDraft,
  PreviewIterationDraftResult,
} from "@/contracts/p0-p2";
import {
  generateIterationDraftAction,
  updateIterationDraftAction,
  cancelIterationDraftAction,
  previewIterationDraftAction,
  confirmIterationDraftAction,
} from "@/app/(app)/projects/[projectId]/ai-drafts/actions";
import { newRequestId } from "@/lib/request-id";
type Candidate = { id: string; title: string };
export function IterationDraftGenerator({
  projectId,
  conversationId,
}: {
  projectId: string;
  conversationId: string;
}) {
  const [prompt, setPrompt] = useState(""),
    [error, setError] = useState(""),
    [pending, start] = useTransition();
  const request = useRef(newRequestId()),
    busy = useRef(false);
  return (
    <form
      className="ac-card space-y-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (busy.current) return;
        busy.current = true;
        start(async () => {
          try {
            const result = await generateIterationDraftAction(projectId, {
              requestId: request.current,
              conversationId,
              prompt,
            });
            if (result.ok) {
              setPrompt("");
              setError("");
              request.current = newRequestId();
            } else setError(result.error);
          } catch {
            setError("生成失败，请重试");
          } finally {
            busy.current = false;
          }
        });
      }}
    >
      <h2 className="font-semibold">规划迭代草案</h2>
      <label className="block text-sm">
        本轮目标与时间要求
        <textarea
          className="ac-field mt-1 w-full"
          required
          maxLength={4000}
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
            request.current = newRequestId();
          }}
          placeholder="例如：下周完成登录联调，从任务池选择 3 个任务"
        />
      </label>
      <p className="text-xs text-ink-soft">
        AI 仅选择现有任务，草案保存 24
        小时；预览并确认后才创建未开始的迭代。未配置 AI 时仍可手动规划迭代。
      </p>
      {error && (
        <p role="alert" className="text-high">
          {error}
        </p>
      )}
      <button className="ac-btn" disabled={pending}>
        {pending ? "生成中…" : "生成待确认草案"}
      </button>
    </form>
  );
}
export function IterationDraftEditor({
  projectId,
  draft,
  candidates,
}: {
  projectId: string;
  draft: IterationDraft;
  candidates: Candidate[];
}) {
  const [name, setName] = useState(draft.name),
    [goal, setGoal] = useState(draft.goal ?? ""),
    [startDate, setStart] = useState(draft.startDate),
    [endDate, setEnd] = useState(draft.endDate),
    [ids, setIds] = useState(draft.candidateTasks.map((t) => t.taskId));
  const [preview, setPreview] = useState<PreviewIterationDraftResult | null>(
      null,
    ),
    [error, setError] = useState(""),
    [confirmed, setConfirmed] = useState<string | null>(null),
    [pending, start] = useTransition();
  const busy = useRef(false),
    request = useRef(newRequestId());
  function run(work: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    start(async () => {
      try {
        await work();
      } catch {
        setError("操作失败，请重试");
      } finally {
        busy.current = false;
      }
    });
  }
  const dirty =
    name !== draft.name ||
    goal !== (draft.goal ?? "") ||
    startDate !== draft.startDate ||
    endDate !== draft.endDate ||
    JSON.stringify(ids) !==
      JSON.stringify(draft.candidateTasks.map((t) => t.taskId));
  const choices = [
    ...candidates,
    ...draft.candidateTasks
      .filter((t) => !candidates.some((c) => c.id === t.taskId))
      .map((t) => ({ id: t.taskId, title: "原候选任务（需重新校验）" })),
  ];
  return (
    <article className="ac-card space-y-3 p-4">
      <p className="text-sm">
        {draft.name} ·{" "}
        {
          {
            pending: "待确认",
            confirmed: "已确认",
            cancelled: "已取消",
            expired: "已过期",
          }[draft.status]
        }{" "}
        · 有效至{" "}
        {new Date(draft.expiresAt).toLocaleString("zh-CN", {
          timeZone: "Asia/Shanghai",
        })}
      </p>
      {draft.status === "pending" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              名称
              <input
                className="ac-field w-full"
                required
                maxLength={100}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  request.current = newRequestId();
                }}
              />
            </label>
            <label>
              目标
              <input
                className="ac-field w-full"
                maxLength={2000}
                value={goal}
                onChange={(e) => {
                  setGoal(e.target.value);
                  request.current = newRequestId();
                }}
              />
            </label>
            <label>
              开始日期
              <input
                className="ac-field w-full"
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStart(e.target.value);
                  request.current = newRequestId();
                }}
              />
            </label>
            <label>
              结束日期
              <input
                className="ac-field w-full"
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEnd(e.target.value);
                  request.current = newRequestId();
                }}
              />
            </label>
          </div>
          <fieldset className="max-h-60 space-y-2 overflow-auto">
            <legend>候选任务</legend>
            {choices.map((t) => (
              <label className="flex gap-2 text-sm" key={t.id}>
                <input
                  type="checkbox"
                  checked={ids.includes(t.id)}
                  onChange={(e) => {
                    setIds(
                      e.target.checked
                        ? [...ids, t.id]
                        : ids.filter((id) => id !== t.id),
                    );
                    request.current = newRequestId();
                  }}
                />
                {t.title}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <button
              className="ac-btn-ghost"
              disabled={pending || !dirty}
              onClick={() =>
                run(async () => {
                  const result = await updateIterationDraftAction(
                    projectId,
                    draft.id,
                    {
                      requestId: request.current,
                      expectedRevision: draft.revision,
                      name,
                      goal,
                      startDate,
                      endDate,
                      taskIds: ids,
                    },
                  );
                  if (!result.ok) setError(result.error);
                  else {
                    setPreview(null);
                    setError("");
                  }
                })
              }
            >
              保存修改
            </button>
            <button
              className="ac-btn-ghost"
              disabled={pending || dirty}
              onClick={() =>
                run(async () => {
                  const result = await previewIterationDraftAction(
                    projectId,
                    draft.id,
                  );
                  if (result.ok) {
                    setPreview(result.data);
                    setError("");
                  } else setError(result.error);
                })
              }
            >
              预览并校验
            </button>
            <button
              className="ac-btn"
              disabled={pending || dirty || !preview?.validation.valid}
              onClick={() =>
                run(async () => {
                  if (!preview) return;
                  const result = await confirmIterationDraftAction(
                    projectId,
                    draft.id,
                    {
                      requestId: request.current,
                      expectedDraftRevision: preview.draft.revision,
                      expectedTaskVersions: preview.currentTaskVersions,
                    },
                  );
                  if (result.ok) setConfirmed(result.data.iteration.id);
                  else {
                    setError(result.error);
                    setPreview(null);
                  }
                })
              }
            >
              确认创建迭代
            </button>
            <button
              className="ac-btn-ghost"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const result = await cancelIterationDraftAction(
                    projectId,
                    draft.id,
                    {
                      requestId: request.current,
                      expectedRevision: draft.revision,
                    },
                  );
                  if (!result.ok) setError(result.error);
                })
              }
            >
              取消草案
            </button>
          </div>
          {dirty && (
            <p className="text-sm text-ink-soft">请先保存修改，再重新预览。</p>
          )}
          {preview && (
            <p className="text-sm">
              {preview.validation.valid
                ? "当前校验通过，确认会创建未开始的迭代"
                : `校验未通过：${preview.validation.conflicts.map((c) => c.reason).join("；")}`}
            </p>
          )}
        </>
      )}
      {confirmed && (
        <Link
          className="text-primary"
          href={`/projects/${projectId}/iterations/${confirmed}`}
        >
          查看新迭代
        </Link>
      )}
      {error && (
        <p role="alert" className="text-high">
          {error}
        </p>
      )}
    </article>
  );
}
