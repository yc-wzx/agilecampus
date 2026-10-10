import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getProjectForUser } from "@/lib/project";
import {
  getPlanningWorkspace,
  getReplanningSeed,
} from "@/lib/schedule/planner";
import { shanghaiDay } from "@/lib/schedule/types";
import { ProjectNav } from "@/components/projects/project-nav";
import {
  PersonalPlanGenerator,
  PersonalPlanControls,
} from "@/components/schedule/plan-forms";

const statusNames: Record<string, string> = {
  draft: "待确认草案",
  confirmed: "已确认个人安排",
  cancelled: "已取消",
  expired: "草案已过期",
};
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { projectId } = await params,
    sp = await searchParams;
  if (!z.uuid().safeParse(projectId).success) notFound();
  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();
  const seed = sp.replan
    ? await getReplanningSeed(session.user.id, projectId, sp.replan)
    : undefined;
  const startDate = shanghaiDay(),
    offset = Math.max(0, Number(sp.offset) || 0),
    workspace = await getPlanningWorkspace(session.user.id, projectId, {
      startDate,
      offset,
    });
  const day = (iso: string) =>
      new Date(Date.parse(iso) + 8 * 3600000).toISOString().slice(0, 10),
    time = (iso: string) =>
      new Date(iso).toLocaleTimeString("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
  return (
    <main className="mx-auto max-w-5xl space-y-5 py-8">
      <header className="space-y-3">
        <h1 className="break-words font-display text-2xl">
          {access.project.name} · 我的短期计划
        </h1>
        <ProjectNav projectId={projectId} current="ai" />
        <p className="text-sm text-ink-soft">
          结合本人课表、可投入时间和真实任务进度，生成未来 7／14
          天工作草案。完整计划仅本人可见；可以在日程设置中选择向团队显示模糊工作时段。
        </p>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href="/schedule" className="text-primary underline">
            管理我的课表与日程
          </Link>
          <Link
            href={`/projects/${projectId}/ai-drafts`}
            className="text-primary underline"
          >
            返回 AI 助手
          </Link>
          <Link
            prefetch={false}
            href={`/teams/${access.project.teamId}/availability`}
            className="text-primary underline"
          >
            团队忙碌日程
          </Link>
        </div>
      </header>
      <section className="ac-card space-y-2 p-4">
        <h2 className="font-semibold">当前项目进度</h2>
        <p className="text-sm">
          主任务完成 {workspace.stats.completed}／{workspace.stats.total}
          ；阻塞任务 {workspace.stats.blocked} 项；本人可规划{" "}
          {workspace.stats.eligible} 项。
        </p>
        <p className="text-sm text-ink-soft">
          可工作 {workspace.preferences.workStart}—
          {workspace.preferences.workEnd}，每天最多{" "}
          {workspace.preferences.dailyMinutes} 分钟（北京时间）。
        </p>
        <p className="text-xs text-ink-soft">
          只依据已登记日程及你授权的工作时段计算；空白课表不代表其余时间都可用。
        </p>
      </section>
      {access.role !== "teacher" && access.project.status !== "archived" ? (
        <PersonalPlanGenerator
          projectId={projectId}
          startDate={startDate}
          candidates={workspace.candidates}
          total={workspace.candidateTotal}
          requestId={randomUUID()}
          aiAvailable={!!process.env.DEEPSEEK_API_KEY}
          seed={seed}
        />
      ) : (
        <p className="text-sm text-ink-soft">
          当前角色或归档状态下只可查看自己的历史计划。
        </p>
      )}
      <section className="space-y-4">
        <h2 className="font-semibold">我的计划记录</h2>
        {!workspace.plans.length && (
          <p className="text-sm text-ink-soft">尚无个人计划。</p>
        )}
        {workspace.plans.map((plan) => (
          <article key={plan.id} className="ac-card space-y-4 p-4">
            <header className="space-y-1">
              <h3 className="break-words font-semibold">{plan.goal}</h3>
              <p className="text-xs text-ink-soft">
                {plan.startDate}—{plan.endDate} ·{" "}
                {plan.mode === "ai" ? "AI 建议＋规则排程" : "规则排程"} ·{" "}
                {statusNames[plan.status] ?? plan.status}
              </p>
            </header>
            {plan.isStale && plan.status !== "cancelled" && (
              <p role="status" className="text-sm text-high">
                课表、偏好、任务或其他安排已变化。本计划需要重新核对，可按新日程重新规划。
              </p>
            )}
            {plan.warnings.map((w) => (
              <p key={w} className="text-sm text-ink-soft">
                {w}
              </p>
            ))}
            {plan.replacesPlanId && plan.status === "draft" && (
              <p className="text-sm text-primary">
                这是重新规划的草案，确认后会替换原安排；取消草案不会影响原安排。
              </p>
            )}
            <p className="text-sm">
              已安排 {plan.items.reduce((s, b) => s + b.minutes, 0)} 分钟；仍有{" "}
              {plan.unmet.reduce((s, b) => s + b.minutes, 0)}{" "}
              分钟未安排。安排时长不等于任务已完成。
            </p>
            <ol className="space-y-2">
              {plan.items.map((block, i) => (
                <li
                  key={i}
                  className="space-y-1 rounded-lg border border-line p-3 text-sm"
                >
                  <p className="font-medium">
                    {day(block.startAt)} {time(block.startAt)}—
                    {time(block.endAt)} · {block.minutes} 分钟
                  </p>
                  <Link
                    href={`/projects/${projectId}?task=${block.taskId}`}
                    className="block break-words text-primary underline"
                  >
                    {block.title}
                  </Link>
                  <p className="break-words">短期目标：{block.objective}</p>
                  <p className="break-words text-xs text-ink-soft">
                    {block.reason}
                  </p>
                </li>
              ))}
            </ol>
            {!!plan.unmet.length && (
              <details open>
                <summary className="cursor-pointer text-sm font-medium text-high">
                  未排下的工作
                </summary>
                <ul className="mt-2 space-y-2">
                  {plan.unmet.map((item) => (
                    <li
                      key={item.taskId}
                      className="text-sm [overflow-wrap:anywhere]"
                    >
                      {item.title}：剩余 {item.minutes} 分钟。{item.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <PersonalPlanControls
              projectId={projectId}
              plan={plan}
              requestId={randomUUID()}
            />
            <p className="text-xs text-ink-soft">
              草案 24
              小时有效；确认时重新检查课表、任务版本和时间冲突。需要调整时，重新规划并核对剩余工时。
            </p>
          </article>
        ))}
        <nav className="flex gap-3 text-sm">
          {offset > 0 && (
            <Link href={`?offset=${Math.max(0, offset - 10)}`}>上一页</Link>
          )}
          {workspace.nextOffset !== null && (
            <Link href={`?offset=${workspace.nextOffset}`}>下一页</Link>
          )}
        </nav>
      </section>
    </main>
  );
}
