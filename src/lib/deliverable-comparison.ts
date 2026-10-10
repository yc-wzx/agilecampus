import { diffChars, type Change } from "diff";
import { z } from "zod";
import { getDeliverableDetail } from "./deliverable";
import { AppError } from "./errors";

export function compareText(
  before: string,
  after: string,
): { changes: Change[]; simplified: boolean } {
  // Bound worst-case work on deliberately dissimilar 10,000-character submissions.
  const changes = diffChars(before, after, { timeout: 100 });
  return changes
    ? { changes, simplified: false }
    : {
        changes: [
          { value: before, count: before.length, removed: true, added: false },
          { value: after, count: after.length, added: true, removed: false },
        ],
        simplified: true,
      };
}

export async function getDeliverableComparison(
  actorId: string,
  projectId: string,
  deliverableId: string,
  fromId: string,
  toId: string,
) {
  if (![fromId, toId].every((id) => z.uuid().safeParse(id).success))
    throw new AppError("请选择有效的提交版本");
  const detail = await getDeliverableDetail(actorId, projectId, deliverableId);
  const from = detail.versions.find((v) => v.id === fromId);
  const to = detail.versions.find((v) => v.id === toId);
  if (!from || !to) throw new AppError("只能比较同一成果的已提交版本");
  return {
    from: {
      id: from.id,
      number: from.versionNumber,
      submittedAt: from.submittedAt,
    },
    to: { id: to.id, number: to.versionNumber, submittedAt: to.submittedAt },
    title: compareText(from.title, to.title),
    description: compareText(from.description, to.description),
    links: { before: from.url, after: to.url, changed: from.url !== to.url },
    metadata: {
      type: { before: from.type, after: to.type },
      milestone: { before: from.milestoneTitle, after: to.milestoneTitle },
    },
    changed:
      from.title !== to.title ||
      from.description !== to.description ||
      from.url !== to.url ||
      from.type !== to.type ||
      from.milestoneId !== to.milestoneId ||
      from.milestoneTitle !== to.milestoneTitle,
  };
}
