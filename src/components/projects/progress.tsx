import type {
  ProjectDeliverableStats,
  ProjectTaskStats,
} from "@/contracts/p0-p2";
import { formatAsOf } from "./format";

/**
 * B 的共用展示组件（固定路径 `@/components/projects/progress`，第 9.1 节）。
 * 只负责展示，不在浏览器里重算统计口径或阈值；数字一律由服务端服务给出。
 */

function percent(ratio: number | null): number | null {
  if (ratio === null || Number.isNaN(ratio)) return null;
  return Math.min(100, Math.max(0, Math.round(ratio * 100)));
}

function ProgressBar({ value, tone }: { value: number; tone: string }) {
  return (
    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-sunken">
      <div
        className={`h-full rounded-full ${tone}`}
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

/**
 * 任务进展卡：主任务口径（scope: "main-tasks"）。
 * total 为 0 时显示“暂无任务”，不使用 0% 或 100% 冒充。
 */
export function TaskProgress({ stats }: { stats: ProjectTaskStats }) {
  const { todo, doing, done } = stats.byStatus;
  const ratio = percent(stats.doneRatio);

  return (
    <section className="ac-card p-5">
      <h2 className="text-sm text-ink-soft">任务进展</h2>
      <p className="mt-2 font-display text-2xl font-semibold tabular-nums text-ink">
        {stats.total === 0 ? "暂无任务" : `${done}/${stats.total}`}
        {stats.total > 0 && ratio !== null && (
          <span className="ml-2 align-middle text-sm font-normal text-ink-faint">
            {ratio}%
          </span>
        )}
      </p>
      {stats.total > 0 && ratio !== null && (
        <ProgressBar value={ratio} tone="bg-done" />
      )}
      <p className="mt-2 text-xs text-ink-faint">
        主任务口径（不含子任务）：待开始 {todo} · 进行中 {doing} · 已完成 {done}
        {stats.overdueCount > 0 ? ` · 逾期 ${stats.overdueCount}` : ""}
        {stats.blockedCount > 0 ? ` · 阻塞 ${stats.blockedCount}` : ""}
      </p>
      <p className="mt-1 text-[11px] text-ink-faint">
        统计时间 {formatAsOf(stats.asOf)}
      </p>
    </section>
  );
}

/**
 * 成果验收卡：只统计当前正式提交的成果（scope: "current-submitted-deliverables"）。
 * 没有正式成果时显示“暂无正式提交成果”，不显示 100% 通过。
 * 成果通过率与任务完成率不是同一个数字，两者分开显示。
 */
export function DeliverableProgress({
  stats,
}: {
  stats: ProjectDeliverableStats;
}) {
  const { submitted, changes_requested: changesRequested, approved } =
    stats.byStatus;
  const ratio = percent(stats.approvedRatio);

  return (
    <section className="ac-card p-5">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-sm text-ink-soft">成果验收</h2>
        {stats.projectStatus === "archived" && (
          <span className="ac-badge bg-low-soft text-low">已归档</span>
        )}
      </div>
      <p className="mt-2 font-display text-2xl font-semibold tabular-nums text-ink">
        {stats.total === 0
          ? "暂无正式提交成果"
          : `${approved} 通过`}
      </p>
      {stats.total > 0 && (
        <>
          <ProgressBar value={ratio ?? 0} tone="bg-primary" />
          <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-faint">
            <span className="ac-badge bg-done/12 text-done">已通过 {approved}</span>
            <span className="ac-badge bg-medium-soft text-medium">
              待验收 {submitted}
            </span>
            <span className="ac-badge bg-high-soft text-high">
              需修改 {changesRequested}
            </span>
          </p>
        </>
      )}
      <p className="mt-2 text-[11px] text-ink-faint">
        {stats.total === 0
          ? "仅统计已正式提交的成果；草稿与历史版本不计入。"
          : `通过率 ${ratio ?? 0}% ，仅统计当前正式提交的成果，不含初版草稿和历史版本。`}
      </p>
    </section>
  );
}
