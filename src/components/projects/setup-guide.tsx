"use client";

import { useState } from "react";
import Link from "next/link";
import type { SetupStep } from "@/lib/project-setup-steps";

export type { SetupStep };

/**
 * 空项目引导（第 9.10 节）。
 *
 * 五项都由 `deriveSetupSteps` 按真实数据推导后传进来：目标、里程碑、任务、成员、当前迭代。
 * 只提供「暂时跳过」（本次会话内隐藏），不提供“标记已完成”开关——完成与否由数据决定。
 */
export function SetupGuide({ steps }: { steps: SetupStep[] }) {
  const [hidden, setHidden] = useState(false);
  const remaining = steps.filter((step) => !step.done);

  if (hidden || remaining.length === 0) return null;

  return (
    <section className="ac-card space-y-3 p-5" aria-label="项目起步引导">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-medium text-ink">项目起步引导</h2>
          <p className="mt-0.5 text-xs text-ink-faint">
            按真实数据判断，完成的会自动打勾；也可以先跳过。
          </p>
        </div>
        <button
          type="button"
          className="ac-btn-ghost shrink-0"
          onClick={() => setHidden(true)}
        >
          暂时跳过
        </button>
      </div>

      <ol className="space-y-2">
        {steps.map((step) => (
          <li
            key={step.key}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm"
          >
            <span aria-hidden className={step.done ? "text-done" : "text-ink-faint"}>
              {step.done ? "✓" : "○"}
            </span>
            <span className={step.done ? "text-ink-faint" : "font-medium text-ink"}>
              {step.label}
            </span>
            <span className="text-xs text-ink-faint">{step.hint}</span>
            {!step.done && step.href && (
              <Link href={step.href} className="text-xs text-primary underline">
                去完成
              </Link>
            )}
          </li>
        ))}
      </ol>

      <p className="text-[11px] text-ink-faint">
        共 {steps.length} 步，还剩 {remaining.length} 步。这里只反映真实数据，没有“标记完成”开关。
      </p>
    </section>
  );
}
