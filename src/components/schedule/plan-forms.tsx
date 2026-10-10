"use client";
import { useState } from "react";
import {
  generatePersonalPlanAction,
  changePersonalPlanAction,
} from "@/app/(app)/schedule/actions";
import type { getPlanningWorkspace } from "@/lib/schedule/planner";
import { Feedback, useScheduleWrite } from "./forms";
type Workspace = Awaited<ReturnType<typeof getPlanningWorkspace>>;
export function PersonalPlanGenerator({
  projectId,
  startDate,
  candidates,
  total,
  requestId,
  aiAvailable,
}: {
  projectId: string;
  startDate: string;
  candidates: Workspace["candidates"];
  total: number;
  requestId: string;
  aiAvailable: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const { pending, error, onSubmit } = useScheduleWrite((form) =>
    generatePersonalPlanAction(projectId, {
      requestId,
      startDate: String(form.get("startDate")),
      days: Number(form.get("days")) as 7 | 14,
      goal: String(form.get("goal") || ""),
      mode: String(form.get("mode")) as "ai" | "rules",
      selections: selected.map((taskId) => ({
        taskId,
        minutes: Number(form.get("minutes:" + taskId)),
      })),
    }),
  );
  return (
    <form onSubmit={onSubmit} className="ac-card space-y-4 p-4">
      <h2 className="font-semibold">生成个人短期计划草案</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          开始日期
          <input
            type="date"
            name="startDate"
            defaultValue={startDate}
            required
            className="ac-field"
          />
        </label>
        <label className="text-sm">
          规划范围
          <select name="days" className="ac-field">
            <option value={7}>未来 7 天</option>
            <option value={14}>未来 14 天</option>
          </select>
        </label>
        <label className="text-sm">
          规划方式
          <select
            name="mode"
            defaultValue={aiAvailable ? "ai" : "rules"}
            className="ac-field"
          >
            <option value="ai" disabled={!aiAvailable}>
              AI 建议目标与顺序
            </option>
            <option value="rules">规则规划（不调用 AI）</option>
          </select>
        </label>
      </div>
      {!aiAvailable && (
        <p className="text-sm text-ink-soft">
          当前尚未配置 AI 服务，可先使用规则规划；不会把规则结果冒充 AI 生成。
        </p>
      )}
      <label className="block text-sm">
        本期想推进的目标（可选）
        <textarea
          name="goal"
          maxLength={1000}
          rows={2}
          placeholder="例如：优先完成下周展示需要的功能，每天投入不超过 2 小时"
          className="ac-field"
        />
      </label>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">
          选择本人任务，填写剩余工时
        </legend>
        <p className="text-xs text-ink-soft">
          只列已指派本人、未完成、无阻塞和未完成前置依赖、没有子任务的任务。工时为你的剩余工作估计，每项默认
          60 分钟，生成前可修改。
        </p>
        {total > candidates.length && (
          <p className="text-xs text-ink-soft">
            共有 {total} 项候选，仅展示按截止日期排序的前 {candidates.length}{" "}
            项。
          </p>
        )}
        {!candidates.length && (
          <p className="text-sm text-ink-soft">
            暂无可规划的本人任务。请先在看板完成指派或解除阻塞。
          </p>
        )}
        {candidates.map((task) => (
          <div
            key={task.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3"
          >
            <label className="flex min-w-0 flex-1 items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(task.id)}
                onChange={(e) =>
                  setSelected((old) =>
                    e.target.checked
                      ? [...old, task.id]
                      : old.filter((id) => id !== task.id),
                  )
                }
              />
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {task.title}
                <span className="mt-1 block text-xs text-ink-soft">
                  {task.status === "doing" ? "进行中" : "待做"} ·{" "}
                  {task.dueDate ?? "未设任务截止日"}
                </span>
              </span>
            </label>
            <label className="text-xs">
              剩余分钟
              <input
                aria-label={`${task.title}剩余分钟`}
                name={"minutes:" + task.id}
                type="number"
                min={15}
                max={2400}
                step={15}
                defaultValue={60}
                disabled={!selected.includes(task.id)}
                className="ac-field w-24"
              />
            </label>
          </div>
        ))}
      </fieldset>
      <p className="text-xs text-ink-soft">
        个人课表标题不会发送给模型，只提供可投入时间统计；任务目标、进度和你填写的要求会用于生成。草案不会改动任务和团队迭代。
      </p>
      <Feedback error={error} />
      <button disabled={pending || !selected.length} className="ac-btn">
        {pending ? "生成中…" : "生成短期计划草案"}
      </button>
    </form>
  );
}
export function PersonalPlanControls({
  projectId,
  plan,
  requestId,
}: {
  projectId: string;
  plan: Workspace["plans"][number];
  requestId: string;
}) {
  const { pending, error, onSubmit } = useScheduleWrite((form) =>
    changePersonalPlanAction(projectId, plan.id, {
      requestId,
      expectedRevision: plan.revision,
      action: String(form.get("operation")) as "confirm" | "cancel",
    }),
  );
  if (plan.status === "cancelled") return null;
  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <Feedback error={error} />
      <div className="flex flex-wrap gap-3">
        {plan.status === "draft" && (
          <button
            name="operation"
            value="confirm"
            disabled={pending || plan.isStale || !plan.items.length}
            className="ac-btn"
          >
            确认保存个人安排
          </button>
        )}
        <button
          name="operation"
          value="cancel"
          disabled={pending}
          className="ac-btn bg-sunken text-ink"
        >
          {plan.status === "confirmed" ? "取消已确认安排" : "取消草案"}
        </button>
      </div>
    </form>
  );
}
