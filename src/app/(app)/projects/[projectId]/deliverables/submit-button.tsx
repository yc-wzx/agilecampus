"use client";
import { useRef, useState, useTransition } from "react";

import { submitDeliverableAction } from "./actions";
export function SubmitButton({ projectId, deliverableId, revision, requestId }: {
  projectId: string; deliverableId: string; revision: number; requestId: string;
}) {
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const locked = useRef(false), request = useRef(requestId);

  return <div>
    <button className="ac-btn" disabled={pending} onClick={() => {
      if (locked.current) return;
      locked.current = true; setError("");
      startTransition(async () => {
        try {
          const result = await submitDeliverableAction(projectId, deliverableId, { expectedRevision: revision, requestId: request.current });
          if (!result.ok) setError(result.error);
        } catch { setError("未能确认提交结果，请重试或刷新核对；重试不会重复生成版本。"); }
        finally { locked.current = false; }
      });
    }}>{pending ? "提交中…" : "正式提交"}</button>
    {error && <p role="alert" className="mt-2 text-sm text-high">{error}</p>}
  </div>;
}
