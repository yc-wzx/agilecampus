// A 模块的工作台聚合入口。
//
// 四项数据源各自收敛成一个 QueryPart：某项上游服务故障只让那一块显示不可用，
// 不用空数组或 0 冒充失败。核心身份由调用方（服务端页面）用 auth() 取得后传入。
import {
  PAGE_LIMIT_DEFAULT,
  type MyActiveIteration,
  type PageResult,
  type QueryPart,
} from "@/contracts/p0-p2";
import { getMyOpenTasks, groupMyTasks, todayInShanghai, type TaskGroup } from "@/lib/dashboard";
import { listMyRevisionRequiredDeliverables } from "@/lib/deliverable-reporting";
import { listMyActiveIterations } from "@/lib/iteration";
import { getUnreadNotificationCount } from "@/lib/notifications";

// 直接复用上游服务的返回类型，不另建同义类型
export type RevisionRequiredItem = Awaited<
  ReturnType<typeof listMyRevisionRequiredDeliverables>
>["items"][number];

export type UnreadSummary = { count: number; asOf: string };

export type MyWorkspaceSummary = {
  tasks: QueryPart<TaskGroup[]>;
  activeIterations: QueryPart<PageResult<MyActiveIteration>>;
  revisionRequired: QueryPart<PageResult<RevisionRequiredItem>>;
  unread: QueryPart<UnreadSummary>;
  asOf: string;
};

export type WorkspaceSummaryOptions = {
  // 待修改成果分页游标，省略时为第一页
  revisionsOffset?: number;
};

async function part<T>(label: string, run: () => Promise<T>): Promise<QueryPart<T>> {
  try {
    return { state: "ready", data: await run() };
  } catch (e) {
    console.error(`[workspace-summary] ${label}查询失败`, e instanceof Error ? e.name : "UnknownError");
    return { state: "unavailable", code: "INTERNAL", message: `${label}加载失败` };
  }
}

export async function getMyWorkspaceSummary(
  actorId: string,
  options: WorkspaceSummaryOptions = {},
): Promise<MyWorkspaceSummary> {
  const asOf = new Date().toISOString();
  const today = todayInShanghai();
  const offset = Number.isSafeInteger(options.revisionsOffset) && (options.revisionsOffset ?? 0) >= 0
    ? options.revisionsOffset!
    : 0;

  const [tasks, activeIterations, revisionRequired, unread] = await Promise.all([
    part("任务", async () => groupMyTasks(await getMyOpenTasks(actorId), today)),
    part("当前迭代", () => listMyActiveIterations(actorId)),
    part("待修改成果", () =>
      listMyRevisionRequiredDeliverables(actorId, { offset, limit: PAGE_LIMIT_DEFAULT }),
    ),
    part("未读通知", () => getUnreadNotificationCount(actorId)),
  ]);

  return { tasks, activeIterations, revisionRequired, unread, asOf };
}
