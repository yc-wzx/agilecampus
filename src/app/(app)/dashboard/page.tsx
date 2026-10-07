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
import { listMyRevisionRequiredDeliverables } from "@/lib/deliverable-reporting";

// 直接复用 D 的成果服务返回类型，不另建同义类型
type RevisionItem = Awaited<
  ReturnType<typeof listMyRevisionRequiredDeliverables>
>["items"][number];

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
        className="[overflow-wrap:anywhere] font-medium text-ink hover:text-primary hover:underline"
      >
        {task.title}
      </Link>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
        <span className="min-w-0 [overflow-wrap:anywhere]">{task.teamName} · {task.projectName}</span>
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

function RevisionRow({ item }: { item: RevisionItem }) {
  return (
    <li className="ac-card p-3">
      <Link
        href={`/projects/${item.projectId}/deliverables/${item.id}?versionId=${item.versionId}&feedbackId=${item.feedbackId}`}
        className="[overflow-wrap:anywhere] font-medium text-ink hover:text-primary hover:underline"
      >
        {item.title}
      </Link>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
        <span className="min-w-0 [overflow-wrap:anywhere]">{item.projectName}</span>
        <span>第 {item.versionNumber} 版</span>
        <span>{new Date(new Date(item.reviewedAt).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10)}</span>
      </div>
      {item.comment && (
        <p className="mt-1.5 [overflow-wrap:anywhere] rounded bg-high-soft px-2 py-1 text-xs text-ink-soft">
          教师意见：{item.comment}
        </p>
      )}
    </li>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ revisionsOffset?: string }> }) {
  const params = await searchParams;
  const rawOffset = params.revisionsOffset ?? "0";
  const parsedOffset = /^\d+$/.test(rawOffset) ? Number(rawOffset) : 0;
  const offset = Number.isSafeInteger(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;
  const session = await auth();
  if (!session?.user) redirect("/login");

  // 查询失败必须与「没有任务」区分开，不能把失败显示成空列表
  let tasks: MyTask[];
  try {
    tasks = await getMyOpenTasks(session.user.id);
  } catch (e) {
    console.error("[dashboard] 任务查询失败", e instanceof Error ? e.name : "UnknownError");
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

  // 成果来自 D 的模块，查询失败只影响本区块，不遮蔽任务列表
  let revisions: RevisionItem[] = [];
  let revisionsFailed = false;
  let revisionTotal = 0;
  let nextOffset: number | null = null;
  try {
    const page = await listMyRevisionRequiredDeliverables(session.user.id, { offset, limit: 50 });
    revisions = page.items;
    revisionTotal = page.total;
    nextOffset = page.nextOffset;
  } catch (e) {
    console.error("[dashboard] 待修改成果查询失败", e instanceof Error ? e.name : "UnknownError");
    revisionsFailed = true;
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 py-8">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-semibold text-ink">我的任务</h1>
        <p className="[overflow-wrap:anywhere] text-sm text-ink-soft">
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

      <section id="revisions" className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <span className="text-accent">需要处理的成果</span>
          {!revisionsFailed && <span className="ac-badge bg-sunken text-ink-soft">{revisionTotal}</span>}
        </h2>
        <p className="px-1 text-xs text-ink-faint">
          你提交过、教师要求修改的成果。通知标记已读不会让它们消失，重交后才会移出。
        </p>
        {revisionsFailed ? (
          <div className="ac-card p-4 text-center text-sm text-high">
            成果加载失败，请刷新页面重试。
          </div>
        ) : revisions.length === 0 ? (
          <p className="px-1 text-sm text-ink-faint">暂无</p>
        ) : (
          <ul className="space-y-2">
            {revisions.map((d) => (
              <RevisionRow key={d.id} item={d} />
            ))}
          </ul>
        )}
        {!revisionsFailed && (offset > 0 || nextOffset !== null) && (
          <nav aria-label="待修改成果分页" className="flex flex-wrap gap-3 text-sm">
            {offset > 0 && <Link className="text-primary underline" href={`/dashboard?revisionsOffset=${Math.max(0, offset - 50)}#revisions`}>上一页</Link>}
            {nextOffset !== null && <Link className="text-primary underline" href={`/dashboard?revisionsOffset=${nextOffset}#revisions`}>下一页</Link>}
            <span>共 {revisionTotal} 项</span>
          </nav>
        )}
      </section>
    </main>
  );
}
