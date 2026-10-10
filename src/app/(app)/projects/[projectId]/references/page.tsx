import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getProjectForUser, listProjectMilestones } from "@/lib/project";
import { listProjectReferences } from "@/lib/project-extras";
import { listTeamMembers } from "@/lib/team";
import { REFERENCE_TYPES } from "@/lib/reference-labels";
import { ReferenceForm, DeleteReferenceForm } from "./reference-form";
import { ProjectNav } from "@/components/projects/project-nav";

export default async function ReferencesPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!z.uuid().safeParse(projectId).success) notFound();
  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();
  const search = await searchParams;
  const type = REFERENCE_TYPES.find((t) => t.id === search.type)?.id;
  const rawOffset = Number(search.offset ?? 0);
  const offset =
    Number.isInteger(rawOffset) && rawOffset >= 0 && rawOffset <= 100000
      ? rawOffset
      : 0;
  const [references, members, stages] = await Promise.all([
    listProjectReferences(session.user.id, projectId, { type, offset }),
    listTeamMembers(access.project.teamId),
    listProjectMilestones(session.user.id, projectId),
  ]);
  const path = "/projects/" + projectId + "/references";
  return (
    <main className="mx-auto max-w-3xl space-y-6 py-8">
      <ProjectNav projectId={projectId} current="references" />
      <header className="space-y-2">
        <Link
          href={"/projects/" + projectId}
          className="text-sm text-primary hover:underline"
        >
          ← 返回项目
        </Link>
        <h1 className="font-display text-2xl font-semibold">会议与资料</h1>
        <p className="text-sm text-ink-soft">
          {access.project.name} · 集中保存外部资料，点击卡片打开原链接。
        </p>
      </header>
      <nav aria-label="资料类型" className="flex flex-wrap gap-2">
        <Link
          href={path}
          aria-current={!type ? "page" : undefined}
          className="ac-btn-ghost"
        >
          全部
        </Link>
        {REFERENCE_TYPES.map((t) => (
          <Link
            key={t.id}
            href={path + "?type=" + t.id}
            aria-current={type === t.id ? "page" : undefined}
            className="ac-btn-ghost"
          >
            {t.name}
          </Link>
        ))}
      </nav>
      <section aria-label="资料列表" className="space-y-3">
        {!references.items.length && (
          <p className="ac-card p-5 text-sm text-ink-soft">暂无记录。</p>
        )}
        {references.items.map((record) => (
          <article key={record.id} className="ac-card space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="ac-badge bg-primary-soft text-primary">
                {REFERENCE_TYPES.find((t) => t.id === record.type)?.name}
              </span>
              <h2 className="min-w-0 break-words font-medium">
                {record.title}
              </h2>
            </div>
            <a
              href={record.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block break-all text-sm text-primary underline"
            >
              {new URL(record.url).host} · 打开原链接 ↗
            </a>
            <div className="flex flex-wrap gap-2 text-sm text-ink-soft">
              {record.meetingDate && (
                <span>会议日期：{record.meetingDate}</span>
              )}
              {record.milestoneTitle && (
                <span>
                  阶段：{record.milestoneTitle}
                  {!record.milestoneId ? "（已删除）" : ""}
                </span>
              )}
            </div>
            {record.participants.length > 0 && (
              <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">
                参与人：{record.participants.map((p) => p.name).join("、")}
              </p>
            )}
            {record.note && (
              <p className="whitespace-pre-wrap break-words text-sm">
                {record.note}
              </p>
            )}
            {(record.minutesUrl || record.recordingUrl) && (
              <div className="flex flex-wrap gap-3 text-sm">
                {record.minutesUrl && (
                  <a
                    href={record.minutesUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline"
                  >
                    查看纪要 ↗
                  </a>
                )}
                {record.recordingUrl && (
                  <a
                    href={record.recordingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline"
                  >
                    查看录制 ↗
                  </a>
                )}
              </div>
            )}
            {record.canEdit && (
              <div className="space-y-3 border-t border-line pt-3">
                <details>
                  <summary className="cursor-pointer text-sm text-primary">
                    编辑记录
                  </summary>
                  <div className="pt-3">
                    <ReferenceForm
                      key={record.id + ":" + record.revision}
                      projectId={projectId}
                      requestId={randomUUID()}
                      record={record}
                      members={members}
                      milestones={stages}
                    />
                  </div>
                </details>
                <DeleteReferenceForm
                  projectId={projectId}
                  requestId={randomUUID()}
                  record={record}
                />
              </div>
            )}
          </article>
        ))}
      </section>
      <nav aria-label="资料分页" className="flex gap-3 text-sm">
        {offset > 0 && (
          <Link
            className="text-primary underline"
            href={
              path +
              "?offset=" +
              Math.max(0, offset - 50) +
              (type ? "&type=" + type : "")
            }
          >
            上一页
          </Link>
        )}
        {references.nextOffset !== null && (
          <Link
            className="text-primary underline"
            href={
              path +
              "?offset=" +
              references.nextOffset +
              (type ? "&type=" + type : "")
            }
          >
            下一页
          </Link>
        )}
      </nav>
      {access.project.status !== "archived" ? (
        <section className="ac-card space-y-3 p-4">
          <h2 className="font-medium">添加会议或资料</h2>
          <ReferenceForm
            projectId={projectId}
            requestId={randomUUID()}
            members={members}
            milestones={stages}
          />
        </section>
      ) : (
        <p className="text-sm text-ink-soft">项目已归档，资料仅供查看。</p>
      )}
    </main>
  );
}
