"use server";

import { auth } from "@/lib/auth";
import type { Result } from "@/contracts/p0-p2";
import { DeliverableError } from "@/lib/deliverable";
import { DELIVERABLE_LABELS } from "@/lib/deliverable-labels";
import {
  buildDeliverableEvidenceMarkdown,
  type EvidenceExportFilters,
  type EvidenceExportItem,
} from "@/lib/deliverable-evidence-markdown";
import {
  listDeliverableEvidence,
  type DeliverableEvidenceOptions,
} from "@/lib/deliverable-reporting";
import { ForbiddenError } from "@/lib/errors";
import { getProjectForUser, listProjectMilestones } from "@/lib/project";
import { listTeamMembers } from "@/lib/team";
import type { DeliverableType } from "@/db/schema";

const PAGE_SIZE = 100;
/** 单次导出上限：达到上限必须如实标注 truncated，不能假装全量 */
const EXPORT_LIMIT = 1000;

const KIND_LABELS: Record<string, string> = {
  submission: "正式提交",
  review: "版本审核",
  milestone_feedback: "里程碑反馈",
};

function optionsFor(
  filters: EvidenceExportFilters,
  offset: number,
): DeliverableEvidenceOptions {
  return {
    offset,
    limit: PAGE_SIZE,
    ...(filters.kind ? { kind: filters.kind } : {}),
    ...(filters.type
      ? { type: filters.type as NonNullable<DeliverableEvidenceOptions["type"]> }
      : {}),
    ...(filters.authorId ? { authorId: filters.authorId } : {}),
    ...(filters.milestoneId ? { milestoneId: filters.milestoneId } : {}),
    ...(filters.fromDate ? { fromDate: filters.fromDate } : {}),
    ...(filters.toDate ? { toDate: filters.toDate } : {}),
  };
}

/**
 * 导出成果过程证据的 Markdown（B 的证据页导出入口）。
 *
 * - 逐页遍历直到结束或达到上限，不只导出当前页（第 9.5 节）。
 * - 身份来自 D 的正式证据：作者与操作者分开，不写“独立完成”。
 * - 任务/迭代/评论类证据属于 E 的统一证据服务，交付后由 E-V01 追加。
 */
export async function exportDeliverableEvidenceMarkdownAction(
  projectId: string,
  filters: EvidenceExportFilters = {},
): Promise<
  Result<{
    filename: string;
    markdown: string;
    total: number;
    exportedCount: number;
    truncated: boolean;
    generatedAt: string;
  }>
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, code: "UNAUTHENTICATED", error: "请先登录" };
  }

  try {
    const access = await getProjectForUser(session.user.id, projectId);
    if (!access) throw new ForbiddenError();

    const collected: EvidenceExportItem[] = [];
    let total = 0;
    let truncated = false;
    let offset = 0;

    for (;;) {
      const page = await listDeliverableEvidence(
        session.user.id,
        projectId,
        optionsFor(filters, offset),
      );
      total = page.total;
      collected.push(...(page.items as EvidenceExportItem[]));

      if (collected.length >= EXPORT_LIMIT) {
        truncated = page.nextOffset !== null || collected.length > EXPORT_LIMIT;
        break;
      }
      if (page.nextOffset === null) break;
      offset = page.nextOffset;
    }

    const items = collected.slice(0, EXPORT_LIMIT);

    // 身份与里程碑名称都要真实；查不到就如实回退，不编造
    const [members, milestones] = await Promise.all([
      listTeamMembers(access.project.teamId),
      filters.milestoneId
        ? listProjectMilestones(session.user.id, projectId)
        : Promise.resolve([] as { id: string; title: string }[]),
    ]);
    const nameOf = (userId: string | null) =>
      members.find((member) => member.id === userId)?.name ?? "团队成员";

    const filterSummary: string[] = [];
    if (filters.kind) filterSummary.push(`类别：${KIND_LABELS[filters.kind] ?? filters.kind}`);
    if (filters.type) {
      filterSummary.push(
        `类型：${DELIVERABLE_LABELS[filters.type as DeliverableType] ?? filters.type}`,
      );
    }
    if (filters.authorId) filterSummary.push(`作者：${nameOf(filters.authorId)}`);
    if (filters.milestoneId) {
      const title =
        milestones.find((milestone) => milestone.id === filters.milestoneId)?.title ??
        filters.milestoneId;
      filterSummary.push(`里程碑：${title}`);
    }
    if (filters.fromDate || filters.toDate) {
      filterSummary.push(
        `日期：${filters.fromDate ?? "最早"} 至 ${filters.toDate ?? "最新"}（结束日不含）`,
      );
    }

    const generatedAt = new Date().toISOString();
    const built = buildDeliverableEvidenceMarkdown({
      projectId,
      projectName: access.project.name,
      filterSummary,
      items,
      total,
      truncated,
      generatedAt,
      typeLabel: (type) =>
        type ? (DELIVERABLE_LABELS[type as DeliverableType] ?? type) : "—",
      nameOf,
    });

    return {
      ok: true,
      data: {
        filename: built.filename,
        markdown: built.markdown,
        total,
        exportedCount: built.exportedCount,
        truncated,
        generatedAt,
      },
    };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, code: "FORBIDDEN", error: error.message };
    }
    if (error instanceof DeliverableError) {
      return { ok: false, code: error.code, error: error.message };
    }
    console.error(
      "[evidence-export] failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    return {
      ok: false,
      code: "INTERNAL",
      error: "导出暂时不可用，请稍后重试。",
    };
  }
}
