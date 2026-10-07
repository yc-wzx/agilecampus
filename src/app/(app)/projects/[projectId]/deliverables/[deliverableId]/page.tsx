import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ProjectNav } from "@/components/projects/project-nav";
import { auth } from "@/lib/auth";
import { getDeliverableDetail, getFeedbackTaskLink } from "@/lib/deliverable";
import { DELIVERABLE_LABELS } from "@/lib/deliverable-labels";
import { ForbiddenError } from "@/lib/errors";
import { getProjectForUser, listProjectMilestones } from "@/lib/project";
import { listTeamMembers } from "@/lib/team";
import { DeliverableEditor } from "../editor";
import { SubmitButton } from "../submit-button";
import { LocateTarget } from "../locate";
import { ReviewForm } from "../review-form";
import { StartRevisionButton } from "../start-revision-button";
import { FeedbackTaskForm } from "../feedback-task-form";

/** D 的审核决定翻译成中文；里程碑文字反馈没有版本。 */
const DECISION_LABELS: Record<string, string> = {
  approved: "验收通过",
  changes_requested: "要求修改",
  comment: "里程碑反馈",
};

/** 哪些反馈值得提供「转为修改任务」；通过不需要转任务。 */
const CONVERTIBLE_DECISIONS = new Set(["changes_requested", "comment"]);

function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "时间未知";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
}

