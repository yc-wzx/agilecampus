import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getProjectForUser, listProjectMilestones } from "@/lib/project";
import { listProjectIterations } from "@/lib/iteration";
import { listTeamMembers } from "@/lib/team";
import { listProjectEvidence, EVIDENCE_KINDS } from "@/lib/evidence";
import type { EvidenceFilters } from "@/contracts/p0-p2";
import { ValidationError } from "@/lib/errors";
import { ProjectNav } from "@/components/projects/project-nav";
import { MarkdownDownload } from "@/components/markdown-download";
import { exportProjectEvidenceMarkdownAction } from "../actions";
import { z } from "zod";
const names = {
  task_activity: "任务活动",
  iteration_history: "迭代历史",
  comment: "评论",
  deliverable_submission: "成果提交",
  deliverable_review: "成果审核",
  milestone_feedback: "阶段反馈",
  retrospective: "复盘",
};
const roles = {
  actor: "操作者",
  assignee: "负责人",
  submitter: "提交者",
  reviewer: "审核者",
  author: "作者",
};
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId } = await params,
    query = await searchParams;
  if (!z.uuid().safeParse(projectId).success) notFound();
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();
  const string = (key: string) =>
    typeof query[key] === "string" && query[key]
      ? (query[key] as string)
      : undefined;
  const offset = Math.max(0, Number(string("offset")) || 0);
  const filters: EvidenceFilters = {
    offset,
    limit: 20,
    fromDate: string("fromDate"),
    toDate: string("toDate"),
    milestoneId: string("milestoneId"),
    iterationId: string("iterationId"),
    memberId: string("memberId"),
    memberRole: string("memberRole") as EvidenceFilters["memberRole"],
    kinds: string("kind")
      ? [string("kind") as (typeof EVIDENCE_KINDS)[number]]
      : undefined,
  };
  let error = "",
    page: Awaited<ReturnType<typeof listProjectEvidence>> | null = null;
  try {
    page = await listProjectEvidence(session.user.id, projectId, filters);
  } catch (e) {
    if (e instanceof ValidationError || e instanceof z.ZodError)
      error = e.message;
    else throw e;
  }
  const [members, milestones, iterations] = await Promise.all([
    listTeamMembers(access.project.teamId),
    listProjectMilestones(session.user.id, projectId),
    listProjectIterations(session.user.id, projectId, { limit: 100 }),
  ]);
  const exportFilters = { ...filters };
  delete exportFilters.offset;
  delete exportFilters.limit;
  const href = (n: number) => {
    const p = new URLSearchParams();
    for (const [k, value] of Object.entries(query))
      if (typeof value === "string" && k !== "offset") p.set(k, value);
    p.set("offset", String(n));
    return `?${p}`;
  };
  return (
    <main className="mx-auto max-w-5xl space-y-5 py-8 [overflow-wrap:anywhere]">
      <ProjectNav projectId={projectId} current="evidence" />
      <h1 className="font-display text-2xl font-semibold">
        {access.project.name} · 过程证据
      </h1>
      <Link
        className="text-sm text-primary underline"
        href={`/projects/${projectId}/evidence`}
      >
        只看成果证据及成果类型筛选
      </Link>
      <form className="ac-card grid gap-3 p-5 sm:grid-cols-2 md:grid-cols-3">
        <label className="text-sm">
          记录类型
          <select
            name="kind"
            className="ac-field block w-full"
            defaultValue={string("kind") ?? ""}
          >
            <option value="">全部类型</option>
            {EVIDENCE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {names[kind]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          里程碑
          <select
            name="milestoneId"
            className="ac-field block w-full"
            defaultValue={filters.milestoneId ?? ""}
          >
            <option value="">全部里程碑</option>
            {milestones.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          迭代
          <select
            name="iterationId"
            className="ac-field block w-full"
            defaultValue={filters.iterationId ?? ""}
          >
            <option value="">全部迭代</option>
            {iterations.items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          成员
          <select
            name="memberId"
            className="ac-field block w-full"
            defaultValue={filters.memberId ?? ""}
          >
            <option value="">全部成员</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          参与身份
          <select
            name="memberRole"
            className="ac-field block w-full"
            defaultValue={filters.memberRole ?? ""}
          >
            <option value="">请选择身份（筛选成员时必选）</option>
            {Object.entries(roles).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          起始日期
          <input
            type="date"
            name="fromDate"
            className="ac-field block w-full"
            defaultValue={filters.fromDate}
          />
        </label>
        <label className="text-sm">
          结束日期（不包含）
          <input
            type="date"
            name="toDate"
            className="ac-field block w-full"
            defaultValue={filters.toDate}
          />
        </label>
        <div className="flex items-end">
          <button type="submit" className="ac-btn">
            筛选证据
          </button>
        </div>
      </form>
      {error && (
        <p role="alert" className="text-high">
          {error}
        </p>
      )}
      {page && (
        <>
          <p className="text-xs text-ink-soft">
            {page.coverage.note} · 生成时间{" "}
            {new Date(page.generatedAt).toLocaleString("zh-CN", {
              timeZone: "Asia/Shanghai",
            })}
          </p>
          <MarkdownDownload
            action={exportProjectEvidenceMarkdownAction.bind(
              null,
              projectId,
              exportFilters,
            )}
            label="下载当前筛选的证据清单"
          />
          {page.items.length === 0 && <p>暂无符合条件的证据</p>}
          {page.items.map((item) => (
            <article key={item.evidenceKey} className="ac-card space-y-2 p-5">
              <p className="text-xs text-ink-soft">
                {names[item.kind]} ·{" "}
                {new Date(item.occurredAt).toLocaleString("zh-CN", {
                  timeZone: "Asia/Shanghai",
                })}
              </p>
              <h2 className="font-semibold">{item.title}</h2>
              <p className="whitespace-pre-wrap text-sm">{item.summary}</p>
              <p className="text-xs text-ink-soft">
                {item.identities
                  .map(
                    (i) =>
                      `${roles[i.role]}：${members.find((m) => m.id === i.userId)?.name ?? "已离组成员"}`,
                  )
                  .join("；")}
              </p>
              {item.sourceRef.sourceHref ? (
                <Link
                  className="text-sm text-primary underline"
                  href={item.sourceRef.sourceHref}
                >
                  查看原始记录
                </Link>
              ) : (
                <span className="text-xs text-ink-soft">来源已删除</span>
              )}
            </article>
          ))}
          <nav className="flex gap-3 text-sm">
            {offset > 0 && (
              <Link href={href(Math.max(0, offset - 20))}>上一页</Link>
            )}
            {page.nextOffset !== null && (
              <Link href={href(page.nextOffset)}>下一页</Link>
            )}
            <span>共 {page.total} 条</span>
          </nav>
        </>
      )}
    </main>
  );
}
