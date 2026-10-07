"use client";

import { useRef, useState, useTransition } from "react";

import { reviewDeliverableAction } from "./actions";

/**
 * 教师/管理员验收当前待审版本。
 * 决定只针对一个具体 versionId；退回必须写意见（服务端同样强制）。
 */
export function ReviewForm({
  projectId,
  deliverableId,
  versionId,
  versionNumber,
  requestId,
}: {
  projectId: string;
  deliverableId: string;
  versionId: string;
  versionNumber: number;
  requestId: string;
}) {
  const [decision, setDecision] = useState<"approved" | "changes_requested">(
    "approved",
  );
  const [comment, setComment] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [formError, setFormError] = useState("");
  const [done, setDone] = useState<"approved" | "changes_requested" | null>(null);
  const [pending, startTransition] = useTransition();
  const locked = useRef(false);
  const request = useRef(requestId);

  return (
    <form
      className="ac-card space-y-3 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (locked.current) return;

        const trimmed = comment.trim();
        if (decision === "changes_requested" && !trimmed) {
          setFieldError("退回必须填写修改意见，学生据此修改。");
          return;
        }
        if (trimmed.length > 10000) {
          setFieldError("意见不能超过 10000 字。");
          return;
        }

        setFieldError("");
        setFormError("");
        locked.current = true;
        startTransition(async () => {
          try {
            const result = await reviewDeliverableAction(
              projectId,
              deliverableId,
              {
                requestId: request.current,
                versionId,
                decision,
                comment: trimmed,
              },
            );
            if (!result.ok) {
              // 冲突（版本已处理/不是当前待审版本）提示刷新，不自动换版本再批
              setFormError(result.error);
              return;
            }
            setDone(decision);

          } catch {
            setFormError(
              "未能确认验收结果，请刷新核对；重复提交不会产生第二条反馈。",
            );
          } finally {
            locked.current = false;
          }
        });
      }}
    >
      <h2 className="font-medium">教师验收 · 当前待审第 {versionNumber} 版</h2>
      <p className="text-xs text-ink-soft">
        验收决定只针对这一版；旧版本与当时的意见都会保留。
      </p>

      <fieldset disabled={pending || done !== null} className="space-y-3">
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="review-decision"
              value="approved"
              checked={decision === "approved"}
              onChange={() => setDecision("approved")}
            />
            通过
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="review-decision"
              value="changes_requested"
              checked={decision === "changes_requested"}
              onChange={() => setDecision("changes_requested")}
            />
            要求修改
          </label>
        </div>

        <div className="space-y-1">
          <label htmlFor="review-comment" className="block text-sm">
            验收意见
            {decision === "changes_requested" ? "（退回必填）" : "（可选）"}
          </label>
          <textarea
            id="review-comment"
            rows={4}
            maxLength={10000}
            className="ac-field"
            value={comment}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? "review-comment-error" : undefined}
            onChange={(event) => {
              setComment(event.target.value);
              if (fieldError) setFieldError("");
            }}
          />
          {fieldError && (
            <p id="review-comment-error" className="text-xs text-high">
              {fieldError}
            </p>
          )}
        </div>

        <button className="ac-btn" disabled={pending || done !== null}>
          {pending
            ? "提交中…"
            : done
              ? "已提交"
              : decision === "approved"
                ? "确认通过"
                : "确认退回"}
        </button>
      </fieldset>

      {done && (
        <p role="status" className="text-sm text-done">
          已{done === "approved" ? "通过" : "退回"}第 {versionNumber} 版。
        </p>
      )}
      {formError && (
        <p role="alert" className="text-sm text-high">
          {formError}
        </p>
      )}
    </form>
  );
}
