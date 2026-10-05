import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  getMyOpenTasks,
  groupMyTasks,
  todayInShanghai,
  type MyTask,
  type TaskGroupKey,
} from "@/lib/dashboard";

const STATUS_LABEL: Record<string, string> = {
  todo: "待办",
  doing: "进行中",
  done: "已完成",
};
const STATUS_BADGE: Record<string, string> = {
  todo: "bg-sunken text-ink-soft",
  doing: "bg-primary-soft text-primary",
  done: "bg-done/12 text-done",
};
const PRIORITY_LABEL: Record<string, string> = { high: "高", medium: "中", low: "低" };
const PRIORITY_BADGE: Record<string, string> = {
  high: "bg-high-soft text-high",
  medium: "bg-medium-soft text-medium",
  low: "bg-low-soft text-low",
};
const GROUP_ACCENT: Record<TaskGroupKey, string> = {
  overdue: "text-high",
  today: "text-accent",
  next7: "text-primary",
  rest: "text-ink-faint",
};

function TaskRow({ task }: { task: MyTask }) {
  return (
    <li className="ac-card p-3">
      <Link
        href={`/projects/${task.projectId}?task=${task.id}`}
        className="break-words font-medium text-ink hover:text-primary hover:underline"
      >
        {task.title}
      </Link>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
        <span className="min-w-0 break-words">{task.teamName} · {task.projectName}</span>
        <span>{task.dueDate ?? "未设置截止日期"}</span>
        <span className={`ac-badge ${STATUS_BADGE[task.status] ?? "bg-sunken text-ink-soft"}`}>
          {STATUS_LABEL[task.status] ?? task.status}
        </span>
        <span className={`ac-badge ${PRIORITY_BADGE[task.priority] ?? "bg-low-soft text-low"}`}>
          {PRIORITY_LABEL[task.priority] ?? task.priority}
        </span>
      </div>
    </li>
  );
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // 查询失败必须与「没有任务」区分开，不能把失败显示成空列表
  let tasks: MyTask[];
  try {
    tasks = await getMyOpenTasks(session.user.id);
  } catch (e) {
    console.error("[dashboard] 任务查询失败", e);
    return (
      <main className="mx-auto max-w-3xl space-y-6 py-8">
        <h1 className="font-display text-2xl font-semibold text-ink">我的任务</h1>
        <div className="ac-card p-8 text-center">
          <p className="text-sm text-high">任务加载失败</p>
          <p className="mt-1 text-sm text-ink-faint">请刷新页面重试；若持续失败请联系管理员。</p>
        </div>
      </main>
    );
  }

  const today = todayInShanghai();
  const groups = groupMyTasks(tasks, today);

  return (
    <main className="mx-auto max-w-3xl space-y-6 py-8">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-semibold text-ink">我的任务</h1>
        <p className="break-words text-sm text-ink-soft">
          你好，{session.user.name} · 今天 {today} · 待处理 {tasks.length} 项
        </p>
        <p className="text-xs text-ink-faint">只显示活跃项目中指派给你的未完成任务，包含子任务。</p>
      </header>

      {tasks.length === 0 ? (
        <div className="ac-card p-8 text-center text-sm text-ink-soft">
          暂无待处理任务。如果还没有加入团队，先到{" "}
          <Link href="/teams" className="text-primary hover:underline">
            团队
          </Link>{" "}
          创建或加入。
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.key} className="space-y-2">
              <h2 className="flex items-center gap-2 text-sm font-medium">
                <span className={GROUP_ACCENT[g.key]}>{g.label}</span>
                <span className="ac-badge bg-sunken text-ink-soft">{g.tasks.length}</span>
              </h2>
              {g.tasks.length === 0 ? (
                <p className="px-1 text-sm text-ink-faint">暂无</p>
              ) : (
                <ul className="space-y-2">
                  {g.tasks.map((t) => (
                    <TaskRow key={t.id} task={t} />
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
