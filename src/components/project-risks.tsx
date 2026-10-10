import { listProjectRisks } from "@/lib/risk";
import { RiskCard, RISK_RULE_LABELS } from "@/components/projects/risk-card";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
export async function ProjectRisks({
  actorId,
  projectId,
}: {
  actorId: string;
  projectId: string;
}) {
  let result;
  try {
    result = await listProjectRisks(actorId, projectId);
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof NotFoundError)
      throw error;
    return (
      <section>
        <h2>需关注的问题</h2>
        <p className="text-sm text-ink-soft">
          风险查询暂时不可用，请刷新重试。
        </p>
      </section>
    );
  }
  return (
    <section className="space-y-3" aria-label="需关注的问题">
      <h2 className="font-semibold">需关注的问题</h2>
      {result.items.length === 0 && (
        <p className="text-sm text-ink-soft">当前没有触发规则的风险</p>
      )}
      {result.items.map((item, n) => (
        <RiskCard key={`${item.ruleId}:${n}`} item={item} />
      ))}
      {result.unknownRules.length > 0 && (
        <p className="text-xs text-ink-soft">
          以下规则因数据不足暂不能判断：
          {result.unknownRules
            .map(
              (rule) => RISK_RULE_LABELS[rule as keyof typeof RISK_RULE_LABELS],
            )
            .join("、")}
        </p>
      )}
    </section>
  );
}
