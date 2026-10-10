"use server";
import { runAction } from "@/lib/action-result";
import { exportProjectEvidenceMarkdown } from "@/lib/evidence";
export async function exportProjectEvidenceMarkdownAction(
  projectId: string,
  input: Parameters<typeof exportProjectEvidenceMarkdown>[2],
) {
  return runAction((actor) =>
    exportProjectEvidenceMarkdown(actor, projectId, input),
  );
}
