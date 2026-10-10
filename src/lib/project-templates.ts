// Pure configuration, shared by the form and service; no database imports in client bundles.
export const PROJECT_TEMPLATES = [
  {
    id: "blank",
    name: "空白项目",
    summary: "自己安排项目阶段",
    milestones: [],
  },
  {
    id: "course",
    name: "课程项目",
    summary: "从需求到最终展示",
    milestones: ["需求分析", "原型与设计", "开发与测试", "最终展示"],
  },
  {
    id: "research",
    name: "科研项目",
    summary: "从文献调研到研究汇报",
    milestones: ["文献与问题调研", "方案设计", "实验与验证", "研究汇报"],
  },
  {
    id: "competition",
    name: "竞赛项目",
    summary: "从选题到参赛交付",
    milestones: ["选题与调研", "方案与原型", "开发与验证", "参赛材料与演示"],
  },
] as const;
export type ProjectTemplateId = (typeof PROJECT_TEMPLATES)[number]["id"];
