"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import {
  type CompleteIterationInput,
  type CompleteIterationResult,
  type CreateIterationInput,
  type DeletePlannedIterationResult,
  type Iteration,
  type IterationCompletionPreview,
  type IterationRevisionInput,
  type Result,
  type SaveRetrospectiveInput,
  type SaveRetrospectiveResult,
  type UpdateIterationInput,
} from "@/contracts/p0-p2";
import { runAction } from "@/lib/action-result";
import {
  completeIteration,
  createIteration,
  deletePlannedIteration,
  previewIterationCompletion,
  saveIterationRetrospective,
  startIteration,
  updateIteration,
} from "@/lib/iteration";

// C：迭代生命周期的 Action（定稿 §9.3）。C-I01/02/05/07/10/11。
//
// 任务池排序与入轮/移出（C-T03/04/05）不在这里——定稿把它们的导入路径钉在
// `.../tasks/actions.ts`，与本文件同属 C，但消费者要从那边 import。
//
// AI 迭代草案的入口不在这里——定稿把 C-AI02 与 E 的 E-AI05/06 一并放在
// `.../ai-drafts/actions.ts`，由 E 主维护。这里只保留人工创建与结束迭代这条线。

const requestId = z.uuid("请求标识不合法");
const instant = z
  .string()
  .refine((s) => !Number.isNaN(new Date(s).getTime()), "时间格式不正确");
const revision = z.number().int("版本号必须是整数").positive("版本号不合法");

const iterationName = z
  .string()
  .trim()
  .min(1, "请填写迭代名称")
  .max(200, "迭代名称最多 200 字");
const goal = z.string().max(10000, "迭代目标最多 10000 字").nullish();

const createIterationSchema = z.strictObject({
  requestId,
  name: iterationName,
  goal,
  startDate: z.iso.date("开始日期格式不正确"),
  endDate: z.iso.date("结束日期格式不正确"),
});

const updateIterationSchema = z.strictObject({
  requestId,
  expectedRevision: revision,
  name: iterationName.optional(),
  goal,
  startDate: z.iso.date("开始日期格式不正确").optional(),
  endDate: z.iso.date("结束日期格式不正确").optional(),
});

const revisionSchema = z.strictObject({ requestId, expectedRevision: revision });

/** 入轮/移出：每个任务都要带自己的版本，服务层逐个锁行比对。 */


/* --- P1：结束迭代、历史与复盘 --- */

/** 预览基线：一个任务一条，结束时要原样回传。 */
const taskVersionsSchema = z
  .array(z.strictObject({ taskId: z.uuid("任务 id 不合法"), updatedAt: instant }))
  .max(500, "一次最多处理 500 个任务");

/** 未完成任务的去向。服务层还会核对「是否恰好覆盖全部未完成主任务」，这里只管形状。 */
const dispositionSchema = z
  .array(
    z.strictObject({
      taskId: z.uuid("任务 id 不合法"),
      destination: z.enum(["backlog", "iteration"], "去向只能是任务池或另一轮迭代"),
      targetIterationId: z.uuid("目标迭代 id 不合法").optional(),
    }),
  )
  .max(500, "一次最多处理 500 个任务");

const completeSchema = z.strictObject({
  requestId,
  expectedRevision: revision,
  taskVersions: taskVersionsSchema,
  unfinishedDisposition: dispositionSchema,
});

const retroText = z.string().max(10000, "复盘内容最多 10000 字").nullish();

const retrospectiveSchema = z.strictObject({
  requestId,
  expectedRevision: z.number().int("版本号必须是整数").positive("版本号不合法").optional(),
  wentWell: retroText,
  problems: retroText,
  nextActions: retroText,
});

function invalid(error: z.ZodError): Result<never> {
  return { ok: false, code: "VALIDATION", error: error.issues[0].message };
}

function refresh(projectId: string, extra?: string) {
  try {
    revalidatePath(`/projects/${projectId}`, "layout");
    revalidatePath("/dashboard");
    revalidatePath("/projects");
    revalidatePath(`/projects/${projectId}/iterations`);
    if (extra) revalidatePath(extra);
  } catch {
    console.error("[iterations] cache refresh failed");
  }
}

/* --- 写 --- */

export async function createIterationAction(
  projectId: string,
  input: CreateIterationInput,
): Promise<Result<Iteration>> {
  const parsed = createIterationSchema
    .extend({ projectId: z.uuid("项目 id 不合法") })
    .safeParse({ ...input, projectId });
  if (!parsed.success) return invalid(parsed.error);

  const { projectId: pid, ...rest } = parsed.data;
  const result = await runAction((actorId) => createIteration(actorId, pid, rest));
  if (result.ok) refresh(pid);
  return result;
}

