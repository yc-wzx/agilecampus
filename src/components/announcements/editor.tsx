"use client";
import { useRef, useState, useTransition } from "react";
import type { AnnouncementItem } from "@/contracts/p0-p2";
import { newRequestId } from "@/lib/request-id";
import {
  publishAnnouncementAction,
  updateAnnouncementAction,
  setAnnouncementPinnedAction,
  withdrawAnnouncementAction,
  republishAnnouncementAction,
} from "@/app/(app)/projects/[projectId]/announcements/actions";
export function AnnouncementEditor({
  projectId,
  item,
}: {
  projectId: string;
  item?: AnnouncementItem;
}) {
  const [title, setTitle] = useState(item?.title ?? ""),
    [body, setBody] = useState(item?.body ?? ""),
    [pinned, setPinned] = useState(false),
    [editing, setEditing] = useState(false),
    [error, setError] = useState("");
  const [pending, start] = useTransition(),
    [requestId, setRequestId] = useState(newRequestId);
  const locked = useRef(false);
  async function perform(
    run: () => ReturnType<typeof publishAnnouncementAction>,
  ) {
    if (locked.current) return;
    locked.current = true;
    setError("");
    try {
      const result = await run();
      if (!result.ok) setError(result.error);
      else {
        setEditing(false);
        if (!item) {
          setBody("");
          setTitle("");
        }
        setRequestId(newRequestId());
      }
    } catch {
      setError("未能确认保存结果，请刷新核对后重试");
    } finally {
      locked.current = false;
    }
  }
  const input = () => ({ requestId, expectedRevision: item!.revision });
  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="text-sm text-high">
          {error}
        </p>
      )}
      {item && (
        <div className="flex flex-wrap gap-3 text-sm">
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setEditing(!editing);
              setTitle(item.title);
              setBody(item.body);
              setRequestId(newRequestId());
            }}
          >
            编辑
          </button>
          {item.status === "published" && (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(() =>
                    perform(() =>
                      setAnnouncementPinnedAction(projectId, item.id, {
                        ...input(),
                        isPinned: !item.isPinned,
                      }),
                    ),
                  )
                }
              >
                {item.isPinned ? "取消置顶" : "置顶"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(() =>
                    perform(() =>
                      withdrawAnnouncementAction(projectId, item.id, input()),
                    ),
                  )
                }
              >
                撤下
              </button>
            </>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(() =>
                perform(() =>
                  republishAnnouncementAction(projectId, item.id, input()),
                ),
              )
            }
          >
            重新发布并通知成员
          </button>
        </div>
      )}
      {(!item || editing) && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(() =>
              perform(() =>
                item
                  ? updateAnnouncementAction(projectId, item.id, {
                      ...input(),
                      title,
                      body,
                    })
                  : publishAnnouncementAction(projectId, {
                      requestId,
                      title,
                      body,
                      isPinned: pinned,
                    }),
              ),
            );
          }}
        >
          <label className="block text-sm">
            公告标题
            <input
              required
              maxLength={200}
              className="ac-field mt-1 w-full"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setRequestId(newRequestId());
              }}
            />
          </label>
          <label className="block text-sm">
            公告内容
            <textarea
              required
              maxLength={10000}
              rows={4}
              className="ac-field mt-1 w-full"
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                setRequestId(newRequestId());
              }}
            />
          </label>
          {!item && (
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={pinned}
                onChange={(e) => {
                  setPinned(e.target.checked);
                  setRequestId(newRequestId());
                }}
              />
              置顶，替换当前置顶公告
            </label>
          )}
          <button type="submit" className="ac-btn" disabled={pending}>
            {pending ? "保存中…" : item ? "保存公告（不重复通知）" : "发布公告"}
          </button>
        </form>
      )}
    </div>
  );
}
