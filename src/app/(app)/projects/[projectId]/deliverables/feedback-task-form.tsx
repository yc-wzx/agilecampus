"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createTaskFromFeedbackAction } from "./actions";

/**
 * 把某条教师反馈转成一个修改任务。
 *
 * 约定（接口标准第 6 节 / D 的 P1 交接）：
 * - 先给用户确认表单，预填标题与反馈正文；负责人与截止日由用户确认，不自动建。
 * - 同一反馈最多关联一个修改任务；重复操作返回已有任务。
 * - 关联任务已被删除时提示“原修改任务已删除”，不自动补建第二个。
 */
export function FeedbackTaskForm({
  projectId,
  feedbackId,
  versionLabel,
  defaultTitle,
  defaultDescription,
  members,
  existingTaskId,
  existingTaskDeleted,
  requestId,
  canCreate = true,
}: {
  projectId: string;
  feedbackId: string;
  versionLabel: string;
  defaultTitle: string;
  defaultDescription: string;
  members: { id: string; name: string }[];
  existingTaskId: string | null;
  existingTaskDeleted: boolean;
  requestId: string;
  canCreate?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState(defaultDescription);
  const [assigneeId, setAssigneeId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const [fieldError, setFieldError] = useState("");
  const [formError, setFormError] = useState("");
  const [createdTaskId, setCreatedTaskId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const locked = useRef(false);
  const request = useRef(requestId);
  const router = useRouter();

  const taskId = createdTaskId ?? existingTaskId;
  const taskHref = taskId ? `/projects/${projectId}?task=${taskId}` : null;

  if (existingTaskDeleted) return <p className="text-xs text-ink-soft">原修改任务已删除。需要继续处理请走普通任务创建流程。</p>;

  if (taskHref) {
    return (
      <p className="text-xs text-ink-soft">
        已创建修改任务：{" "}
        <Link href={taskHref} className="text-primary underline">
          打开任务查看来源反馈
        </Link>
        （同一反馈只会创建一个修改任务）
      </p>
    );
  }

  if (!canCreate) return null;

  if (!open) {
    return (
      <button
        type="button"
        className="ac-btn-ghost"
        onClick={() => setOpen(true)}
      >
        将这条意见转为修改任务
      </button>
    );
  }

  return (
    <form
      className="space-y-3 rounded-field border border-line bg-sunken/40 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (locked.current) return;

        const trimmedTitle = title.trim();
        if (!trimmedTitle) {
          setFieldError("请填写任务标题。");
          return;
        }
        if (trimmedTitle.length > 200) {
          setFieldError("标题不能超过 200 字。");
          return;
        }
        if (description.trim().length > 10000) {
          setFieldError("说明不能超过 10000 字。");
          return;
        }

        setFieldError("");
        setFormError("");
        locked.current = true;
        startTransition(async () => {
          try {
            const result = await createTaskFromFeedbackAction(
              projectId,
              feedbackId,
              {
                requestId: request.current,
                title: trimmedTitle,
                description: description.trim(),
                priority,
                ...(assigneeId ? { assigneeId } : {}),
                ...(dueDate ? { dueDate } : {}),
              },
            );
            if (!result.ok) {
              setFormError(result.error);
              return;
            }
            setCreatedTaskId(result.data.taskId);
            setOpen(false);
            router.refresh();
          } catch {
            setFormError(
              "未能确认创建结果，请刷新核对；重试会返回同一条修改任务，不会重复创建。",
            );
          } finally {
            locked.current = false;
          }
        });
      }}
    >
      <p className="text-xs text-ink-soft">
        根据{versionLabel}的意见创建任务；负责人与截止日请自行确认。
      </p>

      <div className="space-y-1">
        <label htmlFor={`fb-title-${feedbackId}`} className="block text-xs">
          任务标题
        </label>
        <input
          id={`fb-title-${feedbackId}`}
          className="ac-field"
          maxLength={200}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor={`fb-desc-${feedbackId}`} className="block text-xs">
          任务说明（默认取反馈正文）
        </label>
        <textarea
          id={`fb-desc-${feedbackId}`}
          rows={3}
          maxLength={10000}
          className="ac-field"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <label htmlFor={`fb-assignee-${feedbackId}`} className="block text-xs">
            负责人
          </label>
          <select
            id={`fb-assignee-${feedbackId}`}
            className="ac-field"
            value={assigneeId}
            onChange={(event) => setAssigneeId(event.target.value)}
          >
            <option value="">暂不指定</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor={`fb-due-${feedbackId}`} className="block text-xs">
            截止日
          </label>
          <input
            id={`fb-due-${feedbackId}`}
            type="date"
            className="ac-field"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`fb-priority-${feedbackId}`} className="block text-xs">
            优先级
          </label>
          <select
            id={`fb-priority-${feedbackId}`}
            className="ac-field"
            value={priority}
            onChange={(event) =>
              setPriority(event.target.value as "low" | "medium" | "high")
            }
          >
            <option value="low">低</option>
            <option value="medium">中</option>
            <option value="high">高</option>
          </select>
        </div>
      </div>

      {fieldError && <p className="text-xs text-high">{fieldError}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button className="ac-btn" disabled={pending}>
          {pending ? "创建中…" : "确认创建修改任务"}
        </button>
        <button
          type="button"
          className="ac-btn-ghost"
          disabled={pending}
          onClick={() => setOpen(false)}
        >
          取消
        </button>
      </div>

      {formError && (
        <p role="alert" className="text-xs text-high">
          {formError}
        </p>
      )}
    </form>
  );
}