export async function updateIterationAction(
  projectId: string,
  iterationId: string,
  input: UpdateIterationInput,
): Promise<Result<Iteration>> {
  const parsed = updateIterationSchema
    .extend({ projectId: z.uuid("项目 id 不合法"), iterationId: z.uuid("迭代 id 不合法") })
    .refine((data) => [data.name, data.goal, data.startDate, data.endDate].some((v) => v !== undefined), "至少修改一个迭代字段")
    .safeParse({ ...input, projectId, iterationId });
  if (!parsed.success) return invalid(parsed.error);

  const { projectId: pid, iterationId: iid, ...rest } = parsed.data;
  const result = await runAction((actorId) => updateIteration(actorId, pid, iid, rest));
  if (result.ok) refresh(pid);
  return result;
}

export async function startIterationAction(
  projectId: string,
  iterationId: string,
  input: IterationRevisionInput,
): Promise<Result<Iteration>> {
  const parsed = revisionSchema
    .extend({ projectId: z.uuid("项目 id 不合法"), iterationId: z.uuid("迭代 id 不合法") })
    .safeParse({ ...input, projectId, iterationId });
  if (!parsed.success) return invalid(parsed.error);

  const { projectId: pid, iterationId: iid, ...rest } = parsed.data;
  const result = await runAction((actorId) => startIteration(actorId, pid, iid, rest));
  if (result.ok) refresh(pid);
  return result;
}

/* --- P1：结束迭代、历史与复盘 --- */

/** C-I06。结束确认表单的取数入口：纯读，不落库，也就不需要 refresh。 */
export async function previewIterationCompletionAction(
  projectId: string,
  iterationId: string,
): Promise<Result<IterationCompletionPreview>> {
  const parsed = z
    .strictObject({ projectId: z.uuid(), iterationId: z.uuid() })
    .safeParse({ projectId, iterationId });
  if (!parsed.success) return invalid(parsed.error);
  return runAction((actorId) =>
    previewIterationCompletion(actorId, parsed.data.projectId, parsed.data.iterationId),
  );
}

export async function completeIterationAction(
  projectId: string,
  iterationId: string,
  input: CompleteIterationInput,
): Promise<Result<CompleteIterationResult>> {
  const parsed = completeSchema
    .extend({ projectId: z.uuid("项目 id 不合法"), iterationId: z.uuid("迭代 id 不合法") })
    .safeParse({ ...input, projectId, iterationId });
  if (!parsed.success) return invalid(parsed.error);

  const { projectId: pid, iterationId: iid, ...rest } = parsed.data;
  const result = await runAction((actorId) => completeIteration(actorId, pid, iid, rest));
  if (result.ok) refresh(pid);
  return result;
}

/** C-I08。不可变快照；没结束过的轮返回 null（不是抛错）。 */
export async function saveIterationRetrospectiveAction(
  projectId: string,
  iterationId: string,
  input: SaveRetrospectiveInput,
): Promise<Result<SaveRetrospectiveResult>> {
  const parsed = retrospectiveSchema
    .extend({ projectId: z.uuid("项目 id 不合法"), iterationId: z.uuid("迭代 id 不合法") })
    .safeParse({ ...input, projectId, iterationId });
  if (!parsed.success) return invalid(parsed.error);

  const { projectId: pid, iterationId: iid, ...rest } = parsed.data;
  const result = await runAction((actorId) => saveIterationRetrospective(actorId, pid, iid, rest));
  if (result.ok) refresh(pid);
  return result;
}

/** C-I11。删的是轮，不是任务：关联任务在同一事务里退回任务池。 */
export async function deletePlannedIterationAction(
  projectId: string,
  iterationId: string,
  input: IterationRevisionInput,
): Promise<Result<DeletePlannedIterationResult>> {
  const parsed = revisionSchema
    .extend({ projectId: z.uuid("项目 id 不合法"), iterationId: z.uuid("迭代 id 不合法") })
    .safeParse({ ...input, projectId, iterationId });
  if (!parsed.success) return invalid(parsed.error);

  const { projectId: pid, iterationId: iid, ...rest } = parsed.data;
  const result = await runAction((actorId) => deletePlannedIteration(actorId, pid, iid, rest));
  if (result.ok) refresh(pid);
  return result;
}
