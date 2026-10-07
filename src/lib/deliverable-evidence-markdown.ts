/**
 * 成果过程证据的 Markdown 组装（纯函数，便于单测）。
 *
 * 数据来自 D 第 7 节的成果证据服务（正式提交 / 版本审核 / 里程碑反馈）；
 * 任务、迭代、评论类证据属于 E 的统一证据（第 9.5 节），交付后由 E-V01 追加。
 *
 * 两条硬性口径：
 * - 身份要分清：作者（成果提交者）不等于操作者（本次提交/反馈的实际执行人），
 *   不能把团队成果写成某成员“独立完成”。
 * - 导出要如实说明范围与截断：达到上限必须写明，不能假装全量。
 */

export type EvidenceExportKind = "submission" | "review" | "milestone_feedback";

export type EvidenceExportItem = {
  evidenceKey: string;
  kind: EvidenceExportKind;
  title: string | null;
  type: string | null;
  authorId: string | null;
  actorId: string;
  occurredAt: string;
  milestoneTitle: string | null;
  versionNumber: number | null;
  decision: string | null;
  comment: string | null;
  description: string | null;
  url: string | null;
  sourceHref: string;
};

/** 导出与列表共用的筛选条件；字段名与 D 第 7 节证据服务的入参一致。 */
export type EvidenceExportFilters = {
  kind?: EvidenceExportKind;
  /** 成果类型枚举，交给 D 的服务校验 */
  type?: string;
  authorId?: string;
  milestoneId?: string;
  /** 北京时间，fromDate 含、toDate 不含 */
  fromDate?: string;
  toDate?: string;
};

export type EvidenceExportInput = {  projectId: string;
  projectName: string;
  filterSummary: string[];
  items: EvidenceExportItem[];
  total: number;
  truncated: boolean;
  generatedAt: string;
  sourceOrigin?: string;
  /** 交付类型的中文名（"报告"/"PPT"…），由调用方注入，避免这里依赖业务映射 */
  typeLabel: (type: string | null) => string;
  nameOf: (userId: string | null) => string;
};

const KIND_TITLES: Record<EvidenceExportKind, string> = {
  submission: "正式提交",
  review: "版本审核",
  milestone_feedback: "里程碑反馈",
};

const DECISION_LABELS: Record<string, string> = {
  approved: "验收通过",
  changes_requested: "要求修改",
  comment: "里程碑反馈",
};

function beijingTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
}

/** Markdown 文本里避免把用户输入当成结构：只做最小转义，不引入 HTML。 */
function inline(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/\r?\n/g, " ").replace(/[\\`*_{}\[\]<>#!|]/g, (character) => `\\${character}`).trim() || "—";
}

export function buildDeliverableEvidenceMarkdown(
  input: EvidenceExportInput,
): { filename: string; markdown: string; exportedCount: number } {
  const {
    projectId,
    projectName,
    filterSummary,
    items,
    total,
    truncated,
    generatedAt,
    typeLabel,
    nameOf,
  } = input;

  const lines: string[] = [];
  lines.push(`# 成果过程证据清单 · ${inline(projectName)}`);
  lines.push("");
  lines.push(`- 生成时间：${beijingTime(generatedAt)}（北京时间）`);
  lines.push(`- 筛选条件：${filterSummary.length > 0 ? filterSummary.map(inline).join("；") : "无（全部）"}`);
  lines.push(
    "- 记录范围：正式提交、版本审核与里程碑反馈；**不含**未提交的私有草稿与历史版本以外的内容。",
  );
  lines.push(
    `- 记录条数：共 ${total} 条，本次导出 ${items.length} 条${truncated ? "（已达到单次导出上限，未包含全部记录）" : "（已全部导出）"}。`,
  );
  lines.push(
    "- 身份说明：**作者**是该成果的提交者，**操作者**是本次提交或反馈的实际执行人。同一份团队成果不代表某个成员的独立贡献，本清单不用于评分或排名。",
  );
  lines.push("");
  lines.push("> 每条记录都带站内来源链接；打开来源仍需登录并具备当前项目权限，不是匿名分享链接。");
  lines.push("");

  const order: EvidenceExportKind[] = [
    "submission",
    "review",
    "milestone_feedback",
  ];

  let index = 0;
  for (const kind of order) {
    const group = items.filter((item) => item.kind === kind);
    if (group.length === 0) continue;
    lines.push(`## ${KIND_TITLES[kind]}（${group.length}）`);
    lines.push("");
    for (const item of group) {
      index += 1;
      const versionLabel =
        item.versionNumber !== null ? `第 ${item.versionNumber} 版` : "无版本";
      lines.push(
        `### ${index}. ${inline(item.title)}${item.kind === "submission" ? ` · ${versionLabel}` : ""}`,
      );
      lines.push(`- 时间：${beijingTime(item.occurredAt)}`);
      lines.push(
        `- 身份：作者 ${inline(nameOf(item.authorId))}；操作者 ${inline(nameOf(item.actorId))}`,
      );
      if (item.kind === "submission") {
        lines.push(`- 类型：${typeLabel(item.type)}`);
        if (item.description) lines.push(`- 说明：${inline(item.description)}`);
        if (item.url) lines.push(`- 链接：${item.url}`);
      } else {
        lines.push(
          `- 决定：${DECISION_LABELS[item.decision ?? ""] ?? item.decision ?? "—"}`,
        );
        if (item.milestoneTitle) {
          lines.push(`- 里程碑：${inline(item.milestoneTitle)}`);
        }
        lines.push(`- 意见：${inline(item.comment)}`);
      }
      lines.push(`- 来源：[打开原始记录](${input.sourceOrigin ? new URL(item.sourceHref, input.sourceOrigin).href : item.sourceHref})`);
      lines.push(`- 证据键：\`${item.evidenceKey}\``);
      lines.push("");
    }
  }

  if (items.length === 0) {
    lines.push("_本次筛选没有符合条件的证据记录。_");
    lines.push("");
  }

  lines.push("---");
  lines.push(
    `项目：${inline(projectName)}（${projectId}）· 生成于 ${beijingTime(generatedAt)}`,
  );

  const stamp = generatedAt.replace(/[-:]/g, "").slice(0, 13);
  return {
    filename: `evidence-${projectId.slice(0, 8)}-${stamp}.md`,
    markdown: lines.join("\n"),
    exportedCount: items.length,
  };
}
