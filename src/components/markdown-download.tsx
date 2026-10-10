"use client";
import { useState, useTransition } from "react";
import type { Result } from "@/contracts/p0-p2";
export function MarkdownDownload({
  action,
  label = "下载 Markdown",
}: {
  action: () => Promise<Result<{ filename: string; markdown: string }>>;
  label?: string;
}) {
  const [pending, start] = useTransition(),
    [error, setError] = useState("");
  return (
    <div>
      <button
        type="button"
        className="ac-btn-ghost"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError("");
            try {
              const result = await action();
              if (!result.ok) {
                setError(result.error);
                return;
              }
              const url = URL.createObjectURL(
                new Blob([result.data.markdown], {
                  type: "text/markdown;charset=utf-8",
                }),
              );
              const a = document.createElement("a");
              a.href = url;
              a.download = result.data.filename;
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch {
              setError("下载失败，请重试");
            }
          })
        }
      >
        {pending ? "生成中…" : label}
      </button>
      {error && (
        <p role="alert" className="text-sm text-high">
          {error}
        </p>
      )}
    </div>
  );
}
