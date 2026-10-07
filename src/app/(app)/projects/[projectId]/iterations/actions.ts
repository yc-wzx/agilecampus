"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import {
  type AssignTasksInput,
  type AssignTasksResult,
  type CreateIterationInput,
  type CurrentIteration,
  type Iteration,
  type IterationDetail,
  type IterationRevisionInput,
  type PageResult,
  type ReorderBacklogInput,
  type ReorderBacklogResult,
  type Result,
  type UpdateIterationInput,
} from "@/contracts/p0-p2";
import { runAction } from "@/lib/action-result";
import {
  assignTasks,
  createIteration,
  getCurrentIteration,
  getIterationDetail,
  listProjectIterations,
  removeTasks,
  reorderBacklog,
  startIteration,
  updateIteration,
} from "@/lib/iteration";

// C / P0：迭代与任务池排序的 Action（定稿 §9.3）。

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

const createIterationSchema = z.object({
  requestId,
  name: iterationName,
  goal,
  startDate: z.iso.date("开始日期格式不正确"),
  endDate: z.iso.date("结束日期格式不正确"),
});

const updateIterationSchema = z.object({
  requestId,
  expectedRevision: revision,
  name: iterationName.optional(),
  goal,
  startDate: z.iso.date("开始日期格式不正确").optional(),
  endDate: z.iso.date("结束日期格式不正确").optional(),
});

const revisionSchema = z.object({ requestId, expectedRevision: revision });

/** 入轮/移出：每个任务都要带自己的版本，服务层逐个锁行比对。 */
const assignTasksSchema = z.object({
  requestId,
  expectedRevision: revision,
  tasks: z
    .array(z.object({ taskId: z.uuid("任务 id 不合法"), expectedUpdatedAt: instant }))
    .min(1, "至少要选一个任务"),
});

const reorderSchema = z.object({
  requestId,
  taskId: z.uuid("任务 id 不合法"),
  beforeTaskId: z.uuid("锚点任务 id 不合法").nullable(),
  expectedUpdatedAt: instant,
});

function invalid(error: z.ZodError): Result<never> {
  return { ok: false, code: "VALIDATION", error: error.issues[0].message };
}

function refresh(projectId: string, extra?: string) {
  try {
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/iterations`);
    if (extra) revalidatePath(extra);
  } catch {
    console.error("[iterations] cache refresh failed");
  }
}

/* --- 读 --- */

export async function listProjectIterationsAction(
  projectId: string,
): Promise<Result<PageResult<Iteration>>> {
  if (!z.uuid().safeParse(projectId).success) {
    return { ok: false, code: "VALIDATION", error: "项目 id 不合法" };
  }
  return runAction((actorId) => listProjectIterations(actorId, projectId));
}

export async function getCurrentIterationAction(
  projectId: string,
): Promise<Result<CurrentIteration | null>> {
  if (!z.uuid().safeParse(projectId).success) {
    return { ok: false, code: "VALIDATION", error: "项目 id 不合法" };
  }
  return runAction((actorId) => getCurrentIteration(actorId, projectId));
}

export async function getIterationDetailAction(
  projectId: string,
  iterationId: string,
): Promise<Result<IterationDetail>> {
  const parsed = z
    .object({ projectId: z.uuid(), iterationId: z.uuid() })
    .safeParse({ projectId, iterationId });
  if (!parsed.success) return invalid(parsed.error);
  return runAction((actorId) =>
    getIterationDetail(actorId, parsed.data.projectId, parsed.data.iterationId),
  );
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

export async function assignTasksToIterationAction(
  projectId: string,
  iterationId: string,
  input: AssignTasksInput,
): Promise<Result<AssignTasksResult>> {
  const parsed = assignTasksSchema
    .extend({ projectId: z.uuid("项目 id 不合法"), iterationId: z.uuid("迭代 id 不合法") })
    .safeParse({ ...input, projectId, iterationId });
  if (!parsed.success) return invalid(parsed.error);

  const { projectId: pid, iterationId: iid, ...rest } = parsed.data;
  const result = await runAction((actorId) => assignTasks(actorId, pid, iid, rest));
  if (result.ok) refresh(pid);
  return result;
}

export async function removeTasksFromIterationAction(
  projectId: string,
  iterationId: string,
  input: AssignTasksInput,
): Promise<Result<AssignTasksResult>> {
  const parsed = assignTasksSchema
    .extend({ projectId: z.uuid("项目 id 不合法"), iterationId: z.uuid("迭代 id 不合法") })
    .safeParse({ ...input, projectId, iterationId });
  if (!parsed.success) return invalid(parsed.error);

  const { projectId: pid, iterationId: iid, ...rest } = parsed.data;
  const result = await runAction((actorId) => removeTasks(actorId, pid, iid, rest));
  if (result.ok) refresh(pid);
  return result;
}

export async function reorderBacklogAction(
  projectId: string,
  input: ReorderBacklogInput,
): Promise<Result<ReorderBacklogResult>> {
  const parsed = reorderSchema
    .extend({ projectId: z.uuid("项目 id 不合法") })
    .safeParse({ ...input, projectId });
  if (!parsed.success) return invalid(parsed.error);

  const { projectId: pid, ...rest } = parsed.data;
  const result = await runAction((actorId) => reorderBacklog(actorId, pid, rest));
  if (result.ok) refresh(pid);
  return result;
}