export default async function DeliverablePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; deliverableId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId, deliverableId } = await params;
  const sp = await searchParams;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (![projectId, deliverableId].every((id) => z.uuid().safeParse(id).success))
    notFound();

  // 权限与隐私由服务端判定：他人私有草稿一律按“不存在”处理
  let detail;
  try {
    detail = await getDeliverableDetail(session.user.id, projectId, deliverableId);
  } catch (error) {
    if (error instanceof ForbiddenError) notFound();
    throw error;
  }

  const item = detail.deliverable;
  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();
  const canCreateTasks = access.role === "admin" || access.role === "student";

  const milestones: { id: string; title: string }[] = item.allowedActions.edit
    ? await listProjectMilestones(session.user.id, projectId)
    : [];
  const members: { id: string; name: string; role: string }[] =
    await listTeamMembers(access.project.teamId);
  const nameOf = (userId: string | null) =>
    members.find((member) => member.id === userId)?.name ?? "团队成员";

  // 反馈 → 修改任务的反向链接（任务 → 反馈由 C 的任务详情面板负责）
  const linkEntries = await Promise.all(
    detail.feedback.map(async (feedback) => {
      const link = await getFeedbackTaskLink(
        session.user.id,
        projectId,
        feedback.id,
      ).catch(() => null);
      return [feedback.id, link] as const;
    }),
  );
  const linkMap = new Map(linkEntries);

  // 固定来源入口（第 9.1 节）：成果页识别 ?versionId=&feedbackId= 并定位到对应记录
  const focusVersionId =
    typeof sp.versionId === "string" && z.uuid().safeParse(sp.versionId).success
      ? sp.versionId
      : null;
  const focusFeedbackId =
    typeof sp.feedbackId === "string" && z.uuid().safeParse(sp.feedbackId).success
      ? sp.feedbackId
      : null;
  const focusVersion = focusVersionId
    ? detail.versions.find((version) => version.id === focusVersionId)
    : undefined;
  const focusFeedback = focusFeedbackId
    ? detail.feedback.find((feedback) => feedback.id === focusFeedbackId)
    : undefined;
  const scrollTargetId = focusFeedbackId
    ? `feedback-${focusFeedbackId}`
    : focusVersionId
      ? `version-${focusVersionId}`
      : null;

  const latestVersion = detail.versions[0] ?? null;
  const versionFeedback = detail.feedback.filter(
    (feedback) => feedback.versionId !== null,
  );
  const milestoneFeedback = detail.feedback.filter(
    (feedback) => feedback.versionId === null,
  );

  return (
    <main className="mx-auto max-w-3xl space-y-5 py-8">
      <ProjectNav projectId={projectId} current="deliverables" />
      <LocateTarget targetId={scrollTargetId} />

      <Link
        className="text-sm text-primary hover:underline"
        href={`/projects/${projectId}/deliverables`}
      >
        ← 返回成果列表
      </Link>

      {(focusVersion || focusFeedback) && (
        <p className="ac-card p-3 text-xs text-ink-soft">
          正在定位
          {focusVersion ? `第 ${focusVersion.versionNumber} 版` : ""}
          {focusVersion && focusFeedback ? "的" : ""}
          {focusFeedback ? "教师反馈" : ""}
          ；内容均来自正式提交与正式反馈，可长期追溯。
        </p>
      )}

      {(focusVersionId && !focusVersion || focusFeedbackId && !focusFeedback) && <p className="ac-card p-3 text-sm text-ink-soft">链接指向的版本或反馈不可用，请核对链接与访问权限。</p>}
      <header className="space-y-2">
        <h1 className="break-words font-display text-2xl font-semibold text-ink">
          {item.title}
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">
          <StatusBadge status={item.status} />
          <span>作者 {nameOf(item.authorId)}</span>
          <span>·</span>
          <span>已提交版本 {detail.versions.length} 个</span>
        </div>
      </header>

      {/* 当前草稿 / 当前正式成果 */}
      <section className="ac-card space-y-3 p-4">
        <h2 className="font-medium">
          {item.status === "draft" ? "当前草稿" : "当前正式成果"}
        </h2>
        <p className="text-sm">
          类型：{DELIVERABLE_LABELS[item.type]}
          {item.milestoneId ? "" : " · 未关联里程碑"}
        </p>
        <p className="break-words whitespace-pre-wrap text-sm">
          {item.description || "暂无说明"}
        </p>
        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block break-all text-sm text-primary underline"
          >
            查看成果链接
          </a>
        ) : (
          <p className="text-sm text-ink-soft">
            尚未填写链接，正式提交前需要补充。
          </p>
        )}
        {item.status !== "draft" && (
          <p className="text-xs text-ink-faint">
            {item.status === "approved"
              ? "已通过版本需要改动时，先开始新版本草稿，再显式重新提交。"
              : item.status === "changes_requested"
                ? "请按下方教师意见修改，保存草稿后点击「提交新版本」；旧版本与旧意见会保留。"
                : "等待教师验收；此时不能覆盖已提交内容。"}
          </p>
        )}
        {item.workingCopy && (
          <p className="text-xs text-medium">
            已有一个未提交的新版本草稿，可在下方继续编辑；正式重交前，其他成员仍看到上一版。
          </p>
        )}
      </section>

      {/* 教师/管理员验收：只针对当前待审版本 */}
      {item.allowedActions.review && latestVersion && (
        <ReviewForm
          key={`review-${latestVersion.id}`}
          projectId={projectId}
          deliverableId={item.id}
          versionId={latestVersion.id}
          versionNumber={latestVersion.versionNumber}
          requestId={randomUUID()}
        />
      )}

      {/* 作者：开始新版本草稿 */}
      {item.allowedActions.startRevision && (
        <section className="ac-card space-y-3 p-4">
          <StartRevisionButton
            key={`revise-${item.revision}`}
            projectId={projectId}
            deliverableId={item.id}
            revision={item.revision}
            requestId={randomUUID()}
            status={item.status}
          />
        </section>
      )}

      {/* 作者：编辑草稿 / 提交新版本 */}
      {item.allowedActions.edit && (
        <section className="space-y-3">
          <h2 className="font-medium">
            {item.workingCopy ? "编辑新版本草稿" : "编辑草稿"}
          </h2>
          <DeliverableEditor
            key={item.revision}
            projectId={projectId}
            deliverableId={item.id}
            revision={item.revision}
            milestones={milestones}
            initial={item.workingCopy ?? item}
          />
        </section>
      )}

      {item.allowedActions.submit && (
        <section className="ac-card space-y-3 p-4">
          <p className="text-sm text-ink-soft">
            {item.workingCopy
              ? "正式提交将把当前草稿保存为新版本快照，并向团队开放该版本；旧版本不会被覆盖。"
              : "正式提交将保存版本快照，并向团队开放该版本。"}
          </p>
          <SubmitButton
            key={item.revision}
            projectId={projectId}
            deliverableId={item.id}
            revision={item.revision}
            requestId={randomUUID()}
          />
        </section>
      )}

      {/* 版本历史：每个版本下面挂它自己的意见 */}
      <section className="ac-card space-y-4 p-4">
        <h2 className="font-medium">已提交版本（{detail.versions.length}）</h2>
        {detail.versions.length === 0 && (
          <p className="text-sm text-ink-soft">暂无已提交版本。</p>
        )}
        {detail.versions.map((version) => {
          const focused = version.id === focusVersionId;
          const own = versionFeedback.filter(
            (feedback) => feedback.versionId === version.id,
          );
          return (
            <article
              key={version.id}
              id={`version-${version.id}`}
              className={`space-y-3 border-t border-line pt-3 text-sm ${
                focused ? "rounded-field bg-primary-soft/60 px-2" : ""
              }`}
            >
              <h3 className="break-words font-medium">
                第 {version.versionNumber} 版 · {version.title}
              </h3>
              <p className="text-xs text-ink-faint">
                {formatDate(version.submittedAt)} · {DELIVERABLE_LABELS[version.type]}{" "}
                · {version.milestoneTitle ?? "未关联里程碑"} · 提交人{" "}
                {nameOf(version.submittedById)}
              </p>
              <p className="break-words whitespace-pre-wrap">
                {version.description}
              </p>
              <a
                className="block break-all text-primary underline"
                href={version.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                查看该版成果
              </a>

              {own.map((feedback) => {
                const link = linkMap.get(feedback.id) ?? null;
                const feedbackFocused = feedback.id === focusFeedbackId;
                return (
                  <div
                    key={feedback.id}
                    id={`feedback-${feedback.id}`}
                    className={`space-y-2 rounded-field bg-sunken/50 p-3 ${
                      feedbackFocused ? "ring-1 ring-primary-ring" : ""
                    }`}
                  >
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-faint">
                      <span className="ac-badge bg-surface text-ink-soft">
                        {DECISION_LABELS[feedback.decision] ?? feedback.decision}
                      </span>
                      <span>{nameOf(feedback.reviewerId)}</span>
                      <span>{formatDate(feedback.createdAt)}</span>
                    </p>
                    <p className="break-words whitespace-pre-wrap">
                      {feedback.comment}
                    </p>
                    {CONVERTIBLE_DECISIONS.has(feedback.decision) && (
                      <FeedbackTaskForm
                        canCreate={canCreateTasks}
                        projectId={projectId}
                        feedbackId={feedback.id}
                        versionLabel={`第 ${version.versionNumber} 版`}
                        defaultTitle={`按教师意见修改：${version.title}`}
                        defaultDescription={feedback.comment}
                        members={members.map((member) => ({
                          id: member.id,
                          name: member.name,
                        }))}
                        existingTaskId={link?.taskId ?? null}
                        existingTaskDeleted={link?.deleted ?? false}
                        requestId={randomUUID()}
                      />
                    )}
                  </div>
                );
              })}
            </article>
          );
        })}
      </section>

      {/* 里程碑反馈（不属于任何版本） */}
      {milestoneFeedback.length > 0 && (
        <section className="ac-card space-y-3 p-4">
          <h2 className="font-medium">里程碑反馈</h2>
          {milestoneFeedback.map((feedback) => {
            const link = linkMap.get(feedback.id) ?? null;
            const focused = feedback.id === focusFeedbackId;
            return (
              <article
                key={feedback.id}
                id={`feedback-${feedback.id}`}
                className={`space-y-2 border-t border-line pt-3 text-sm ${
                  focused ? "rounded-field bg-primary-soft/60 px-2" : ""
                }`}
              >
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-faint">
                  <span className="ac-badge bg-sunken text-ink-soft">里程碑反馈</span>
                  <span>{feedback.milestoneTitle ?? "未关联里程碑"}</span>
                  <span>{nameOf(feedback.reviewerId)}</span>
                  <span>{formatDate(feedback.createdAt)}</span>
                </p>
                <p className="break-words whitespace-pre-wrap">
                  {feedback.comment}
                </p>
                <FeedbackTaskForm
                  projectId={projectId}
                  feedbackId={feedback.id}
                  versionLabel="这条里程碑反馈"
                  defaultTitle={`按教师意见推进：${feedback.milestoneTitle ?? item.title}`}
                  defaultDescription={feedback.comment}
                  members={members.map((member) => ({
                    id: member.id,
                    name: member.name,
                  }))}
                  existingTaskId={link?.taskId ?? null}
                  existingTaskDeleted={link?.deleted ?? false}
                  requestId={randomUUID()}
                />
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
