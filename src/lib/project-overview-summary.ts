/**
 * B-G01：项目概览聚合（服务端查询，不另建 Action）
 *
 * 固定服务入口见《P0—P2 统一接口标准（定稿）》第 9.1 节：
 *   导入路径 `@/lib/project-overview-summary`，函数 `getProjectOverviewSummary(actorId, projectId)`。
 * 调用方只传可信登录用户 ID（页面上由 `auth()` 取得），不接受浏览器传来的身份。
 *
 * 设计要点：
 * 1. 项目访问失败（非本项目团队成员）整体拒绝，不泄露项目是否存在。
 * 2. 允许只读的独立数据源各自用 QueryPart 表达 ready / unavailable：
 *    单个统计服务故障时页面显示“局部不可用”，不能变成 0、null 或整页 500。
 * 3. E/F 尚未交付的服务在这里显式标注“待接入”，不伪造数据。
 *    交付后把对应 `pending(...)` 换成 `queryPart(...)` 调用即可，页面无需改动。
 */
import { listProjectActivities } from "@/lib/activity";
import { getPinnedAnnouncement } from "@/lib/announcements";
import { getProjectDeliverableStats } from "@/lib/deliverable-reporting";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { getCurrentIteration } from "@/lib/iteration";
import { getProjectDetail, getProjectForUser } from "@/lib/project";
import { getProjectTaskStats } from "@/lib/task-contract";
import type {
  ActivityPage,
  AnnouncementItem,
  CurrentIteration,
  ProjectDeliverableStats,
  ProjectTaskStats,
  QueryPart,
} from "@/contracts/p0-p2";

type ProjectDetail = Awaited<ReturnType<typeof getProjectDetail>>;

/** 项目与里程碑直接沿用现有服务行类型，避免在公共类型里复制数据库形状。 */
export type OverviewProject = ProjectDetail["project"];
export type OverviewMilestone = ProjectDetail["milestones"][number];
export type OverviewRole = ProjectDetail["role"];

export type ProjectOverviewSummary = {
  project: OverviewProject;
  role: OverviewRole;
  milestones: OverviewMilestone[];
  /** C-T08，主任务口径（不含子任务） */
  taskStats: QueryPart<ProjectTaskStats>;
  /** C-I12，只取 active；没有活跃轮时 data 为 null */
  activeIteration: QueryPart<CurrentIteration | null>;
  /** D 项目成果统计，只计当前正式提交的成果 */
  deliverableStats: QueryPart<ProjectDeliverableStats>;
  /** F-A02，待接入 */
  pinnedAnnouncement: QueryPart<AnnouncementItem | null>;
  /** E-A02 最近活动。E 已交付；覆盖说明一并带出，不用空数组冒充「没有发生过」 */
  recentActivities: QueryPart<ActivityPage>;
  asOf: string;
};

/** 未交付依赖的占位：明确写“待接入”，不用 0 或空数组冒充真实结果。 */
/**
 * 单项查询包装：权限/认证类错误向上抛（整体拒绝），其余服务故障降级为局部不可用。
 * 不把数据库错误文本透传到浏览器。
 */
async function queryPart<T>(
  label: string,
  run: () => Promise<T>,
): Promise<QueryPart<T>> {
  try {
    return { state: "ready", data: await run() };
  } catch (error) {
    // 访问类错误不能降级成“暂时不可用”，否则会掩盖越权或项目不存在
    if (error instanceof ForbiddenError || error instanceof NotFoundError)
      throw error;
    console.error(
      `[project-overview] ${label}查询失败`,
      error instanceof Error ? error.name : "UnknownError",
    );
    return {
      state: "unavailable",
      code: "INTERNAL",
      message: `${label}暂时不可用，页面其余部分不受影响；请稍后重试。`,
    };
  }
}

export async function getProjectOverviewSummary(
  actorId: string,
  projectId: string,
): Promise<ProjectOverviewSummary> {
  // 核心认证 + 项目访问：一次校验，失败即整体拒绝。
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();

  // 项目本体与里程碑；这里失败属于基础数据不可用，向上抛出。
  const detail = await getProjectDetail(actorId, projectId);

  const [
    taskStats,
    activeIteration,
    deliverableStats,
    pinnedAnnouncement,
    recentActivities,
  ] = await Promise.all([
    // C 已交付：主任务口径任务统计（C-T08）
    queryPart("任务统计", () => getProjectTaskStats(actorId, projectId)),
    // C 已交付：当前活跃迭代（C-I12）；没有活跃轮返回 null
    queryPart("当前迭代", () => getCurrentIteration(actorId, projectId)),
    // D 已交付：真实项目成果统计
    queryPart("成果统计", () => getProjectDeliverableStats(actorId, projectId)),
    // F 待接入：项目置顶公告（F-A02 getPinnedAnnouncement）
    queryPart("项目公告", () => getPinnedAnnouncement(actorId, projectId)),
    // E 已交付：最近活动（E-A02 listProjectActivities）。空结果是空列表，不是降级。
    queryPart("项目动态", () =>
      listProjectActivities(actorId, projectId, { limit: 10 }),
    ),
  ]);

  return {
    project: detail.project,
    role: detail.role,
    milestones: detail.milestones,
    taskStats,
    activeIteration,
    deliverableStats,
    pinnedAnnouncement,
    recentActivities,
    asOf: new Date().toISOString(),
  };
}
