import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import type { DbTx } from "@/db";
import { iterationDrafts, tasks, writeRequests } from "@/db/schema";
import { PAGE_LIMIT_MAX } from "@/contracts/p0-p2";
import type {
  ConfirmIterationDraftInput,
  ConfirmIterationDraftResult,
  IterationDraft,
  IterationDraftCandidateTask,
  IterationDraftValidation,
  IterationTaskVersion,
  PreviewIterationDraftResult,
  TaskSummary,
} from "@/contracts/p0-p2";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { createIterationWithTasksTx } from "@/lib/iteration";
import { getProjectForUser } from "@/lib/project";
import { lockTaskWriteAccess } from "@/lib/task-write-access";
import { claimWriteRequest, finishWriteRequest, hashRequest } from "@/lib/write-request";
import { requireTaskWrite } from "@/lib/task";
import { listBacklog } from "@/lib/task-contract";

// C / P2：AI 迭代草案的业务读取与事务确认（定稿 9.9 的 C-AI01、C-AI02）。
//
// 分工写死在定稿里：草案**由 E 生成并存储**（E-AI05/E-AI06），C 只做两件事——
//   1. C-AI01 预览：逐条核对草案里的任务此刻还能不能入轮，把真实版本基线交出去；
//   2. C-AI02 确认：一个事务里建 planned 轮 + 归任务 + 把草案标记为已确认。
// 表 iteration_drafts 由 C 统一建（C 负责数据库整合），E 往里面写自己的生成结果。
// 这里不另存第二份草案，也不做任何模型调用。

/**
 * 草案有效期：定稿写死 24 小时。
 * 导出给 E-AI05 生成草案时算 `expiresAt`，免得两边各写一个数字。
 */
export const DRAFT_TTL_MS = 24 * 3600 * 1000;

type DraftRow = typeof iterationDrafts.$inferSelect;

/**
 * 过期是**算**出来的，不是等谁来改列。
 *
 * 存下来的 status 只可能是 pending/confirmed/cancelled 三种（没人会定时来把
 * pending 刷成 expired），所以「已过期」只能由 expiresAt 现算。预览时顺手把这一条
 * 落回列里（条件更新、原子），好让 E 的草案列表也能照常按 status 展示。
 */
function isExpired(row: DraftRow, now = new Date()): boolean {
  return row.status === "pending" && row.expiresAt.getTime() <= now.getTime();
}

/** status 列是 text，落库的只可能是这四个值（E-AI05/06 与 C-AI02 都只写它们）。 */
function toDraftStatus(value: string): IterationDraft["status"] {
  return value as IterationDraft["status"];
}

function toIterationDraft(row: DraftRow, status: string): IterationDraft {
  return {
    id: row.id,
    projectId: row.projectId,
    createdById: row.createdById,
    conversationId: row.conversationId,
    status: toDraftStatus(status),
    revision: row.revision,
    name: row.name,
    goal: row.goal,
    startDate: row.startDate,
    endDate: row.endDate,
    candidateTasks: (row.candidateTasks ?? []) as IterationDraftCandidateTask[],
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    sourceRefs: (row.sourceRefs ?? []) as IterationDraft["sourceRefs"],
  };
}

/** 草案里的候选任务，去重后取 taskId 列表（E 生成时理论上不会重复，服务端不假定）。 */
function candidateIds(row: DraftRow): string[] {
  const list = (row.candidateTasks ?? []) as IterationDraftCandidateTask[];
  return [...new Set(list.map((c) => c.taskId))];
}

/**
 * 读一条草案并校验归属。草案属于项目，能看项目才看得到草案。
 * 草案可能包含私有 AI 对话信息，只允许创建者读取。
 */
async function loadDraft(
  actorId: string,
  projectId: string,
  draftId: string,
): Promise<DraftRow> {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new NotFoundError("项目不存在或无权访问");

  const [row] = await db
    .select()
    .from(iterationDrafts)
    .where(and(eq(iterationDrafts.id, draftId), eq(iterationDrafts.projectId, projectId)));
  if (!row || row.createdById !== actorId) throw new NotFoundError("草案不存在或无权访问");
  return row;
}

/**
 * C-AI01 预览：草案能不能确认、每个候选任务此刻的版本。
 *
 * 同时校验草案生成时的任务版本；不能用重新预览悄悄接受已过时的 AI 方案。
 *
 * 草案本身的问题（已取消/已过期/名称为空/日期倒置）没有 taskId 可挂，
 * 统一表现为 valid=false 且 conflicts 为空——详见 IterationDraftValidation 的注释。
 */
