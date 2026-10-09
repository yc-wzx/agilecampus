import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import type { MyActiveIteration, QueryPart } from "@/contracts/p0-p2";
import { todayInShanghai, type MyTask, type TaskGroupKey } from "@/lib/dashboard";
import {
  getMyWorkspaceSummary,
  type RevisionRequiredItem,
} from "@/lib/workspace-summary";

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

// 上游返回的是 UTC 时间串，展示统一用北京时间
function beijingDate(iso: string): string {
  return new Date(new Date(iso).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function SectionHeading({
  title,
  count,
  accent = "text-ink",
  note,
}: {
  title: string;
  count: number | null;
  accent?: string;
  note?: string;
}) {
  return (
    <>
      <h2 className="flex items-center gap-2 text-sm font-medium">
        <span className={accent}>{title}</span>
        {count !== null && <span className="ac-badge bg-sunken text-ink-soft">{count}</span>}
      </h2>
      {note && <p className="px-1 text-xs text-ink-faint">{note}</p>}
    </>
  );
}

// 单项服务不可用时说明原因，不以空内容冒充成功
function UnavailableNote({ message }: { message: string }) {
  return <div className="ac-card p-4 text-center text-sm text-high">{message}</div>;
}

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

function IterationRow({ item }: { item: MyActiveIteration }) {
  return (
    <li className="ac-card p-3">
      <Link
        href={`/projects/${item.projectId}/iterations/${item.id}`}
        className="[overflow-wrap:anywhere] font-medium text-ink hover:text-primary hover:underline"
      >
        {item.name}
      </Link>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
        <span className="min-w-0 [overflow-wrap:anywhere]">{item.projectName}</span>
        <span>{item.startDate} ~ {item.endDate}</span>
        <span className="tabular-nums">主任务 {item.doneCount}/{item.taskTotal}</span>
      </div>
      {item.goal && (
        <p className="mt-1.5 [overflow-wrap:anywhere] text-xs text-ink-soft">目标：{item.goal}</p>
      )}
    </li>
  );
}

function RevisionRow({ item }: { item: RevisionRequiredItem }) {
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
        <span>{beijingDate(item.reviewedAt)}</span>
      </div>
      {item.comment && (
        <p className="mt-1.5 [overflow-wrap:anywhere] rounded bg-high-soft px-2 py-1 text-xs text-ink-soft">
          教师意见：{item.comment}
        </p>
      )}
    </li>
  );
}

function parseOffset(raw: string | undefined): number {
  if (!raw || !/^\d+$/.test(raw)) return 0;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}

function ready<T>(p: QueryPart<T>): T | null {
  return p.state === "ready" ? p.data : null;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ revisionsOffset?: string }>;
}) {
  const params = await searchParams;
  const offset = parseOffset(params.revisionsOffset);
  const session = await auth();
  if (!session?.user) redirect("/login");

  const summary = await getMyWorkspaceSummary(session.user.id, { revisionsOffset: offset });
  const today = todayInShanghai();

  const taskGroups = ready(summary.tasks);
  const taskCount = taskGroups ? taskGroups.reduce((n, g) => n + g.tasks.length, 0) : null;
  const iterations = ready(summary.activeIterations);
  const revisionPage = ready(summary.revisionRequired);

  return (
    <main className="mx-auto max-w-3xl space-y-6 py-8">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-semibold text-ink">工作台</h1>
        <p className="[overflow-wrap:anywhere] text-sm text-ink-soft">
          你好，{session.user.name} · 今天 {today}
          {taskCount !== null && ` · 待处理 ${taskCount} 项`}
        </p>
      </header>

      <section className="space-y-2">
        <SectionHeading
          title="我的任务"
          count={taskCount}
          note="只显示活跃项目中指派给你的未完成任务，包含子任务。"
        />
        {summary.tasks.state === "unavailable" ? (
          <UnavailableNote message={summary.tasks.message} />
        ) : taskCount === 0 ? (
          <div className="ac-card p-8 text-center text-sm text-ink-soft">
            暂无待处理任务。如果还没有加入团队，先到{" "}
            <Link href="/teams" className="text-primary hover:underline">
              团队
            </Link>{" "}
            创建或加入。
          </div>
        ) : (
          <div className="space-y-6">
            {taskGroups!.map((g) => (
              <div key={g.key} className="space-y-2">
                <h3 className="flex items-center gap-2 text-sm font-medium">
                  <span className={GROUP_ACCENT[g.key]}>{g.label}</span>
                  <span className="ac-badge bg-sunken text-ink-soft">{g.tasks.length}</span>
                </h3>
                {g.tasks.length === 0 ? (
                  <p className="px-1 text-sm text-ink-faint">暂无</p>
                ) : (
                  <ul className="space-y-2">
                    {g.tasks.map((t) => (
                      <TaskRow key={t.id} task={t} />
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <SectionHeading
          title="当前迭代"
          count={iterations ? iterations.total : null}
          accent="text-primary"
        />
        {summary.activeIterations.state === "unavailable" ? (
          <UnavailableNote message={summary.activeIterations.message} />
        ) : !iterations || iterations.items.length === 0 ? (
          <p className="px-1 text-sm text-ink-faint">暂无进行中的迭代</p>
        ) : (
          <ul className="space-y-2">
            {iterations.items.map((it) => (
              <IterationRow key={it.id} item={it} />
            ))}
          </ul>
        )}
      </section>

      <section id="revisions" className="space-y-2">
        <SectionHeading
          title="需要处理的成果"
          count={revisionPage ? revisionPage.total : null}
          accent="text-accent"
          note="你提交过、教师要求修改的成果。通知标记已读不会让它们消失，重交后才会移出。"
        />
        {summary.revisionRequired.state === "unavailable" ? (
          <UnavailableNote message={summary.revisionRequired.message} />
        ) : !revisionPage || revisionPage.items.length === 0 ? (
          <p className="px-1 text-sm text-ink-faint">暂无</p>
        ) : (
          <ul className="space-y-2">
            {revisionPage.items.map((d) => (
              <RevisionRow key={d.id} item={d} />
            ))}
          </ul>
        )}
        {revisionPage && (offset > 0 || revisionPage.nextOffset !== null) && (
          <nav aria-label="待修改成果分页" className="flex flex-wrap gap-3 text-sm">
            {offset > 0 && (
              <Link
                className="text-primary underline"
                href={`/dashboard?revisionsOffset=${Math.max(0, offset - 50)}#revisions`}
              >
                上一页
              </Link>
            )}
            {revisionPage.nextOffset !== null && (
              <Link
                className="text-primary underline"
                href={`/dashboard?revisionsOffset=${revisionPage.nextOffset}#revisions`}
              >
                下一页
              </Link>
            )}
            <span>共 {revisionPage.total} 项</span>
          </nav>
        )}
      </section>
    </main>
  );
}
