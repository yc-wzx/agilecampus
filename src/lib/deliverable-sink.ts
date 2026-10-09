import { and, eq } from "drizzle-orm";
import { db, type DbTx } from "@/db";
import { deliverables, deliverableVersions, milestones, tasks } from "@/db/schema";
import type { RecordProjectActivityInput } from "@/contracts/p0-p2";
import { recordProjectActivity } from "./activity";
import type { DeliverableEvent } from "./deliverable-events";
import { ValidationError } from "./errors";
import { recordNotificationIntent } from "./notifications";

// E / P0：成果 outbox 的消费端（定稿 §8「合并 sink」的 E 部分）。
//
// 定稿 §8 只允许有一个 sink，E/F 共用；F 落地后必须在 **同一个** handleDeliverableEvent
// 里接着往下写，不得另建第二个 dispatcher——两个消费端会让同一事件被投递两次。
// 通知意图（F 的部分）就加在下面标注的位置，与活动同事务。
//
// 投递语义是 at-least-once：sink 成功、dispatch 更新 deliveredAt 前崩溃，事件会被重投。
// 所以写入必须幂等——活动用 outbox 的 eventKey 直接当活动事件键，重放只会撞唯一索引。

/** 活动摘要里要用的可读名称。查不到（成果被删等）就是 null，摘要退回不带名称的说法。 */
export type DeliverableEventTitles = {
  deliverableTitle?: string | null;
  milestoneTitle?: string | null;
  taskTitle?: string | null;
};

const titleOf = (title: string | null | undefined, fallback: string) =>
  title ? `《${title}》${fallback}` : fallback;

/** 取 payload 里必需的几个键。缺一个就报错——宁可重试，也不写一条内容残缺的活动。 */
function requirePayload(event: DeliverableEvent, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = event.payload?.[key];
    if (typeof value !== "string" || value === "") {
      throw new ValidationError(`事件 ${event.type} 缺少 payload.${key}`);
    }
    out[key] = value;
  }
  return out;
}

/**
 * 纯函数：把一条 outbox 事件翻成一条活动，不碰数据库，便于单测。
 *
 * payload 里本来就只有 ID，这里也只把 ID 与状态放进 metadata（与 ACTIVITY_EVENT_TYPES 的
 * metadata 白名单逐一对应）；成果描述、反馈正文这些字段从不进活动表——活动是公开动态，
 * 正文的可见范围由成果模块自己管。
 *
 * 未登记的类型直接抛错：宁可让这条事件卡在 outbox 里等人处理，也不静默丢掉。
 */
export function mapDeliverableEventToActivity(
  event: DeliverableEvent,
  titles: DeliverableEventTitles = {},
): RecordProjectActivityInput {
  const base = {
    eventKey: event.eventKey,
    projectId: event.projectId,
    actorId: event.actorId,
    occurredAt: event.createdAt.toISOString(),
  };

  switch (event.type) {
    case "deliverable.submitted": {
      const payload = requirePayload(event, ["deliverableId", "versionId"]);
      return {
        ...base,
        objectType: "deliverable",
        objectId: payload.deliverableId,
        type: "deliverable.submitted",
        summary: `提交了成果${titleOf(titles.deliverableTitle, "")}`.trim(),
        metadata: payload,
      };
    }
    case "deliverable.approved":
    case "deliverable.changes_requested": {
      const payload = requirePayload(event, ["deliverableId", "versionId", "feedbackId", "decision"]);
      const verb = event.type === "deliverable.approved" ? "通过了" : "退回了";
      return {
        ...base,
        objectType: "deliverable",
        objectId: payload.deliverableId,
        type: event.type,
        summary: `${verb}成果${titleOf(titles.deliverableTitle, "")}`.trim(),
        metadata: payload,
      };
    }
    case "milestone.feedback": {
      const payload = requirePayload(event, ["milestoneId", "feedbackId"]);
      return {
        ...base,
        objectType: "feedback",
        objectId: payload.feedbackId,
        type: "milestone.feedback",
        summary: `给里程碑${titleOf(titles.milestoneTitle, "留下了反馈")}`,
        metadata: payload,
      };
    }
    case "feedback.task_created": {
      const payload = requirePayload(event, ["feedbackId", "taskId"]);
      return {
        ...base,
        objectType: "task",
        objectId: payload.taskId,
        type: "feedback.task_created",
        summary: `把反馈转成了任务${titleOf(titles.taskTitle, "")}`.trim(),
        metadata: payload,
      };
    }
    default:
      throw new ValidationError(`未登记的活动事件类型：${event.type}`);
  }
}