export async function previewIterationDraft(
  actorId: string,
  projectId: string,
  draftId: string,
): Promise<PreviewIterationDraftResult> {
  let row = await loadDraft(actorId, projectId, draftId);

  // 顺手把过期落回列里：条件更新，谁先到谁生效，不会重复写。
  if (isExpired(row)) {
    const [flipped] = await db
      .update(iterationDrafts)
      .set({ status: "expired" })
      .where(
        and(
          eq(iterationDrafts.id, row.id),
          eq(iterationDrafts.status, "pending"),
        ),
      )
      .returning();
    if (flipped) row = flipped;
  }

  const ids = candidateIds(row);
  const rows = ids.length
    ? await db
        .select({
          id: tasks.id,
          title: tasks.title,
          status: tasks.status,
          sprintId: tasks.sprintId,
          parentTaskId: tasks.parentTaskId,
          updatedAt: tasks.updatedAt,
        })
        .from(tasks)
        .where(and(eq(tasks.projectId, projectId), inArray(tasks.id, ids)))
    : [];
  const byId = new Map(rows.map((t) => [t.id, t]));
  const baseline = new Map((row.candidateTasks as IterationDraftCandidateTask[]).map((c) => [c.taskId, c.expectedUpdatedAt]));

  const conflicts: IterationDraftValidation["conflicts"] = [];
  const currentTaskVersions: IterationTaskVersion[] = [];
  for (const taskId of ids) {
    const task = byId.get(taskId);
    if (!task) {
      conflicts.push({ taskId, reason: "任务不存在或已被删除" });
      continue;
    }
    if (new Date(baseline.get(taskId) ?? "").getTime() !== task.updatedAt.getTime()) {
      conflicts.push({ taskId, reason: "任务在草案生成后已被修改，请更新或重新生成草案" });
    }
    if (task.status === "done") {
      conflicts.push({ taskId, reason: "任务已完成，不必再排进新一轮" });
    } else if (task.sprintId !== null) {
      conflicts.push({ taskId, reason: "任务已被排入其他迭代" });
    } else if (task.parentTaskId !== null) {
      conflicts.push({ taskId, reason: "子任务跟随父任务入轮，不能单独选择" });
    }
    currentTaskVersions.push({ taskId, updatedAt: task.updatedAt.toISOString() });
  }

  const draft = toIterationDraft(row, row.status);
  const draftLevelOk =
    draft.status === "pending" && draft.name.trim().length > 0 && draft.startDate <= draft.endDate;

  return {
    draft,
    validation: { valid: draftLevelOk && conflicts.length === 0, conflicts },
    currentTaskVersions,
  };
}

/**
 * C-AI02 确认草案。
 *
 * 使用 write_requests 保存原始确认结果；重放仍检查当前权限并核对请求内容。
 *
 * 确认全程只做一件事：建一轮 planned 并归任务。不自动开始，也不替教师审核。
 * 冲突一律整体拒绝、不部分写入——调用方刷新后重新确认。
 */
export async function confirmIterationDraft(
  actorId: string,
  projectId: string,
  draftId: string,
  input: ConfirmIterationDraftInput,
): Promise<ConfirmIterationDraftResult> {
  // 定稿：确认时仍需 student/admin 的任务/迭代写权限，光「是创建者」不够。
  await requireTaskWrite(actorId, projectId);

  return db.transaction(async (tx) => {
    await lockTaskWriteAccess(tx, actorId, projectId);
    const { requestId, ...content } = input;
    const requestHash = hashRequest({ draftId, ...content });
    const key = { projectId, actorId, operation: "iteration.confirm_draft", requestId };
    const claim = await claimWriteRequest(tx, key, requestHash);
    if (claim.replay) return { ...(claim.result as ConfirmIterationDraftResult), replayed: true };
    const result = await confirmInTx(tx, actorId, projectId, draftId, input, requestHash);
    return finishWriteRequest(tx, claim.id, result);
  });
}

async function confirmInTx(
  tx: DbTx,
  actorId: string,
  projectId: string,
  draftId: string,
  input: ConfirmIterationDraftInput,
  requestHash: string,
): Promise<ConfirmIterationDraftResult> {
  const [row] = await tx
    .select()
    .from(iterationDrafts)
    .where(and(eq(iterationDrafts.id, draftId), eq(iterationDrafts.projectId, projectId)))
    .for("update");
  if (!row) throw new NotFoundError("草案不存在");

  // 只有创建者能确认。admin 也不行——草案是某个人跟 AI 谈出来的，别人替他说「就按这个办」
  // 既不合适也无从追责。
  if (row.createdById !== actorId) {
    throw new ForbiddenError("只有草案创建者可以确认");
  }

  if (row.status === "confirmed") {
    if (!row.confirmedIterationId) {
      throw new ConflictError("草案状态异常，请重新生成");
    }
    const [original] = await tx.select({ result: writeRequests.result }).from(writeRequests).where(and(
      eq(writeRequests.projectId, projectId), eq(writeRequests.actorId, actorId),
      eq(writeRequests.operation, "iteration.confirm_draft"), eq(writeRequests.requestHash, requestHash), isNotNull(writeRequests.result),
    ));
    if (!original?.result) throw new ConflictError("草案已经确认，请查看原迭代");
    return { ...(original.result as ConfirmIterationDraftResult), replayed: true };
  }
  if (row.status === "cancelled") throw new ConflictError("草案已取消，不能确认");
  // status 可能已经被预览落成 expired，也可能刚过期还没落——两种都算过期
  if (row.status === "expired" || isExpired(row)) {
    throw new ConflictError("草案已过期，请重新生成");
  }

  if (row.revision !== input.expectedDraftRevision) {
    throw new ConflictError("草案已被修改，请刷新后重试");
  }

  const ids = candidateIds(row);
  const baseline = new Map((row.candidateTasks as IterationDraftCandidateTask[]).map((c) => [c.taskId, c.expectedUpdatedAt]));
  for (const version of input.expectedTaskVersions) {
    if (new Date(baseline.get(version.taskId) ?? "").getTime() !== new Date(version.updatedAt).getTime()) {
      throw new ConflictError("任务在草案生成后已被修改，请更新或重新生成草案，然后请重新预览");
    }
  }
  const versionOf = new Map(input.expectedTaskVersions.map((v) => [v.taskId, v.updatedAt]));
  if (versionOf.size !== ids.length || ids.some((id) => !versionOf.has(id))) {
    throw new ConflictError("草案中的任务已被改动，请重新预览");
  }

  // 建轮 + 归任务。任务版本、是否还在任务池、是否被别轮占用，都在这里一次核完；
  // 任何一个对不上就整笔回滚。
  const created = await createIterationWithTasksTx(tx, actorId, projectId, {
    name: row.name,
    goal: row.goal,
    startDate: row.startDate,
    endDate: row.endDate,
    taskIds: ids,
    expectedTaskVersions: input.expectedTaskVersions,
  });

  const [updated] = await tx
    .update(iterationDrafts)
    .set({
      status: "confirmed",
      revision: row.revision + 1,
      confirmedIterationId: created.iteration.id,
    })
    .where(eq(iterationDrafts.id, row.id))
    .returning();
  if (!updated) throw new ConflictError("草案已被修改，请刷新后重试");

  return {
    iteration: created.iteration,
    taskIds: created.assignedTaskIds,
    replayed: false,
  };
}

