"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import {
  TASK_PRIORITY_VALUES,
  TASK_STATUS_VALUES,
  type CreateTaskV1Input,
  type DeleteTaskV1Input,
  type DeleteTaskV1Result,
  type AssignTasksInput,
  type AssignTasksResult,
  type ProjectTaskStats,
  type PageResult,
  type ReorderBacklogInput,
  type ReorderBacklogResult,
  type Result,
  type SetTaskBlockedInput,
  type SetTaskBlockedResult,
  type TaskAttentionFilters,
  type TaskAttentionItem,
  type TaskPanelData,
  type TaskV1Result,
  type UpdateTaskV1Input,
} from "@/contracts/p0-p2";
import { runAction } from "@/lib/action-result";
import { getProjectForUser, listProjectMilestones } from "@/lib/project";
import { listTeamMembers } from "@/lib/team";
import { listProjectTasks } from "@/lib/task";
import { listTaskFeedback } from "@/lib/deliverable";
import { listTeamLabels } from "@/lib/label";
import { NotFoundError } from "@/lib/errors";
import type {
  TaskFeedbackItem,
  TaskPanelContext,
} from "@/components/tasks/task-detail-panel";
import { assignTasks, removeTasks, reorderBacklog } from "@/lib/iteration";
import {
  createTaskV1,
  deleteTaskV1,
  getProjectTaskStats,
  getTaskPanelData,
  listProjectTaskAttention,
  setTaskBlocked,
  updateTaskV1,
} from "@/lib/task-contract";

// C / P0：任务 V1 对象式 Action、任务池排序、入轮/移出（定稿 §3.4 / §9.2 的 C-T03/04/05）。
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

/** 迭代版本号：从 1 起，每次变更 +1（定稿 §9.1 的 expectedRevision）。 */
const revision = z.number().int("版本号必须是整数").positive("版本号不合法");

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

/* --- P1：阻塞 --- */

const blockSchema = z.object({
  requestId,
  expectedUpdatedAt: instant,
  isBlocked: z.boolean(),
  // isBlocked 为 true 时服务层还会再查一次非空，这里只兜住长度与类型。
  blockedReason: z.string().max(2000, "阻塞原因最多 2000 字").nullish(),
});

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

/**
 * 侧边栏的**自取数**入口（定稿 9.2 侧边栏契约）。
 *
 * 面板只拿到 projectId + taskId 就能完整渲染，所以这里除 TaskPanelData 之外还要给
 * 表单用的选项（负责人/里程碑/父任务/标签）与 D 的来源反馈。每一项都按当前 actor
 * 重新鉴权——面板挂载与 taskId 切换各调一次，不缓存、不信任调用方传来的任何内容。
 */
export async function getTaskPanelContextAction(
  projectId: string,
  taskId: string,
): Promise<Result<TaskPanelContext>> {
  const parsed = z
    .object({ projectId: z.uuid(), taskId: z.uuid() })
    .safeParse({ projectId, taskId });
  if (!parsed.success) {
    return { ok: false, code: "VALIDATION", error: parsed.error.issues[0].message };
  }
  const { projectId: pid, taskId: tid } = parsed.data;

  return runAction(async (actorId) => {
    const access = await getProjectForUser(actorId, pid);
    if (!access) throw new NotFoundError("项目不存在或无权访问");
    const { project, role } = access;

    // 详情本身必须先成功：它挂了就没什么可渲染的，选项取不到倒无所谓。
    const panel = await getTaskPanelData(actorId, pid, tid);
    const [teamMembers, milestones, projectTasks, teamLabels] = await Promise.all([
      listTeamMembers(project.teamId),
      listProjectMilestones(actorId, pid),
      listProjectTasks(actorId, pid),
      listTeamLabels(actorId, project.teamId),
    ]);
    // 反馈是加分项，取不到不该把整个面板变成错误页。
    const feedback = await listTaskFeedback(actorId, pid, tid)
      .then((rows) =>
        rows.map((r) => ({
          id: r.id,
          decision: r.decision,
          comment: r.comment,
          milestoneTitle: r.milestoneTitle,
          createdAt: r.createdAt.toISOString(),
        })),
      )
      .catch(() => [] as TaskFeedbackItem[]);

    return {
      panel,
      canWrite: role === "admin" || role === "student",
      members: teamMembers.map((m) => ({ id: m.id, name: m.name })),
      milestones: milestones.map((m) => ({ id: m.id, name: m.title })),
      allTasks: projectTasks.map((t) => ({ id: t.id, title: t.title })),
      allLabels: teamLabels.map((l) => ({ id: l.id, name: l.name })),
      feedback,
    };
  });
}

/* --- P1：阻塞 / 解除阻塞 --- */

export async function setTaskBlockedAction(
  projectId: string,
  taskId: string,
  input: SetTaskBlockedInput,
): Promise<Result<SetTaskBlockedResult>> {
  const parsed = blockSchema
    .extend({ projectId: z.uuid("项目 id 不合法"), taskId: z.uuid("任务 id 不合法") })
    .safeParse({ ...input, projectId, taskId });
  if (!parsed.success) return invalid(parsed.error);

  const { projectId: pid, taskId: tid, ...rest } = parsed.data;
  const result = await runAction((actorId) => setTaskBlocked(actorId, pid, tid, rest));
  if (result.ok) refresh(pid);
  return result;
}

/* --- P2：项目级统计与需关注清单（C-T08 / C-T09） --- */

const attentionFiltersSchema = z.object({
  kind: z.enum(["overdue", "blocked"], "请选择要看的风险类型"),
  offset: z.number().int("页码格式不正确").nonnegative("页码格式不正确").optional(),
  limit: z.number().int("每页条数格式不正确").positive("每页条数格式不正确").max(100, "每页最多 100 条").optional(),
});

/** 「逾期」按北京时间今天算，服务端取当下，不由浏览器传日期。 */
export async function getProjectTaskStatsAction(
  projectId: string,
): Promise<Result<ProjectTaskStats>> {
  const parsed = z.object({ projectId: z.uuid("项目 id 不合法") }).safeParse({ projectId });
  if (!parsed.success) return invalid(parsed.error);
  return runAction((actorId) => getProjectTaskStats(actorId, parsed.data.projectId));
}

export async function listProjectTaskAttentionAction(
  projectId: string,
  filters: TaskAttentionFilters,
): Promise<Result<PageResult<TaskAttentionItem>>> {
  const parsed = attentionFiltersSchema
    .extend({ projectId: z.uuid("项目 id 不合法") })
    .safeParse({ ...filters, projectId });
  if (!parsed.success) return invalid(parsed.error);

  const { projectId: pid, ...rest } = parsed.data;
  return runAction((actorId) => listProjectTaskAttention(actorId, pid, rest));
}

/* --- C-T03/04/05：任务池排序与入轮 / 移出（定稿 §9.2） ---
 *
 * 这三个动作虽然围绕迭代，但定稿把它们归在任务侧：任务池是任务的视图，
 * 入轮/移出改的是任务的归属，消费方（E 草案确认、C 任务池 UI）都从任务入口 import。
 */

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
