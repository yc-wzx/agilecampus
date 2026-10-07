"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type {
  ConfirmIterationDraftInput,
  ConfirmIterationDraftResult,
  PreviewIterationDraftResult,
  Result,
} from "@/contracts/p0-p2";
import { runAction } from "@/lib/action-result";
import { confirmIterationDraft, previewIterationDraft } from "@/lib/agent/iteration-draft";

// C / P2：AI 迭代草案的 Action 入口（定稿 §9.9 路径表）。
//
// 这个文件**由 E 主维护**，C 只往里面放自己那两个函数的包装：
//   - C-AI01 `previewIterationDraftAction` —— 校验草案能不能确认（C 实现）
//   - C-AI02 `confirmIterationDraftAction` —— 事务确认（C 实现）
//
// 以下三个入口属于 E，C 不代为实现，留在这里以免两边各建一份 Action：
//   - E-AI05 `generateIterationDraftAction(projectId, {requestId, conversationId, prompt})`
//     生成待确认草案。只存草案，不创建/移动任何业务任务；候选任务可先取
//     `suggestIterationCandidates`（C 提供）作为基线。
//   - E-AI06 `cancelIterationDraftAction(projectId, draftId, {requestId, expectedRevision})`
//     → `{draftId, status:"cancelled"}`，不修改项目任务。
//   - `updateIterationDraftAction(projectId, draftId, {requestId, expectedRevision, name?, goal?,
//     startDate?, endDate?, taskIds?})` → IterationDraft。只改 pending 草案，改完要重新写回
//     候选任务的版本基线，同样不触业务数据。
//
// 会话相关的 E-AI01—03 不在这个文件：它们复用 /api/chat，不走 Server Action。

const draftId = z.uuid("草案 id 不合法");
const requestId = z.uuid("请求标识不合法");
const instant = z.string().refine((s) => !Number.isNaN(new Date(s).getTime()), "时间格式不正确");

const confirmSchema = z.object({
  requestId,
  expectedDraftRevision: z.number().int("版本号必须是整数").positive("版本号不合法"),
  expectedTaskVersions: z
    .array(z.object({ taskId: z.uuid("任务 id 不合法"), updatedAt: instant }))
    .max(500, "一次最多处理 500 个任务"),
});

function invalid(error: z.ZodError): Result<never> {
  return { ok: false, code: "VALIDATION", error: error.issues[0].message };
}

function refresh(projectId: string) {
  try {
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/iterations`);
    revalidatePath(`/projects/${projectId}/ai-drafts`);
  } catch {
    console.error("[ai-drafts] cache refresh failed");
  }
}

/** C-AI01。读，不落库（除过期的落列），因此不需要 refresh。 */
export async function previewIterationDraftAction(
  projectId: string,
  draftIdInput: string,
): Promise<Result<PreviewIterationDraftResult>> {
  const parsed = z
    .object({ projectId: z.uuid("项目 id 不合法"), draftId })
    .safeParse({ projectId, draftId: draftIdInput });
  if (!parsed.success) return invalid(parsed.error);

  return runAction((actorId) =>
    previewIterationDraft(actorId, parsed.data.projectId, parsed.data.draftId),
  );
}

/**
 * C-AI02。确认后建出一轮 planned 迭代并归入任务——不自动开始，也不替教师审核。
 * 已确认的同一草案重放返回原迭代（`replayed: true`），不会再建第二轮。
 */
export async function confirmIterationDraftAction(
  projectId: string,
  draftIdInput: string,
  input: ConfirmIterationDraftInput,
): Promise<Result<ConfirmIterationDraftResult>> {
  const parsed = confirmSchema
    .extend({ projectId: z.uuid("项目 id 不合法"), draftId })
    .safeParse({ ...input, projectId, draftId: draftIdInput });
  if (!parsed.success) return invalid(parsed.error);

  const { projectId: pid, draftId: did, ...rest } = parsed.data;
  const result = await runAction((actorId) => confirmIterationDraft(actorId, pid, did, rest));
  if (result.ok) refresh(pid);
  return result;
}
