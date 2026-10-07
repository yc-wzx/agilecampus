import { describe, expect, it } from "vitest";
import {
  buildDeliverableEvidenceMarkdown,
  type EvidenceExportItem,
} from "@/lib/deliverable-evidence-markdown";

const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const NAMES: Record<string, string> = {
  "11111111-1111-4111-8111-111111111111": "张同学",
  "22222222-2222-4222-8222-222222222222": "李老师",
};
const nameOf = (userId: string | null) =>
  userId ? (NAMES[userId] ?? "团队成员") : "团队成员";
const typeLabel = (type: string | null) =>
  type === "report" ? "报告" : (type ?? "—");

const SUBMISSION: EvidenceExportItem = {
  evidenceKey: "submission:res-1",
  kind: "submission",
  title: "用户调研报告",
  type: "report",
  authorId: "11111111-1111-4111-8111-111111111111",
  actorId: "11111111-1111-4111-8111-111111111111",
  occurredAt: "2026-10-05T02:00:00.000Z",
  milestoneTitle: null,
  versionNumber: 1,
  decision: null,
  comment: null,
  description: "第一版调研报告",
  url: "https://example.com/research",
  sourceHref: `/api/projects/${PROJECT_ID}/deliverable-evidence/submission/res-1`,
};

const REVIEW: EvidenceExportItem = {
  evidenceKey: "review:fb-1",
  kind: "review",
  title: "用户调研报告",
  type: "report",
  authorId: "11111111-1111-4111-8111-111111111111",
  actorId: "22222222-2222-4222-8222-222222222222",
  occurredAt: "2026-10-06T02:00:00.000Z",
  milestoneTitle: null,
  versionNumber: 1,
  decision: "changes_requested",
  comment: "请补充三场访谈记录。",
  description: null,
  url: null,
  sourceHref: `/api/projects/${PROJECT_ID}/deliverable-evidence/feedback/fb-1`,
};

function build(items: EvidenceExportItem[], total = items.length, truncated = false) {
  return buildDeliverableEvidenceMarkdown({
    projectId: PROJECT_ID,
    projectName: "赤壁演习",
    filterSummary: ["类别：正式提交"],
    items,
    total,
    truncated,
    generatedAt: "2026-10-07T02:00:00.000Z",
    typeLabel,
    nameOf,
  });
}

describe("buildDeliverableEvidenceMarkdown", () => {
  it("按类别分组，并写清作者与操作者的区别", () => {
    const { markdown } = build([SUBMISSION, REVIEW]);
    expect(markdown).toContain("# 成果过程证据清单 · 赤壁演习");
    expect(markdown).toContain("## 正式提交（1）");
    expect(markdown).toContain("## 版本审核（1）");
    expect(markdown).toContain("作者 张同学；操作者 张同学");
    // 审核的操作者是老师，不能写成作者
    expect(markdown).toContain("作者 张同学；操作者 李老师");
    expect(markdown).toContain("请补充三场访谈记录。");
    expect(markdown).toContain("决定：要求修改");
  });

  it("导出来源使用网站绝对网址，文本不会生成 HTML", () => {
    const { markdown } = buildDeliverableEvidenceMarkdown({
      projectId: PROJECT_ID, projectName: "测试", filterSummary: [],
      items: [{ ...SUBMISSION, description: "<script>alert(1)</script>" }], total: 1,
      truncated: false, generatedAt: "2026-10-07T02:00:00.000Z", typeLabel, nameOf,
      sourceOrigin: "https://campus.example.com",
    });
    expect(markdown).toContain("https://campus.example.com/api/projects/");
    expect(markdown).not.toContain("<script>");
  });

  it("每条都带来源链接与稳定证据键", () => {
    const { markdown } = build([SUBMISSION, REVIEW]);
    expect(markdown).toContain(
      `/api/projects/${PROJECT_ID}/deliverable-evidence/submission/res-1`,
    );
    expect(markdown).toContain(
      `/api/projects/${PROJECT_ID}/deliverable-evidence/feedback/fb-1`,
    );
    expect(markdown).toContain("`submission:res-1`");
    expect(markdown).toContain("`review:fb-1`");
  });

  it("明确声明不含私有草稿，且不用于评分", () => {
    const { markdown } = build([SUBMISSION]);
    expect(markdown).toContain("不含");
    expect(markdown).toContain("私有草稿");
    expect(markdown).toContain("不代表某个成员的独立贡献");
  });

  it("全量导出与截断导出的说明不同，不假装全量", () => {
    const full = build([SUBMISSION], 1, false).markdown;
    expect(full).toContain("已全部导出");

    const cut = build([SUBMISSION], 2500, true).markdown;
    expect(cut).toContain("共 2500 条，本次导出 1 条");
    expect(cut).toContain("未包含全部记录");
    expect(cut).not.toContain("已全部导出");
  });

  it("空结果给明确说明而不是空文件", () => {
    const { markdown } = build([]);
    expect(markdown).toContain("没有符合条件的证据记录");
  });

  it("文件名带项目前缀与时间戳", () => {
    const { filename } = build([SUBMISSION]);
    expect(filename).toBe("evidence-aaaaaaaa-20261007T0200.md");
  });
});
