"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startDeliverableRevisionAction } from "./actions";

/**
 * 作者/管理员对「已通过」或「需修改」的成果开始新版本草稿。
 * 开始草稿不会覆盖上一版正式内容；只有显式“提交新版本”才产生新版本号。
 */
export function StartRevisionButton({
  projectId,
  deliverableId,
  revision,
  requestId,
  status,
}: {
  projectId: string;
  deliverableId: string;
  revision: number;
  requestId: string;
  status: string;
}) {
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const locked = useRef(false);
  const request = useRef(requestId);
  const router = useRouter();

  return (
    <div className="space-y-2">
      <p className="text-sm text-ink-soft">
        {status === "approved"
          ? "已通过的成果需要改动时，先开始新版本草稿；旧版本仍然有效，正式重交后才重新等待验收。"
          : "按教师意见修改：先开始新版本草稿，编辑保存后再显式提交新版本。"}
      </p>
      <button
        className="ac-btn"
        disabled={pending}
        onClick={() => {
          if (locked.current) return;
          locked.current = true;
          setError("");
          startTransition(async () => {
            try {
              const result = await startDeliverableRevisionAction(
                projectId,
                deliverableId,
                { requestId: request.current, expectedRevision: revision },
              );
              if (!result.ok) setError(result.error);
              else router.refresh();
            } catch {
              setError("未能确认结果，请刷新核对；重试不会生成两个草稿。");
            } finally {
              locked.current = false;
            }
          });
        }}
      >
        {pending ? "处理中…" : "开始修改（新建草稿）"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-high">
          {error}
        </p>
      )}
    </div>
  );
}
