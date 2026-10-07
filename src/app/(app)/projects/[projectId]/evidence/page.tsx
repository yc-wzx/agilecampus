import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { ProjectNav } from "@/components/projects/project-nav";
import { auth } from "@/lib/auth";
import { DeliverableError } from "@/lib/deliverable";
import { DELIVERABLE_LABELS } from "@/lib/deliverable-labels";
import type { EvidenceExportFilters } from "@/lib/deliverable-evidence-markdown";
import {
  listDeliverableEvidence,
  type DeliverableEvidenceOptions,
} from "@/lib/deliverable-reporting";
import { ForbiddenError } from "@/lib/errors";
import { getProjectForUser, listProjectMilestones } from "@/lib/project";
import { listTeamMembers } from "@/lib/team";
import type { DeliverableType } from "@/db/schema";
import { EvidenceExportButton } from "./export-button";

const KIND_VALUES = ["submission", "review", "milestone_feedback"] as const;
type EvidenceKind = (typeof KIND_VALUES)[number];

const TYPE_VALUES = [
  "report",
  "presentation",
  "video",
  "survey",
  "code",
  "prototype",
  "demo",
  "other",
] as const;

const KIND_LABELS: Record<EvidenceKind, string> = {
  submission: "正式提交",
  review: "版本审核",
  milestone_feedback: "里程碑反馈",
};

const DECISION_LABELS: Record<string, string> = {
  approved: "验收通过",
  changes_requested: "要求修改",
  comment: "里程碑反馈",
};

const PAGE_SIZE = 20;

function one(value: string | string[] | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function beijingTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
}

