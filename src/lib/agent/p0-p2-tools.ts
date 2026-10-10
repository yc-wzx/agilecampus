import { tool } from "ai";
import { z } from "zod";
import { getIterationDetail, getIterationRetrospective } from "@/lib/iteration";
import { listProjectEvidence } from "@/lib/evidence";
import { getProjectTaskStats } from "@/lib/task-contract";
import { getProjectDeliverableStats } from "@/lib/deliverable-reporting";
import type { PageInput } from "@/contracts/p0-p2";

function bounded<T>(data: T) {
  const serialized = JSON.stringify(data);
  return serialized.length <= 10000
    ? data
    : {
        truncated: true,
        excerpt: serialized.slice(0, 9900),
        note: "工具内容已截断；缩小筛选范围或翻页。",
      };
}
export async function readIteration(
  actorId: string,
  projectId: string,
  iterationId: string,
) {
  return bounded(await getIterationDetail(actorId, projectId, iterationId));
}
export async function readDeliverables(
  actorId: string,
  projectId: string,
  paging: PageInput = {},
) {
  return bounded(
    await listProjectEvidence(actorId, projectId, {
      ...paging,
      kinds: ["deliverable_submission"],
    }),
  );
}
export async function readFeedback(
  actorId: string,
  projectId: string,
  paging: PageInput = {},
) {
  return bounded(
    await listProjectEvidence(actorId, projectId, {
      ...paging,
      kinds: ["deliverable_review", "milestone_feedback"],
    }),
  );
}
export async function readRetrospective(
  actorId: string,
  projectId: string,
  iterationId: string,
) {
  return bounded(
    await getIterationRetrospective(actorId, projectId, iterationId),
  );
}
export async function readProjectStats(actorId: string, projectId: string) {
  const [tasks, deliverables] = await Promise.all([
    getProjectTaskStats(actorId, projectId),
    getProjectDeliverableStats(actorId, projectId),
  ]);
  return { tasks, deliverables };
}
export function buildP0P2ReadTools(actorId: string, projectId: string) {
  const paging = z.object({
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(30).default(10),
    }),
    iteration = z.object({ iterationId: z.uuid() });
  return {
    read_iteration: tool({
      description: "读取本项目迭代详情，不改业务数据",
      inputSchema: iteration,
      execute: ({ iterationId }) =>
        readIteration(actorId, projectId, iterationId),
    }),
    read_deliverables: tool({
      description: "读取正式成果快照；不含任何人的私有草稿",
      inputSchema: paging,
      execute: (input) => readDeliverables(actorId, projectId, input),
    }),
    read_feedback: tool({
      description: "读取真实成果审核及阶段反馈，有界分页",
      inputSchema: paging,
      execute: (input) => readFeedback(actorId, projectId, input),
    }),
    read_retrospective: tool({
      description: "读取本项目迭代复盘",
      inputSchema: iteration,
      execute: ({ iterationId }) =>
        readRetrospective(actorId, projectId, iterationId),
    }),
    read_project_stats: tool({
      description: "读取任务和正式成果统计，零值不等于查询失败",
      inputSchema: z.object({}),
      execute: () => readProjectStats(actorId, projectId),
    }),
  };
}
