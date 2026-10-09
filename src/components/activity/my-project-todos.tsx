import Link from "next/link";
import type { MyTask } from "@/lib/dashboard";

// E / P0：本项目的「我的待办」。
//
// 数据来自工作台已有的 getMyOpenTasks（跨项目取「指派给当前用户且未完成」的任务），
// 页面按 projectId 过滤后传进来；不新建服务、不新建 Action。
// 逾期与否依赖调用方传入的 today（Asia/Shanghai），组件自己不读系统时钟。

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

export function MyProjectTodos({
  items,
  today,
  title = "我的待办",
}: {
  items: MyTask[];
  /** Asia/Shanghai 的 YYYY-MM-DD。 */
  today: string;
  title?: string;
}) {
  return (
    <section className="ac-card p-5">
      <h2 className="text-sm text-ink-soft">{title}</h2>

      {items.length === 0 ? (
        <p className="mt-2 text-sm text-ink-faint">本项目没有指派给你的未完成任务。</p>
      ) : (
        <ul className="mt-3 divide-y divide-sunken">
          {items.map((task) => {
            const overdue = task.dueDate !== null && task.dueDate < today;
            return (
              <li
                key={task.id}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5"
              >
                <Link
                  href={`/projects/${task.projectId}?task=${task.id}`}
                  className="min-w-0 flex-1 [overflow-wrap:anywhere] text-sm font-medium text-ink hover:text-primary hover:underline"
                >
                  {task.title}
                </Link>
                <span className="flex shrink-0 items-center gap-2 text-xs text-ink-faint">
                  <span className={overdue ? "text-high" : undefined}>
                    {task.dueDate
                      ? overdue
                        ? `已逾期 ${task.dueDate}`
                        : task.dueDate
                      : "未设置截止日期"}
                  </span>
                  <span
                    className={`ac-badge ${STATUS_BADGE[task.status] ?? "bg-sunken text-ink-soft"}`}
                  >
                    {STATUS_LABEL[task.status] ?? task.status}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