function withQuery(
  base: string,
  params: Record<string, string | number | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${base}?${query}` : base;
}

export default async function ProjectEvidencePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId } = await params;
  const sp = await searchParams;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!z.uuid().safeParse(projectId).success) notFound();

  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();

  // 只接受白名单枚举与合法 ID/日期；非法值直接忽略，不把浏览器参数当查询条件
  const rawKind = one(sp.kind);
  const rawType = one(sp.type);
  const rawAuthor = one(sp.authorId);
  const rawMilestone = one(sp.milestoneId);
  const rawFrom = one(sp.fromDate);
  const rawTo = one(sp.toDate);
  const rawOffset = one(sp.offset);

  const filters: EvidenceExportFilters = {
    ...(KIND_VALUES.includes(rawKind as EvidenceKind)
      ? { kind: rawKind as EvidenceKind }
      : {}),
    ...(TYPE_VALUES.includes(rawType as (typeof TYPE_VALUES)[number])
      ? { type: rawType }
      : {}),
    ...(rawAuthor && z.uuid().safeParse(rawAuthor).success
      ? { authorId: rawAuthor }
      : {}),
    ...(rawMilestone && z.uuid().safeParse(rawMilestone).success
      ? { milestoneId: rawMilestone }
      : {}),
    ...(rawFrom && z.iso.date().safeParse(rawFrom).success
      ? { fromDate: rawFrom }
      : {}),
    ...(rawTo && z.iso.date().safeParse(rawTo).success ? { toDate: rawTo } : {}),
  };

  const offset = (() => {
    const parsed = Number.parseInt(rawOffset ?? "0", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  })();

  const options: DeliverableEvidenceOptions = {
    ...filters,
    offset,
    limit: PAGE_SIZE,
  } as DeliverableEvidenceOptions;

  const [members, milestones] = await Promise.all([
    listTeamMembers(access.project.teamId),
    listProjectMilestones(session.user.id, projectId),
  ]);
  const nameOf = (userId: string | null) =>
    members.find((member) => member.id === userId)?.name ?? "团队成员";

  let page: Awaited<ReturnType<typeof listDeliverableEvidence>> | null = null;
  let queryError = "";
  try {
    page = await listDeliverableEvidence(session.user.id, projectId, options);
  } catch (error) {
    if (error instanceof ForbiddenError) notFound();
    if (error instanceof DeliverableError) queryError = error.message;
    else throw error;
  }

  const basePath = `/projects/${projectId}/evidence`;
  const items = page?.items ?? [];
  const total = page?.total ?? 0;

  return (
    <main className="mx-auto max-w-4xl space-y-6 py-8">
      <ProjectNav projectId={projectId} current="deliverables" />

      <header className="space-y-2">
        <h1 className="font-display text-2xl font-semibold text-ink">
          成果过程证据
        </h1>
        <p className="text-xs text-ink-faint">
          汇总正式提交、版本审核与里程碑反馈，每条都能回到原记录。**不含**未提交的私有草稿；
          任务、迭代与评论类证据属于 E 的统一证据服务，交付后会在同一页面追加。
        </p>
      </header>

      {/* 筛选：普通 GET 表单，不依赖客户端脚本 */}
      <form
        method="get"
        action={basePath}
        className="ac-card grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <label className="space-y-1 text-xs">
          <span className="block text-ink-faint">类别</span>
          <select name="kind" defaultValue={rawKind ?? ""} className="ac-field">
            <option value="">全部</option>
            {KIND_VALUES.map((kind) => (
              <option key={kind} value={kind}>
                {KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-xs">
          <span className="block text-ink-faint">成果类型</span>
          <select name="type" defaultValue={rawType ?? ""} className="ac-field">
            <option value="">全部</option>
            {TYPE_VALUES.map((type) => (
              <option key={type} value={type}>
                {DELIVERABLE_LABELS[type as DeliverableType]}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-xs">
          <span className="block text-ink-faint">成果作者</span>
          <select
            name="authorId"
            defaultValue={rawAuthor ?? ""}
            className="ac-field"
          >
            <option value="">全部成员</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-xs">
          <span className="block text-ink-faint">里程碑</span>
          <select
            name="milestoneId"
            defaultValue={rawMilestone ?? ""}
            className="ac-field"
          >
            <option value="">全部里程碑</option>
            {milestones.map((milestone) => (
              <option key={milestone.id} value={milestone.id}>
                {milestone.title}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-xs">
          <span className="block text-ink-faint">起始日（含）</span>
          <input
            type="date"
            name="fromDate"
            defaultValue={filters.fromDate ?? ""}
            className="ac-field"
          />
        </label>

        <label className="space-y-1 text-xs">
          <span className="block text-ink-faint">结束日（不含）</span>
          <input
            type="date"
            name="toDate"
            defaultValue={filters.toDate ?? ""}
            className="ac-field"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-3">
          <button className="ac-btn">筛选</button>
          <Link href={basePath} className="ac-btn-ghost">
            重置
          </Link>
          <span className="text-xs text-ink-faint">
            日期按北京时间，结束日不含当天
          </span>
        </div>
      </form>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-ink-soft">
            共 {total} 条，本页 {items.length} 条
          </p>
          <EvidenceExportButton projectId={projectId} filters={filters} />
        </div>

        {queryError && (
          <p role="alert" className="ac-card p-4 text-sm text-high">
            {queryError}
          </p>
        )}

        {!queryError && items.length === 0 && (
          <p className="ac-card p-8 text-center text-sm text-ink-soft">
            当前筛选没有证据记录。正式提交或教师反馈之后，这里会出现可追溯的条目。
          </p>
        )}

        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.evidenceKey} className="ac-card space-y-2 p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="ac-badge bg-primary-soft text-primary">
                  {KIND_LABELS[item.kind as EvidenceKind] ?? item.kind}
                </span>
                {item.versionNumber !== null && (
                  <span className="text-ink-faint">第 {item.versionNumber} 版</span>
                )}
                {item.milestoneTitle && (
                  <span className="text-ink-faint">里程碑：{item.milestoneTitle}</span>
                )}
                <span className="text-ink-faint">{beijingTime(item.occurredAt)}</span>
              </div>

              <p className="break-words font-medium text-ink">
                {item.title ?? "（无标题）"}
              </p>

              <p className="text-xs text-ink-faint">
                作者 {nameOf(item.authorId)}；操作者 {nameOf(item.actorId)}
                {item.type
                  ? ` · 类型 ${DELIVERABLE_LABELS[item.type as DeliverableType] ?? item.type}`
                  : ""}
              </p>

              {item.kind === "submission" ? (
                <>
                  {item.description && (
                    <p className="break-words whitespace-pre-wrap text-sm text-ink-soft">
                      {item.description}
                    </p>
                  )}
                  {item.url && (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block break-all text-sm text-primary underline"
                    >
                      查看该版成果
                    </a>
                  )}
                </>
              ) : (
                <>
                  <p className="text-xs text-ink-soft">
                    决定：
                    {DECISION_LABELS[item.decision ?? ""] ?? item.decision ?? "—"}
                  </p>
                  {item.comment && (
                    <p className="break-words whitespace-pre-wrap text-sm text-ink-soft">
                      {item.comment}
                    </p>
                  )}
                </>
              )}

              <p className="flex flex-wrap items-center gap-x-3 text-xs">
                <a
                  href={item.sourceHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline"
                >
                  打开来源原记录
                </a>
                <span className="text-ink-faint">
                  证据键 <code className="text-[11px]">{item.evidenceKey}</code>
                </span>
              </p>
            </li>
          ))}
        </ul>

        {(offset > 0 || (page?.nextOffset ?? null) !== null) && (
          <nav className="flex flex-wrap items-center justify-between gap-2 text-sm">
            {offset > 0 ? (
              <Link
                href={withQuery(basePath, {
                  ...filters,
                  offset: Math.max(0, offset - PAGE_SIZE),
                })}
                className="ac-btn-ghost"
              >
                ← 上一页
              </Link>
            ) : (
              <span />
            )}
            {page?.nextOffset !== null && page?.nextOffset !== undefined && (
              <Link
                href={withQuery(basePath, {
                  ...filters,
                  offset: page.nextOffset,
                })}
                className="ac-btn-ghost"
              >
                下一页 →
              </Link>
            )}
          </nav>
        )}
      </section>
    </main>
  );
}