/* ------------------------------------------------------------------ *
 * 供 E-AI05 生成草案时使用的候选任务建议
 * ------------------------------------------------------------------ */

/** 一次建议最多扫描多少个任务池任务。 */
const CANDIDATE_LIMIT = 100;
/** 未给 capacityHint 时的建议条数。 */
const DEFAULT_PROPOSAL_SIZE = 8;

const PRIORITY_WEIGHT: Record<string, number> = { high: 3, medium: 2, low: 1 };

export type IterationCandidateSuggestion = {
  taskId: string;
  expectedUpdatedAt: string;
  reason: string;
};

/**
 * 给 E 的生成入口一批「建议纳入本轮」的任务与理由（定稿 9.9：E生成、C提供可用任务）。
 *
 * 规则刻意做得朴素且可解释——权重和理由一一对应，改动时两边一起改，免得出现
 * 「分数排前面但说不出为什么」的黑箱排序。E 完全可以用自己的模型输出覆盖这份建议，
 * 只是这样一来「为什么选它」至少有一条能对得上的基线。
 */
export async function suggestIterationCandidates(
  actorId: string,
  projectId: string,
  options: { limit?: number; size?: number } = {},
): Promise<IterationCandidateSuggestion[]> {
  if (!(await getProjectForUser(actorId, projectId))) throw new ForbiddenError();

  const poolLimit = Math.min(options.limit ?? CANDIDATE_LIMIT, PAGE_LIMIT_MAX);
  const page = await listBacklog(actorId, projectId, { limit: poolLimit });

  const today = new Date().toISOString().slice(0, 10);
  const scored = page.items
    // 阻塞中的任务不进建议：现在排进本轮，等解阻时迭代多半已经结束了。
    .filter((t) => !t.isBlocked)
    .map((t) => scoreTask(t, today));
  scored.sort((a, b) => b.score - a.score);

  const size = options.size && options.size > 0 ? options.size : DEFAULT_PROPOSAL_SIZE;
  return scored.slice(0, size).map((s) => ({
    taskId: s.task.id,
    expectedUpdatedAt: s.task.updatedAt,
    reason: s.why.join("；"),
  }));
}

function scoreTask(task: TaskSummary, today: string): { task: TaskSummary; score: number; why: string[] } {
  const why: string[] = [];
  let score = PRIORITY_WEIGHT[task.priority] * 10;
  if (task.priority === "high") why.push("优先级高");
  else if (task.priority === "medium") why.push("优先级中");

  if (task.dueDate !== null) {
    if (task.dueDate < today) {
      score += 40;
      why.push("已逾期");
    } else {
      const days = Math.floor(
        (new Date(`${task.dueDate}T00:00:00Z`).getTime() -
          new Date(`${today}T00:00:00Z`).getTime()) /
          86_400_000,
      );
      if (days <= 3) {
        score += 25;
        why.push("三天内到期");
      } else if (days <= 7) {
        score += 15;
        why.push("一周内到期");
      }
    }
  }

  // 已指派的任务推进成本更低：谁做已经清楚，不用再找人。
  if (task.assigneeId) {
    score += 5;
    why.push(`已指派给${task.assigneeName ?? "成员"}`);
  } else {
    why.push("尚未指派");
  }

  if (task.status === "doing") {
    score += 8;
    why.push("已在推进");
  }

  if (why.length === 0) why.push("优先级低、无截止日");
  return { task, score, why };
}
