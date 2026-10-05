// 工作台任务聚合：跨项目取出「分给当前登录用户的未完成任务」，并按截止日分组。
//
// 分层约定（同 board-filters）：分组是不含 IO、不读系统时钟的纯函数，
// 「今天」由调用方传入，便于单测；数据库查询单独成函数。
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { projects, tasks, teamMembers, teams } from "@/db/schema";

export type MyTask = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null; // YYYY-MM-DD
  projectId: string;
  projectName: string;
  teamName: string;
};

export type TaskGroupKey = "overdue" | "today" | "next7" | "rest";

export type TaskGroup = {
  key: TaskGroupKey;
  label: string;
  tasks: MyTask[];
};

export const TASK_GROUP_LABELS: Record<TaskGroupKey, string> = {
  overdue: "已逾期",
  today: "今天截止",
  next7: "未来 7 天",
  rest: "其余任务",
};

const STATUS_RANK: Record<string, number> = { doing: 0, todo: 1, done: 2 };
const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

// 截止日按 Asia/Shanghai 计算，返回 YYYY-MM-DD。
// 显式指定时区，避免服务器时区与项目约定不一致时把「今天」算错。
export function todayInShanghai(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

// 日期字符串加减天数。用 UTC 构造，避免本地时区造成的跨日漂移。
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

// 有截止日的三组：先按截止日升序（最紧急在前），再按状态、优先级。
function compareDated(a: MyTask, b: MyTask): number {
  if (a.dueDate !== b.dueDate) return (a.dueDate ?? "") < (b.dueDate ?? "") ? -1 : 1;
  const s = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
  if (s !== 0) return s;
  const p = (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
  if (p !== 0) return p;
  return a.title.localeCompare(b.title, "zh");
}

// 其余任务：进行中优先，无截止日的排在最后。
function compareRest(a: MyTask, b: MyTask): number {
  const s = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
  if (s !== 0) return s;
  if (a.dueDate === null && b.dueDate !== null) return 1;
  if (a.dueDate !== null && b.dueDate === null) return -1;
  if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
  const p = (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
  if (p !== 0) return p;
  return a.title.localeCompare(b.title, "zh");
}

// 把任务分入互斥的四组：逾期 / 今天 / 未来 7 天（不含今天）/ 其余。
// 无截止日的任务归入「其余」，界面需标注「未设置截止日期」。
export function groupMyTasks(items: MyTask[], today: string): TaskGroup[] {
  const horizon = addDays(today, 7);
  const groups: TaskGroup[] = [
    { key: "overdue", label: TASK_GROUP_LABELS.overdue, tasks: [] },
    { key: "today", label: TASK_GROUP_LABELS.today, tasks: [] },
    { key: "next7", label: TASK_GROUP_LABELS.next7, tasks: [] },
    { key: "rest", label: TASK_GROUP_LABELS.rest, tasks: [] },
  ];
  const byKey = new Map(groups.map((g) => [g.key, g]));

  for (const t of items) {
    let key: TaskGroupKey;
    if (t.dueDate === null) key = "rest";
    else if (t.dueDate < today) key = "overdue";
    else if (t.dueDate === today) key = "today";
    else if (t.dueDate <= horizon) key = "next7";
    else key = "rest";
    byKey.get(key)!.tasks.push(t);
  }

  for (const g of groups) g.tasks.sort(g.key === "rest" ? compareRest : compareDated);
  return groups;
}

// 取「当前用户可访问的全部项目里，指派给他且未完成」的任务。
// 当前成员资格与任务在同一条 SQL 中检查，避免两次查询间退组后仍返回旧团队任务。
// 工作台仅列活跃项目；已归档任务保留在项目历史中。已指派的子任务也是个人待办。
export async function getMyOpenTasks(actorId: string): Promise<MyTask[]> {
  return db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      projectId: projects.id,
      projectName: projects.name,
      teamName: teams.name,
    })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .innerJoin(teams, eq(projects.teamId, teams.id))
    .innerJoin(teamMembers, and(eq(teamMembers.teamId, projects.teamId), eq(teamMembers.userId, actorId)))
    .where(
      and(
        eq(tasks.assigneeId, actorId),
        ne(tasks.status, "done"),
        eq(projects.status, "active"),
      ),
    );
}
