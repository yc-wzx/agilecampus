"use client";

import { useRef, useState, useTransition } from "react";
import { exportDeliverableEvidenceMarkdownAction } from "./export-actions";
import type { EvidenceExportFilters } from "@/lib/deliverable-evidence-markdown";

type Exported = {
  filename: string;
  markdown: string;
  total: number;
  exportedCount: number;
  truncated: boolean;
};

/**
 * 导出证据 Markdown：服务端逐页遍历后返回全文，这里负责下载与复制。
 * 下载被浏览器拦截时，仍可从下方文本框复制全文。
 */
export function EvidenceExportButton({
  projectId,
  filters,
}: {
  projectId: string;
  filters: EvidenceExportFilters;
}) {
  const [pending, startTransition] = useTransition();
  const [exported, setExported] = useState<Exported | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const locked = useRef(false);

  function download(data: Exported) {
    const blob = new Blob([data.markdown], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = data.filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="ac-btn-ghost"
          disabled={pending}
          onClick={() => {
            if (locked.current) return;
            locked.current = true;
            setError("");
            setCopied(false);
            startTransition(async () => {
              try {
                const result =
                  await exportDeliverableEvidenceMarkdownAction(
                    projectId,
                    filters,
                  );
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                setExported(result.data);
                download(result.data);
              } catch {
                setError("导出未能完成，请稍后重试。");
              } finally {
                locked.current = false;
              }
            });
          }}
        >
          {pending ? "导出中…" : "导出 Markdown"}
        </button>
        <span className="text-xs text-ink-faint">
          导出遵循当前筛选条件，逐页取全量（上限 1000 条）
        </span>
      </div>

      {error && (
        <p role="alert" className="text-xs text-high">
          {error}
        </p>
      )}

      {exported && (
        <div className="space-y-2 rounded-field border border-line bg-sunken/40 p-3">
          <p className="text-xs text-ink-soft">
            已导出 {exported.exportedCount} / {exported.total} 条
            {exported.truncated
              ? "（达到单次上限，清单里已标注未包含全部记录）"
              : "（已包含全部筛选结果）"}
            ，文件 {exported.filename}。若浏览器拦住了下载，可在下面复制全文。
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="ac-btn-ghost"
              onClick={() => {
                navigator.clipboard
                  ?.writeText(exported.markdown)
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false));
              }}
            >
              复制全文
            </button>
            {copied && <span className="text-xs text-done">已复制</span>}
          </div>
          <details>
            <summary className="cursor-pointer text-xs text-primary">
              查看 Markdown 全文
            </summary>
            <textarea
              readOnly
              rows={12}
              className="ac-field mt-2 font-mono text-[11px]"
              value={exported.markdown}
            />
          </details>
        </div>
      )}
    </div>
  );
}