/** 在同一事务里把摘要要用的名称查出来。查不到就返回 null，摘要如实退化成不带名称的说法。 */
async function lookupTitles(
  tx: DbTx,
  event: DeliverableEvent,
): Promise<DeliverableEventTitles> {
  switch (event.type) {
    case "deliverable.submitted":
    case "deliverable.approved":
    case "deliverable.changes_requested": {
      const id = event.payload?.versionId;
      if (!id) return {};
      const [row] = await tx
        .select({ title: deliverableVersions.title })
        .from(deliverableVersions)
        .innerJoin(deliverables, eq(deliverables.id, deliverableVersions.deliverableId))
        .where(and(eq(deliverableVersions.id, id), eq(deliverables.projectId, event.projectId)));
      return { deliverableTitle: row?.title ?? null };
    }
    case "milestone.feedback": {
      const id = event.payload?.milestoneId;
      if (!id) return {};
      const [row] = await tx
        .select({ title: milestones.title })
        .from(milestones)
        .where(eq(milestones.id, id));
      return { milestoneTitle: row?.title ?? null };
    }
    case "feedback.task_created": {
      const id = event.payload?.taskId;
      if (!id) return {};
      const [row] = await tx
        .select({ title: tasks.title })
        .from(tasks)
        .where(eq(tasks.id, id));
      return { taskTitle: row?.title ?? null };
    }
    default:
      return {};
  }
}

/**
 * 交给 `dispatchDeliverableEvents` 的 sink。
 *
 * 自己开事务：抛异常时只回滚这里写下的活动，outbox 那行的 deliveredAt 保持为空、
 * 下一轮重投（`deliverable-events.ts` 的 dispatcher 只在 sink 正常返回后才标记已投递）。
 * 绝不能吞异常——吞了就等于把事件丢了。
 */
export async function handleDeliverableEvent(event: DeliverableEvent): Promise<void> {
  await db.transaction(async (tx) => {
    const titles = await lookupTitles(tx, event);
    const activity = mapDeliverableEventToActivity(event, titles);
    await recordProjectActivity(tx, activity);
    const deliverableId = event.payload.deliverableId;
    const taskId = event.payload.taskId;
    const sourceKind = deliverableId ? "deliverable" as const : taskId ? "task" as const : "feedback" as const;
    const sourceId = deliverableId ?? taskId ?? event.payload.feedbackId;
    const params = new URLSearchParams();
    if (event.payload.versionId) params.set("versionId", event.payload.versionId);
    if (event.payload.feedbackId) params.set("feedbackId", event.payload.feedbackId);
    const sourceHref = deliverableId ? `/projects/${event.projectId}/deliverables/${deliverableId}?${params}`
      : taskId ? `/projects/${event.projectId}?task=${taskId}` : null;
    await recordNotificationIntent(tx, { eventKey: event.eventKey, projectId: event.projectId, actorId: event.actorId,
      type: event.type, recipientIds: event.recipientIds, summary: activity.summary,
      sourceRef: { sourceKind, sourceId, projectId: event.projectId, sourceHref,
        evidenceKey: `deliverable-event:${event.eventKey}`, availability: "available" },
    });
  });
}
