"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import {
  TASK_PRIORITY_VALUES,
  TASK_STATUS_VALUES,
  type CreateTaskV1Input,
  type DeleteTaskV1Input,
  type DeleteTaskV1Result,
  type Result,
  type TaskPanelData,
  type TaskV1Result,
  type UpdateTaskV1Input,
} from "@/contracts/p0-p2";
import { runAction } from "@/lib/action-result";
import {
  createTaskV1,
  deleteTaskV1,
  getTaskPanelData,
  updateTaskV1,
} from "@/lib/task-contract";

// C / P0：任务 V1 对象式 Action（定稿 §3.4 / §9.2）。
//
// 与同目录下旧的 FormData 版 actions.ts 并存：旧入口继续服务看板表单与 Agent API，
// 这里只给新页面/侧边栏用。校验放在 Action 这一层，服务层只管领域规则。

const requestId = z.uuid("请求标识不合法");
const optionalUuid = z.uuid("id 格式不正确").nullish();
const optionalDate = z.iso.date("日期格式不正确").nullish();
const optionalText = (max: number, label: string) =>
  z.string().max(max, `${label}最多 ${max} 字`).nullish();

/** 前端回传的是服务端吐出的 ISO 串，原样比对即可；这里只保证它是个能解析的时间。 */
const instant = z
  .string()
  .refine((s) => !Number.isNaN(new Date(s).getTime()), "时间格式不正确");

const createTaskSchema = z.object({
  requestId,
  title: z.string().trim().min(1, "请填写任务标题").max(200, "任务标题最多 200 字"),
  description: optionalText(10000, "描述"),
  acceptanceCriteria: optionalText(10000, "验收标准"),
  assigneeId: optionalUuid,
  startDate: optionalDate,
  dueDate: optionalDate,
  milestoneId: optionalUuid,
  priority: z.enum(TASK_PRIORITY_VALUES).optional(),
  parentTaskId: optionalUuid,
});

const patchSchema = z.object({
  title: z.string().trim().min(1, "任务标题不能为空").max(200, "任务标题最多 200 字").optional(),
  description: optionalText(10000, "描述"),
  acceptanceCriteria: optionalText(10000, "验收标准"),
  assigneeId: optionalUuid,
  startDate: optionalDate,
  dueDate: optionalDate,
  milestoneId: optionalUuid,
  status: z.enum(TASK_STATUS_VALUES).optional(),
  priority: z.enum(TASK_PRIORITY_VALUES).optional(),
  completionNote: optionalText(10000, "完成说明"),
});

const updateTaskSchema = z.object({
  requestId,
  expectedUpdatedAt: instant,
  patch: patchSchema,
});

const deleteTaskSchema = z.object({ requestId, expectedUpdatedAt: instant });

function refresh(projectId: string) {
  // 提交后的缓存刷新失败不该被当成写失败上报。
  try {
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/iterations`);
  } catch {
    console.error("[tasks] cache refresh failed");
  }
}

/** 把 safeParse 的失败翻成 Result 的失败分支。 */
function invalid(error: z.ZodError): Result<never> {
  return { ok: false, code: "VALIDATION", error: error.issues[0].message };
}

export async function createTaskV1Action(
  projectId: string,
  input: CreateTaskV1Input,
): Promise<Result<TaskV1Result>> {
  const parsed = createTaskSchema
    .extend({ projectId: z.uuid("项目 id 不合法") })
    .safeParse({ ...input, projectId });
  if (!parsed.success) return invalid(parsed.error);

  const { projectId: pid, ...rest } = parsed.data;
  const result = await runAction((actorId) => createTaskV1(actorId, pid, rest));
  if (result.ok) refresh(pid);
  return result;
}

export async function updateTaskV1Action(
  projectId: string,
  taskId: string,
  input: UpdateTaskV1Input,
): Promise<Result<TaskV1Result>> {
  const parsed = updateTaskSchema
    .extend({ projectId: z.uuid("项目 id 不合法"), taskId: z.uuid("任务 id 不合法") })
    .safeParse({ ...input, projectId, taskId });
  if (!parsed.success) return invalid(parsed.error);

  const { projectId: pid, taskId: tid, ...rest } = parsed.data;
  const result = await runAction((actorId) => updateTaskV1(actorId, pid, tid, rest));
  if (result.ok) refresh(pid);
  return result;
}

export async function deleteTaskV1Action(
  projectId: string,
  taskId: string,
  input: DeleteTaskV1Input,
): Promise<Result<DeleteTaskV1Result>> {
  const parsed = deleteTaskSchema
    .extend({ projectId: z.uuid("项目 id 不合法"), taskId: z.uuid("任务 id 不合法") })
    .safeParse({ ...input, projectId, taskId });
  if (!parsed.success) return invalid(parsed.error);

  const { projectId: pid, taskId: tid, ...rest } = parsed.data;
  const result = await runAction((actorId) => deleteTaskV1(actorId, pid, tid, rest));
  if (result.ok) refresh(pid);
  return result;
}

/** 侧边栏取数入口。面板是客户端组件，不能直接调服务端的 getTaskPanelData。 */
export async function getTaskPanelDataAction(
  projectId: string,
  taskId: string,
): Promise<Result<TaskPanelData>> {
  const parsed = z
    .object({ projectId: z.uuid(), taskId: z.uuid() })
    .safeParse({ projectId, taskId });
  if (!parsed.success) {
    return { ok: false, code: "VALIDATION", error: parsed.error.issues[0].message };
  }
  return runAction((actorId) =>
    getTaskPanelData(actorId, parsed.data.projectId, parsed.data.taskId),
  );
}
