"use client";

import { useState } from "react";

export function CalendarDownload({ projectId }: { projectId: string }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <div className="space-y-1">
      <button
        className="ac-btn-ghost"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setMessage("");
          try {
            const response = await fetch(
              "/api/projects/" + projectId + "/calendar",
              { cache: "no-store" },
            );
            if (!response.ok) {
              const result = await response.json().catch(() => ({}));
              throw new Error(result.error || "日历导出失败，请稍后重试");
            }
            const count = Number(response.headers.get("X-Calendar-Events"));
            if (!count) {
              setMessage("暂无截止日期可导出，请先填写项目、阶段或任务日期。");
              return;
            }
            const url = URL.createObjectURL(await response.blob());
            const element = document.createElement("a");
            element.href = url;
            element.download = "agilecampus-deadlines.ics";
            document.body.appendChild(element);
            element.click();
            element.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 5000);
            setMessage(
              "已导出 " + count + " 个日期。网站日期修改后请重新导出。",
            );
          } catch (error) {
            setMessage(
              error instanceof Error ? error.message : "下载失败，请重试",
            );
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? "导出中…" : "导出截止日期"}
      </button>
      {message && (
        <p role="status" className="max-w-sm text-xs text-ink-soft">
          {message}
        </p>
      )}
    </div>
  );
}
