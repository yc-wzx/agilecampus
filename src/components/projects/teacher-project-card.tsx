import Link from "next/link";
import type { TeacherProjectOverview } from "@/contracts/p0-p2";
import { formatAsOf } from "./format";
import { RISK_RULE_LABELS } from "./risk-card";

/**
 * 教师项目卡（固定路径 `@/components/projects/teacher-project-card`，第 9.1 / 9.6 节）。
 *
 * 只展示 A-G01 聚合给出的内容：任务口径、成果口径、当前迭代、待处理事项、风险、最近活动。
 * - 待处理事项与风险分开展示，不混成一个“评分”。
 * - 单个数据源不可用时如实显示“暂时不可用”，不用 0 冒充。
 * - 不在浏览器重算任何阈值；风险来自 E-K01。
 */
export function TeacherProjectCard({ item }: { item: TeacherProjectOverview }) {
  const { taskStats, deliverableStats, activeIteration, pendingItems, risks, lastActivity } = item;

  return (
    <article className="ac-card space-y-3 p-4">
      <Link
        href={`/projects/${item.projectId}/overview`}
        className="block min-w-0 break-words font-display text-base font-semibold text-ink hover:text-primary"
      >
        {item.projectName}
      </Link>

      <dl className="space-y-1.5 text-xs">
        <div className="flex gap-2">
          <dt className="shrink-0 text-ink-faint">任务</dt>
          <dd className="min-w-0 break-words text-ink-soft">
            {taskStats.state === "ready"
              ? taskStats.data.total === 0
                ? "暂无任务"
                : `${taskStats.data.byStatus.done}/${taskStats.data.total} 已完成${
                    taskStats.data.overdueCount > 0
                      ? ` · 逾期 ${taskStats.data.overdueCount}`
                      : ""
                  }${
                    taskStats.data.blockedCount > 0
                      ? ` · 阻塞 ${taskStats.data.blockedCount}`
                      : ""
                  }`
              : "暂时不可用"}
          </dd>
        </div>

        <div className="flex gap-2">
          <dt className="shrink-0 text-ink-faint">成果</dt>
          <dd className="min-w-0 break-words text-ink-soft">
            {deliverableStats.state === "ready"
              ? deliverableStats.data.total === 0
                ? "暂无正式提交"
                : `通过 ${deliverableStats.data.byStatus.approved} · 待验收 ${deliverableStats.data.byStatus.submitted} · 需修改 ${deliverableStats.data.byStatus.changes_requested}`
              : "暂时不可用"}
          </dd>
        </div>

        <div className="flex gap-2">
          <dt className="shrink-0 text-ink-faint">当前迭代</dt>
          <dd className="min-w-0 break-words text-ink-soft">
            {activeIteration.state === "ready"
              ? activeIteration.data
                ? `${activeIteration.data.name}（${activeIteration.data.startDate} ~ ${activeIteration.data.endDate}，已完成 ${activeIteration.data.doneCount}/${activeIteration.data.taskTotal}）`
                : "当前没有进行中的迭代"
              : "暂时不可用"}
          </dd>
        </div>
      </dl>

      {/* 待处理事项：来源 D，与风险分开 */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-ink-faint">待处理事项</span>
        {pendingItems.state === "ready" ? (
          <>
            <span className="ac-badge bg-medium-soft text-medium">
              待验收 {pendingItems.data.submittedCount}
            </span>
            <span className="ac-badge bg-high-soft text-high">
              需修改 {pendingItems.data.changesRequestedCount}
            </span>
            {pendingItems.data.sourceHref && (
              <Link
                href={pendingItems.data.sourceHref}
                className="text-primary underline"
              >
                查看明细
              </Link>
            )}
          </>
        ) : (
          <span className="text-ink-faint">暂时不可用</span>
        )}
      </div>

      {/* 风险：来源 E-K01，逐条给规则名 */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-ink-faint">风险</span>
        {risks.state === "ready" ? (
          risks.data.items.length === 0 ? (
            <span className="text-ink-faint">未发现符合规则的风险</span>
          ) : (
            <>
              {risks.data.items.map((risk) => (
                <span
                  key={`${risk.ruleId}:${risk.message}`}
                  className="ac-badge bg-high-soft text-high"
                >
                  {RISK_RULE_LABELS[risk.ruleId] ?? risk.ruleId}
                </span>
              ))}
              {risks.data.unknownRules.length > 0 && (
                <span className="text-ink-faint">
                  · {risks.data.unknownRules.length} 条规则数据不足
                </span>
              )}
            </>
          )
        ) : (
          <span className="text-ink-faint">暂时不可用</span>
        )}
      </div>

      <p className="text-[11px] text-ink-faint">
        最近活动：
        {lastActivity.state === "ready"
          ? lastActivity.data
            ? `${lastActivity.data.summary}（${formatAsOf(lastActivity.data.occurredAt)}）`
            : "暂无记录"
          : "待接入（E-A02）"}
      </p>

      <p className="text-[11px] text-ink-faint">
        数据截至 {formatAsOf(item.asOf)}
      </p>
    </article>
  );
}
