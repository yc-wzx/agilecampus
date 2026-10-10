"use server";
import { runAction } from "@/lib/action-result";
import { exportWeeklyReportMarkdown } from "@/lib/report";
export async function exportWeeklyReportMarkdownAction(
  projectId: string,
  input: { weekStart: string },
) {
  return runAction((actor) =>
    exportWeeklyReportMarkdown(actor, projectId, input),
  );
}
