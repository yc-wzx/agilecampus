"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

/**
 * 成果路由段的服务失败界面：显示失败与重试入口，
 * 不把请求失败显示成“没有成果”或数字 0（第 3.3 节）。
 */
export default function DeliverablesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const params = useParams();
  const projectId =
    typeof params?.projectId === "string" ? params.projectId : null;

  return (
    <main className="mx-auto max-w-3xl py-16">
      <div className="ac-card space-y-4 p-8 text-center">
        <h1 className="font-display text-xl font-semibold text-ink">
          阶段成果暂时无法加载
        </h1>
        <p className="text-sm text-ink-soft">
          服务请求失败，页面没有把失败显示成“暂无成果”。请先重试；若持续失败，请把下方编号告诉组长。
        </p>
        {error.digest && (
          <p className="break-all text-xs text-ink-faint">
            错误编号：{error.digest}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button onClick={reset} className="ac-btn">
            重试
          </button>
          {projectId && (
            <Link
              href={`/projects/${projectId}/overview`}
              className="ac-btn-ghost"
            >
              返回项目概览
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
