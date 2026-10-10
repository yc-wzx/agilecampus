"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import {
  createTaskCommentAction,
  deleteTaskCommentAction,
  getTaskCommentsAction,
  updateTaskCommentAction,
} from "@/app/(app)/projects/[projectId]/tasks/comments/actions";
import { newRequestId } from "@/lib/request-id";
type Loaded = Extract<
  Awaited<ReturnType<typeof getTaskCommentsAction>>,
  { ok: true }
>["data"];

export function TaskComments({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}) {
  const search = useSearchParams(),
    focus = search.get("comment") ?? undefined;
  const focused = useRef<string | undefined>(undefined);
  const [data, setData] = useState<Loaded | null>(null),
    [error, setError] = useState("");
  const [body, setBody] = useState(""),
    [mentioned, setMentioned] = useState<string[]>([]),
    [editing, setEditing] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [requestId, setRequestId] = useState(newRequestId),
    [offset, setOffset] = useState(0);
  useEffect(() => {
    let active = true;
    getTaskCommentsAction(
      projectId,
      taskId,
      { offset, limit: 20 },
      focused.current !== focus ? focus : undefined,
    )
      .then((result) => {
        if (!active) return;
        if (result.ok) {
          focused.current = focus;
          setData(result.data);
          setError("");
        } else setError(result.error);
      })
      .catch(() => {
        if (active) setError("评论加载失败，请重试");
      });
    return () => {
      active = false;
    };
  }, [projectId, taskId, offset, focus]);
  useEffect(() => {
    if (data && focus)
      document
        .getElementById(`comment-${focus}`)
        ?.scrollIntoView({ block: "center" });
  }, [data, focus]);
  async function reload() {
    try {
      const result = await getTaskCommentsAction(projectId, taskId, {
        offset: data?.page.offset ?? offset,
        limit: 20,
      });
      if (result.ok) {
        setData(result.data);
        setError("");
      } else setError(result.error);
    } catch {
      setError("评论加载失败，请重试");
    }
  }
  return (
    <section
      className="space-y-3 border-t border-line pt-4 [overflow-wrap:anywhere]"
      aria-label="任务讨论"
    >
      <h3 className="font-semibold">任务讨论</h3>
      {error && (
        <p role="alert" className="text-sm text-high">
          {error}{" "}
          <button type="button" onClick={() => start(reload)}>
            重试
          </button>
        </p>
      )}
      {!data && !error && <p>加载评论…</p>}
      {data?.focusUnavailable && (
        <p className="text-sm text-ink-soft">目标评论已删除或不可访问</p>
      )}
      {data?.page.items.map((item) => (
        <article
          id={`comment-${item.id}`}
          key={item.id}
          className="space-y-2 rounded border border-line p-3"
        >
          <p className="text-xs text-ink-soft">
            {item.authorName} ·{" "}
            {new Date(item.updatedAt).toLocaleString("zh-CN", {
              timeZone: "Asia/Shanghai",
            })}
            {item.revision > 1 && " · 已编辑"}
          </p>
          <p className="whitespace-pre-wrap">{item.body}</p>
          {item.mentionedUserIds.length > 0 && (
            <p className="text-xs text-primary">
              提及：
              {item.mentionedUserIds
                .map(
                  (id) =>
                    data.members.find((m) => m.id === id)?.name ?? "已离组成员",
                )
                .join("、")}
            </p>
          )}
          {(item.authorId === data.actorId || data.role === "admin") && (
            <div className="flex gap-3 text-xs">
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setEditing(item.id);
                  setBody(item.body);
                  setMentioned(
                    item.mentionedUserIds.filter((id) =>
                      data.members.some((m) => m.id === id),
                    ),
                  );
                  setRequestId(newRequestId());
                }}
              >
                编辑
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    try {
                      const result = await deleteTaskCommentAction(
                        projectId,
                        taskId,
                        item.id,
                        {
                          requestId: newRequestId(),
                          expectedRevision: item.revision,
                        },
                      );
                      if (result.ok) await reload();
                      else setError(result.error);
                    } catch {
                      setError("删除未确认，请重试或重新加载评论");
                    }
                  })
                }
              >
                删除
              </button>
            </div>
          )}
        </article>
      ))}
      {data && (
        <>
          {data.page.total === 0 && (
            <p className="text-sm text-ink-soft">暂无评论</p>
          )}
          <nav className="flex gap-3 text-sm">
            {data.page.offset > 0 && (
              <button
                type="button"
                disabled={pending}
                onClick={() => setOffset(Math.max(0, data.page.offset - 20))}
              >
                上一页
              </button>
            )}
            {data.page.nextOffset !== null && (
              <button
                type="button"
                disabled={pending}
                onClick={() => setOffset(data.page.nextOffset!)}
              >
                下一页
              </button>
            )}
            <span>共 {data.page.total} 条</span>
          </nav>
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (pending) return;
              start(async () => {
                try {
                  const item = data.page.items.find((i) => i.id === editing);
                  const result = item
                    ? await updateTaskCommentAction(
                        projectId,
                        taskId,
                        item.id,
                        {
                          requestId,
                          expectedRevision: item.revision,
                          body,
                          mentionedUserIds: mentioned,
                        },
                      )
                    : await createTaskCommentAction(projectId, taskId, {
                        requestId,
                        body,
                        mentionedUserIds: mentioned,
                      });
                  if (result.ok) {
                    setBody("");
                    setMentioned([]);
                    setEditing(null);
                    setRequestId(newRequestId());
                    setError("");
                    await reload();
                  } else setError(result.error);
                } catch {
                  setError("保存未确认，请保留内容并重试");
                }
              });
            }}
          >
            <label className="block text-sm">
              {editing ? "编辑评论" : "发表评论"}
              <textarea
                className="ac-field mt-1 w-full"
                maxLength={10000}
                value={body}
                required
                onChange={(e) => {
                  setBody(e.target.value);
                  setRequestId(newRequestId());
                }}
              />
            </label>
            <label className="block text-sm">
              @ 提及成员
              <select
                aria-label="@ 提及成员"
                multiple
                className="ac-field mt-1 w-full"
                value={mentioned}
                onChange={(e) => {
                  setMentioned(
                    Array.from(e.target.selectedOptions, (o) => o.value),
                  );
                  setRequestId(newRequestId());
                }}
              >
                {data.members
                  .filter((m) => m.id !== data.actorId)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </select>
            </label>
            <div className="flex gap-2">
              <button type="submit" className="ac-btn" disabled={pending}>
                {pending ? "保存中…" : editing ? "保存评论" : "发布评论"}
              </button>
              {editing && (
                <button
                  type="button"
                  className="ac-btn-ghost"
                  onClick={() => {
                    setEditing(null);
                    setBody("");
                    setMentioned([]);
                    setRequestId(newRequestId());
                  }}
                >
                  取消编辑
                </button>
              )}
            </div>
          </form>
        </>
      )}
    </section>
  );
}
