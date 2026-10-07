import Link from "next/link";
import type { RiskItem } from "@/contracts/p0-p2";
import { formatAsOf } from "./format";

/**
 * 四条固定规则的展示名（第 9.6 节）。
 * 规则与阈值由 E-K01 在服务端计算，这里只把 ruleId 翻译成人话。
 */
export const RISK_RULE_LABELS: Record<RiskItem["ruleId"], string> = {
  overdue_task: "存在逾期未完成任务",
  blocked_task: "任务阻塞超过约定天数",
  iteration_progress: "当前迭代进度落后",
  inactive_project: "活跃项目连续无活动",
};

function pairs(record: Record<string, number | string>): string {
  const entries = Object.entries(record);
  if (entries.length === 0) return "—";
  return entries.map(([key, value]) => `${key}=${value}`).join("，");
}

/**
 * 透明风险卡（固定路径 `@/components/projects/risk-card`，props 见第 9.1 / 9.6 节）。
 *
 * 只展示 E-K01 给出的规则名、消息、阈值、观察值和真实来源；
 * 不在浏览器里另算一套阈值，也不做评分、排名或能力判断。
 */
export function RiskCard({ item }: { item: RiskItem }) {
  return (
    <article className="ac-card space-y-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="ac-badge bg-high-soft text-high">
          {RISK_RULE_LABELS[item.ruleId] ?? item.ruleId}
        </span>
        <span className="text-[11px] text-ink-faint">规则 {item.ruleId}</span>
      </div>

      <p className="break-words text-sm text-ink">{item.message}</p>

      <p className="break-words text-xs text-ink-faint">
        阈值：{pairs(item.threshold)} · 观察值：{pairs(item.observedValue)}
      </p>
      <p className="text-[11px] text-ink-faint">
        评估时间 {formatAsOf(item.evaluatedAt)}
      </p>

      {item.sourceRefs.length > 0 && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {item.sourceRefs.map((ref) => {
            const key = `${ref.sourceKind}:${ref.sourceId}`;
            if (ref.sourceHref && ref.availability === "available") {
              return (
                <li key={key}>
                  <Link href={ref.sourceHref} className="text-primary underline">
                    {ref.sourceKind === "task"
                      ? "打开任务"
                      : ref.sourceKind === "iteration"
                        ? "打开迭代"
                        : ref.sourceKind === "deliverable"
                          ? "打开成果"
                          : "打开来源"}
                  </Link>
                </li>
              );
            }
            return (
              <li key={key} className="text-ink-faint">
                来源
                {ref.availability === "deleted" ? "已删除" : "不可用"}
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}
