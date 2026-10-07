import type { DeliverableType } from "@/db/schema";
export const DELIVERABLE_LABELS: Record<DeliverableType, string> = {
  report: "报告", presentation: "PPT", video: "视频", survey: "问卷",
  code: "代码", prototype: "原型", demo: "演示", other: "其他",
};
